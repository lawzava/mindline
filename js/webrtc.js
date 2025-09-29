/**
 * WebRTC P2P Connection Manager
 */

import logger from './logger.js';

export class P2PConnection {
  constructor(clientId, roomId, signalServer) {
    // Validate clientId to prevent corruption
    // Allow test IDs (starting with 'test-') or regular IDs (>= 10 chars)
    const isTestId = typeof clientId === 'string' && clientId.startsWith('test-');
    const isValidRegularId = typeof clientId === 'string' && clientId.length >= 10;

    if (typeof clientId !== 'string' || clientId.includes(',') || (!isTestId && !isValidRegularId)) {
      logger.error('Invalid clientId detected:', clientId, 'type:', typeof clientId);
      throw new Error(`Invalid clientId: ${clientId}`);
    }

    this.clientId = clientId;
    this.roomId = roomId;
    this.signalServer = signalServer;
    this.peers = new Map(); // peerId -> RTCPeerConnection
    this.dataChannels = new Map(); // peerId -> RTCDataChannel
    this.pendingCandidates = new Map(); // peerId -> Array of ICE candidates waiting for remote description
    this.onMessageCallback = null;
    this.onPeerConnectedCallback = null;
    this.onPeerDisconnectedCallback = null;
    this.onConnectionLostCallback = null;
    this.meshCheckInterval = null;
    this.allKnownPeers = new Set(); // Track all peers we should be connected to

    // ICE servers configuration - more robust for mobile devices
    this.iceConfig = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' }
      ],
      iceCandidatePoolSize: 10, // Better for mobile connections
      // Critical settings for connection stability
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
      iceTransportPolicy: 'all',
      // Restart ICE on connection failures
      iceRestart: true
    };
  }

  /**
   * Connect to signaling server and join room
   */
  async connect() {
    return new Promise((resolve, reject) => {
      try {
        // Use configuration-based WebSocket URL
        const config = window.MINDLINE_CONFIG || {
          SIGNALING_SERVER: 'localhost:3000',
          USE_SSL: false,
          WEBSOCKET_PATH: '/ws'
        };

        const host = config.SIGNALING_SERVER;

        // Check if signaling server is configured
        if (!host) {
          logger.info('P2P: No signaling server configured - running in local mode');
          reject(new Error('No signaling server configured'));
          return;
        }

        const protocol = config.USE_SSL ? 'wss:' : 'ws:';
        const path = config.WEBSOCKET_PATH;
        const wsUrl = `${protocol}//${host}${path}`;

        logger.webrtc('Connecting to signaling server at', wsUrl);
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
          logger.webrtc('Connected to signaling server');
          // Join room
          this.ws.send(JSON.stringify({
            type: 'join',
            roomId: this.roomId,
            clientId: this.clientId
          }));
        };

        this.ws.onmessage = (event) => {
          const message = JSON.parse(event.data);
          logger.debug('SIGNALING: Received message:', message.type);
          // Don't await - handle async to avoid blocking WebSocket event loop
          this.handleSignalingMessage(message).catch(error => {
            logger.error('Error handling signaling message:', error);
          });
        };

        this.ws.onerror = (error) => {
          logger.error('WebSocket error:', error);
          reject(error);
        };

        this.ws.onclose = () => {
          logger.info('Disconnected from signaling server');
          // Clean up all peer connections
          this.peers.forEach((pc, peerId) => {
            this.removePeer(peerId);
          });

          // Notify about connection loss for reconnection
          if (this.onConnectionLostCallback) {
            this.onConnectionLostCallback('signaling_server_disconnect');
          }
        };

        // Resolve after a short delay to ensure connection is established
        setTimeout(() => resolve(), 500);
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Handle signaling messages
   */
  async handleSignalingMessage(message) {
    switch (message.type) {
      case 'room-joined':
        logger.info('Joined room:', message.roomId, 'with', message.peers.length, 'existing peers');

        // Track all known peers
        message.peers.forEach(peerId => this.allKnownPeers.add(peerId));

        // Connect to ALL existing peers (I'm the new joiner, so I initiate all connections)
        for (let i = 0; i < message.peers.length; i++) {
          const peerId = message.peers[i];
          // Stagger connection attempts to reduce race conditions
          setTimeout(async () => {
            try {
              logger.debug(`Connecting to existing peer ${i + 1}/${message.peers.length}:`, peerId);
              await this.createPeerConnection(peerId, true); // Always initiate as the new joiner
            } catch (error) {
              logger.error(`Failed to connect to existing peer ${peerId}:`, error);
            }
          }, i * 2000 + (this.clientId.charCodeAt(0) % 1000)); // 2 second base delay + deterministic offset
        }

        // Start periodic mesh checking
        this.startMeshMonitoring();

        // Also trigger mesh completion check after all initial connections
        setTimeout(() => {
          this.ensureFullMesh(Array.from(this.allKnownPeers));
        }, (message.peers.length + 1) * 1000);
        break;

      case 'peer-joined':
        logger.info('Peer joined:', message.clientId);
        // New peer joined - track them and ensure connection
        if (message.clientId !== this.clientId) {
          // Add to known peers
          this.allKnownPeers.add(message.clientId);

          // Use a small delay and string comparison to avoid duplicate offers
          const shouldInitiate = this.clientId > message.clientId;
          const delay = shouldInitiate ? 500 : 1500; // Stagger by priority

          logger.debug(`Will ${shouldInitiate ? 'initiate' : 'wait for'} connection to peer:`, message.clientId);

          setTimeout(async () => {
            try {
              // Check if connection already exists (might have been created by the other peer)
              if (!this.peers.has(message.clientId) ||
                  ['failed', 'closed', 'disconnected'].includes(this.peers.get(message.clientId).connectionState)) {
                logger.debug(`Creating connection to new peer ${message.clientId}`);
                await this.createPeerConnection(message.clientId, shouldInitiate);
              } else {
                logger.debug(`Connection to ${message.clientId} already exists`);
              }
            } catch (error) {
              logger.error(`Failed to connect to new peer ${message.clientId}:`, error);
            }
          }, delay);
        }
        break;

      case 'offer':
        logger.debug('Received offer from:', message.fromId);
        await this.handleOffer(message.fromId, message.data);
        break;

      case 'answer':
        logger.debug('Received answer from:', message.fromId);
        await this.handleAnswer(message.fromId, message.data);
        break;

      case 'ice-candidate':
        logger.debug('Received ICE candidate from:', message.fromId);
        await this.handleIceCandidate(message.fromId, message.data);
        break;

      case 'peer-left':
        logger.info('Peer left:', message.clientId);
        this.removePeer(message.clientId);
        break;
    }
  }

  /**
   * Create a peer connection
   */
  async createPeerConnection(peerId, createOffer = false) {
    logger.debug(`Creating peer connection to ${peerId}, createOffer: ${createOffer}`);

    // Check if connection already exists
    if (this.peers.has(peerId)) {
      const existingPc = this.peers.get(peerId);
      logger.debug(`Peer connection already exists for ${peerId} in state: ${existingPc.connectionState}`);

      // If connection is connecting/connected and healthy, skip
      if (['connecting', 'connected'].includes(existingPc.connectionState)) {
        logger.debug(`Skipping duplicate connection to ${peerId}, already connected`);
        return;
      }

      // If connection is failed/closed/disconnected, clean up and recreate
      if (['failed', 'closed', 'disconnected'].includes(existingPc.connectionState)) {
        logger.debug(`Removing failed connection to ${peerId}, will recreate`);
        this.removePeer(peerId);
      } else if (createOffer && existingPc.signalingState !== 'stable') {
        // Wait for existing negotiation to complete
        logger.debug(`Waiting for existing negotiation with ${peerId} to complete`);
        return;
      }
    }

    const pc = new RTCPeerConnection(this.iceConfig);
    this.peers.set(peerId, pc);

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendSignalingMessage({
          type: 'ice-candidate',
          targetId: peerId,
          data: event.candidate
        });
      }
    };

    // Only create data channel if we're the initiator to prevent duplicates
    if (createOffer) {
      logger.debug(`Creating data channel for peer ${peerId} (we are initiator)`);
      const dataChannel = pc.createDataChannel('chat', {
        ordered: true,
        maxRetransmits: 3,
        maxRetransmitTime: 3000 // 3 seconds timeout
      });
      this.setupDataChannel(dataChannel, peerId);
    } else {
      logger.debug(`Waiting for data channel from ${peerId} (they are initiator)`);
    }

    // Also listen for incoming data channel from remote peer
    pc.ondatachannel = (event) => {
      logger.debug(`Received data channel from ${peerId}`);
      // ALWAYS use the received data channel for bidirectional communication

      // Close existing channel if any to prevent conflicts
      if (this.dataChannels.has(peerId)) {
        const existingChannel = this.dataChannels.get(peerId);
        existingChannel.close();
        this.dataChannels.delete(peerId);
      }

      this.setupDataChannel(event.channel, peerId);
    };

    // Create and send offer only if we're the initiator
    if (createOffer) {
      try {
        const offer = await pc.createOffer({
          offerToReceiveAudio: false,
          offerToReceiveVideo: false
        });
        await pc.setLocalDescription(offer);

        logger.debug(`Sending offer to ${peerId}`);
        this.sendSignalingMessage({
          type: 'offer',
          targetId: peerId,
          data: offer
        });

        // Set timeout for offer response
        setTimeout(() => {
          if (pc.signalingState === 'have-local-offer') {
            logger.warn(`Offer to ${peerId} timed out - restarting connection`);
            this.removePeer(peerId);
            // Retry connection after cleanup
            setTimeout(() => this.createPeerConnection(peerId, true), 2000);
          }
        }, 15000); // 15 second timeout (more generous)
      } catch (error) {
        logger.error(`Failed to create offer for ${peerId}:`, error);
        this.removePeer(peerId);
      }
    }

    // Handle connection state changes with more detailed logging
    pc.onconnectionstatechange = () => {
      logger.debug(`Connection state with ${peerId}:`, pc.connectionState);

      if (pc.connectionState === 'connected') {
        logger.info(`Successfully connected to peer ${peerId}`);
        // Clear any pending reconnection attempts for this peer
      } else if (pc.connectionState === 'failed') {
        logger.warn(`Connection failed with peer ${peerId}`);
        // Clean up failed connection immediately, let main reconnection logic handle it
        this.removePeer(peerId);
        if (this.onPeerDisconnectedCallback) {
          this.onPeerDisconnectedCallback(peerId);
        }
      } else if (pc.connectionState === 'disconnected') {
        logger.warn(`Peer ${peerId} disconnected, removing connection`);
        this.removePeer(peerId);
      }
    };

    // Handle ICE connection state changes
    pc.oniceconnectionstatechange = () => {
      logger.debug(`ICE connection state with ${peerId}:`, pc.iceConnectionState);

      if (pc.iceConnectionState === 'failed') {
        logger.warn(`ICE connection failed with ${peerId}, will restart ICE`);
        try {
          pc.restartIce();
        } catch (error) {
          logger.error(`Failed to restart ICE for ${peerId}:`, error);
        }
      }
    };
  }

  /**
   * Setup data channel event handlers
   */
  setupDataChannel(dataChannel, peerId) {
    logger.debug(`Setting up data channel for ${peerId}, state: ${dataChannel.readyState}`);

    dataChannel.onopen = () => {
      logger.info(`Data channel opened with ${peerId}`);
      this.dataChannels.set(peerId, dataChannel);

      // Register peer with Rust P2P coordination
      if (window.safeWasm) {
        try {
          logger.debug(`Registering peer ${peerId} with Rust P2P manager`);

          // First add to known peers
          if (window.safeWasm.add_known_peer) {
            window.safeWasm.add_known_peer(peerId);
          }

          // Add to connected peers in state API
          if (window.safeWasm.add_connected_peer) {
            window.safeWasm.add_connected_peer(peerId);
          }

          // Then update connection state to create peer in peers HashMap
          if (window.safeWasm.update_peer_connection_state) {
            window.safeWasm.update_peer_connection_state(peerId, 'connected');
          }

          // Set default quality metrics
          if (window.safeWasm.update_peer_latency) {
            window.safeWasm.update_peer_latency(peerId, 50); // 50ms latency
          }
        } catch (e) {
          logger.error(`Failed to register peer ${peerId} with Rust:`, e);
        }
      }

      if (this.onPeerConnectedCallback) {
        this.onPeerConnectedCallback(peerId);
      }
    };

    dataChannel.onmessage = (event) => {
      if (this.onMessageCallback) {
        try {
          const message = JSON.parse(event.data);
          logger.debug(`Received ${message.type} message from ${peerId}`);
          this.onMessageCallback(message, peerId);
        } catch (error) {
          logger.error('Error parsing message:', error);
        }
      } else {
        logger.error(`No onMessageCallback registered - dropping message from ${peerId}`);
      }
    };

    dataChannel.onerror = (error) => {
      logger.error(`Data channel error with ${peerId}:`, error);

      // Don't immediately remove peer for "User-Initiated Abort" errors
      if (error.error?.name === 'OperationError' && error.error?.message?.includes('User-Initiated Abort')) {
        logger.debug(`Ignoring User-Initiated Abort error for ${peerId}`);
        return;
      }

      // Only handle connection failure for serious errors
      logger.warn(`Serious data channel error, handling connection failure for ${peerId}`);
      this.handleConnectionFailure(peerId);
    };

    dataChannel.onclose = () => {
      logger.info(`Data channel closed with ${peerId}`);
      this.dataChannels.delete(peerId);
      if (this.onPeerDisconnectedCallback) {
        this.onPeerDisconnectedCallback(peerId);
      }
    };

    // Set binary type for better compatibility
    dataChannel.binaryType = 'arraybuffer';
  }

  /**
   * Handle offer from remote peer
   */
  async handleOffer(peerId, offer) {
    try {
      // Check if we already have a connection
      let pc = this.peers.get(peerId);

      if (pc) {
        // If we have a connection but it's in the wrong state, handle appropriately
        if (pc.signalingState === 'stable' && pc.connectionState === 'connected') {
          logger.debug(`Already connected to ${peerId}, ignoring duplicate offer`);
          return;
        }

        // If connection exists but not connected, remove and recreate
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
          this.removePeer(peerId);
          pc = null;
        }
      }

      // Create new connection if needed
      if (!pc) {
        await this.createPeerConnection(peerId, false);
        pc = this.peers.get(peerId);
      }

      // Handle offer based on current signaling state
      if (pc.signalingState === 'stable' || pc.signalingState === 'have-remote-offer') {
        await pc.setRemoteDescription(new RTCSessionDescription(offer));

        // Process any queued ICE candidates now that we have remote description
        await this.processQueuedCandidates(peerId);

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        this.sendSignalingMessage({
          type: 'answer',
          targetId: peerId,
          data: answer
        });
      } else if (pc.signalingState === 'have-local-offer') {
        // Handle offer collision - use deterministic tie-breaking
        logger.debug(`Offer collision detected with peer ${peerId}`);

        // Compare client IDs lexicographically to determine who should back down
        if (this.clientId > peerId) {
          // We have higher priority, ignore their offer
          logger.debug(`Ignoring offer from ${peerId} (we have priority)`);
          return;
        } else {
          // They have higher priority, we need to restart
          logger.debug(`Restarting connection for ${peerId} (they have priority)`);

          try {
            // Rollback to stable state and accept their offer
            await pc.setLocalDescription({type: 'rollback'});
            await pc.setRemoteDescription(new RTCSessionDescription(offer));

            // Process any queued ICE candidates now that we have remote description
            await this.processQueuedCandidates(peerId);

            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);

            this.sendSignalingMessage({
              type: 'answer',
              targetId: peerId,
              data: answer
            });
          } catch (collisionError) {
            logger.error(`Error resolving offer collision with ${peerId}:`, collisionError);
            // Clean up and let reconnection logic handle it
            this.removePeer(peerId);
            return;
          }
        }
      } else {
        logger.warn(`Cannot handle offer in state ${pc.signalingState} for peer ${peerId}`);
      }
    } catch (error) {
      logger.error(`Error handling offer from ${peerId}:`, error);
    }
  }

  /**
   * Handle answer from remote peer
   */
  async handleAnswer(peerId, answer) {
    const pc = this.peers.get(peerId);
    if (pc) {
      // Check if we're in the right state to receive an answer
      if (pc.signalingState === 'have-local-offer') {
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(answer));

          // Process any queued ICE candidates now that we have remote description
          await this.processQueuedCandidates(peerId);
        } catch (error) {
          logger.error(`Error setting remote answer for ${peerId}:`, error);
        }
      } else {
        logger.warn(`Received answer in wrong state (${pc.signalingState}) for peer ${peerId}`);
      }
    } else {
      logger.warn(`No peer connection found for ${peerId}`);
    }
  }

  /**
   * Handle ICE candidate from remote peer
   */
  async handleIceCandidate(peerId, candidate) {
    const pc = this.peers.get(peerId);
    if (pc) {
      try {
        // Check if we have a remote description
        if (pc.remoteDescription) {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } else {
          // Queue the candidate for later when remote description is set
          logger.debug(`Queueing ICE candidate for ${peerId} (no remote description yet)`);
          if (!this.pendingCandidates.has(peerId)) {
            this.pendingCandidates.set(peerId, []);
          }
          this.pendingCandidates.get(peerId).push(candidate);
        }
      } catch (error) {
        logger.error('Error adding ICE candidate:', error);
      }
    }
  }

  /**
   * Process queued ICE candidates after setting remote description
   */
  async processQueuedCandidates(peerId) {
    const pc = this.peers.get(peerId);
    const candidates = this.pendingCandidates.get(peerId);

    if (pc && candidates && candidates.length > 0) {
      logger.debug(`Processing ${candidates.length} queued ICE candidates for ${peerId}`);

      for (const candidate of candidates) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (error) {
          logger.error('Error adding queued ICE candidate:', error);
        }
      }

      // Clear the queue
      this.pendingCandidates.delete(peerId);
    }
  }

  /**
   * Send message to all connected peers with delivery confirmation
   */
  broadcast(message) {
    const messageStr = JSON.stringify(message);
    const messageSize = new Blob([messageStr]).size;
    let deliveredCount = 0;
    let attemptedCount = 0;
    let queuedCount = 0;

    // Get optimal peers for broadcast from Rust if available
    let targetPeers = [];
    if (window.safeWasm && window.safeWasm.get_best_peers_for_broadcast) {
      try {
        const bestPeers = window.safeWasm.get_best_peers_for_broadcast(10);
        if (bestPeers && bestPeers.length > 0) {
          targetPeers = bestPeers;
          logger.debug(`Broadcasting to ${targetPeers.length} optimal peers`);
        }
      } catch (e) {
        logger.warn('Failed to get optimal peers from Rust:', e);
      }
    }

    // Fallback to all peers if Rust optimization not available
    if (targetPeers.length === 0) {
      targetPeers = Array.from(this.dataChannels.keys());
      logger.debug(`Broadcasting message type '${message.type}' to ${targetPeers.length} peers`);
    }

    for (const peerId of targetPeers) {
      const channel = this.dataChannels.get(peerId);
      if (!channel) continue;

      attemptedCount++;

      if (channel.readyState === 'open') {
        // Check if we should send to this peer based on message priority
        const priority = message.priority || 5; // Default medium priority
        let shouldSend = true;

        if (window.safeWasm && window.safeWasm.should_send_to_peer) {
          try {
            shouldSend = window.safeWasm.should_send_to_peer(peerId, priority);
          } catch (e) {
            logger.warn(`Rust P2P check failed for ${peerId}:`, e);
            shouldSend = true; // Default to sending if check fails
          }
        }

        if (shouldSend) {
          try {
            channel.send(messageStr);
            deliveredCount++;

            // Record successful send in Rust
            if (window.safeWasm && window.safeWasm.record_peer_message_sent) {
              try {
                window.safeWasm.record_peer_message_sent(peerId, messageSize);
              } catch (e) {
                // Non-critical, continue
              }
            }
          } catch (error) {
            logger.error(`Error sending to ${peerId}:`, error);
            // Try to reconnect if send fails
            this.handleConnectionFailure(peerId);

            // Report failure to Rust
            if (window.safeWasm && window.safeWasm.handle_connection_failure) {
              try {
                window.safeWasm.handle_connection_failure(peerId);
              } catch (e) {
                // Non-critical
              }
            }
          }
        }
      } else {
        logger.debug(`Channel to ${peerId} not open: ${channel.readyState}`);

        // Queue message for later delivery
        if (window.safeWasm && window.safeWasm.queue_p2p_message) {
          try {
            const messageType = message.type || 'unknown';
            const priority = message.priority || 5;
            const messageId = window.safeWasm.queue_p2p_message(peerId, messageStr, messageType, priority);
            if (messageId) {
              queuedCount++;
            }
          } catch (e) {
            logger.warn(`Failed to queue message for ${peerId}:`, e);
          }
        }

        // Try to re-establish connection if channel is closed
        if (channel.readyState === 'closed') {
          logger.debug(`Attempting to re-establish connection to ${peerId}`);
          this.createPeerConnection(peerId, true).catch(err => {
            logger.error(`Failed to re-establish connection to ${peerId}:`, err);
          });
        }
      }
    }

    logger.debug(`Broadcast result: ${deliveredCount}/${attemptedCount} delivered, ${queuedCount} queued`);

    // If delivery rate is too low, there might be connection issues
    if (attemptedCount > 0 && deliveredCount / attemptedCount < 0.5) {
      logger.warn(`Low delivery rate: ${deliveredCount}/${attemptedCount} - possible connection issues`);
    }

    return deliveredCount;
  }

  /**
   * Send message to specific peer
   */
  sendToPeer(peerId, message) {
    const channel = this.dataChannels.get(peerId);

    if (channel && channel.readyState === 'open') {
      try {
        const messageStr = JSON.stringify(message);
        logger.debug(`Sending ${message.type} to ${peerId}`);
        channel.send(messageStr);
      } catch (error) {
        logger.error(`Error sending to ${peerId}:`, error);
      }
    } else {
      logger.warn(`Cannot send to ${peerId}: channel state = ${channel ? channel.readyState : 'no-channel'}`);
    }
  }

  /**
   * Send signaling message
   */
  sendSignalingMessage(message) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  /**
   * Remove peer connection
   */
  removePeer(peerId) {
    const channel = this.dataChannels.get(peerId);
    if (channel) {
      channel.close();
      this.dataChannels.delete(peerId);
    }

    const pc = this.peers.get(peerId);
    if (pc) {
      pc.close();
      this.peers.delete(peerId);
    }

    // Clean up any pending ICE candidates
    this.pendingCandidates.delete(peerId);

    // Remove from Rust P2P manager
    if (window.safeWasm) {
      try {
        if (window.safeWasm.remove_peer_from_network) {
          window.safeWasm.remove_peer_from_network(peerId);
        }
        // Remove from connected peers in state API
        if (window.safeWasm.remove_connected_peer) {
          window.safeWasm.remove_connected_peer(peerId);
        }
        logger.debug(`Removed peer ${peerId} from Rust P2P manager`);
      } catch (e) {
        logger.error(`Failed to remove peer ${peerId} from Rust:`, e);
      }
    }

    if (this.onPeerDisconnectedCallback) {
      this.onPeerDisconnectedCallback(peerId);
    }
  }

  /**
   * Disconnect from all peers and signaling server
   */
  disconnect() {
    // Clear mesh monitoring
    if (this.meshCheckInterval) {
      clearInterval(this.meshCheckInterval);
      this.meshCheckInterval = null;
    }

    // Send leave message
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'leave' }));
      this.ws.close();
    }

    // Close all peer connections
    this.peers.forEach((pc, peerId) => {
      this.removePeer(peerId);
    });

    // Clear known peers
    this.allKnownPeers.clear();
  }

  /**
   * Set callback for incoming messages
   */
  onMessage(callback) {
    this.onMessageCallback = callback;
  }

  /**
   * Set callback for peer connection events
   */
  onPeerConnected(callback) {
    this.onPeerConnectedCallback = callback;
  }

  /**
   * Set callback for peer disconnection events
   */
  onPeerDisconnected(callback) {
    this.onPeerDisconnectedCallback = callback;
  }

  /**
   * Set callback for connection loss events
   */
  onConnectionLost(callback) {
    this.onConnectionLostCallback = callback;
  }

  /**
   * Handle connection failure with retry logic
   */
  handleConnectionFailure(peerId) {
    logger.info(`Handling connection failure for ${peerId}`);
    const pc = this.peers.get(peerId);
    if (pc && (pc.connectionState === 'failed' || pc.connectionState === 'disconnected')) {
      logger.debug(`Attempting ICE restart for ${peerId}`);

      try {
        // First try ICE restart if supported
        if (pc.connectionState === 'failed' && pc.iceConnectionState !== 'closed') {
          pc.restartIce();

          // Give ICE restart a chance to work (5 seconds)
          setTimeout(() => {
            if (pc.connectionState === 'failed') {
              logger.warn(`ICE restart failed for ${peerId}, removing peer`);
              this.removePeer(peerId);
            }
          }, 5000);
          return;
        }
      } catch (error) {
        logger.error(`ICE restart failed for ${peerId}:`, error);
      }

      // Remove peer if ICE restart not possible or failed
      this.removePeer(peerId);
    }
  }

  /**
   * Execute connection plan from Rust P2P manager
   */
  async executeConnectionPlan(plan) {
    if (!plan || !Array.isArray(plan)) {
      logger.warn('Invalid connection plan:', plan);
      return;
    }

    for (const decision of plan) {
      if (decision && decision.should_connect) {
        const delay = decision.delay_ms || 500;
        logger.debug(`Scheduled connection to ${decision.peer_id || 'unknown'} (priority: ${decision.priority}, delay: ${delay}ms)`);

        setTimeout(async () => {
          try {
            const peerId = decision.peer_id || decision.peerId; // Handle both naming conventions
            if (peerId) {
              await this.createPeerConnection(peerId, true);
            }
          } catch (error) {
            logger.error(`Failed to execute connection plan for peer:`, error);
            if (window.safeWasm && window.safeWasm.handle_connection_failure && decision.peer_id) {
              window.safeWasm.handle_connection_failure(decision.peer_id);
            }
          }
        }, delay);
      }
    }
  }

  /**
   * Start periodic mesh monitoring
   */
  startMeshMonitoring() {
    // Clear any existing interval
    if (this.meshCheckInterval) {
      clearInterval(this.meshCheckInterval);
    }

    // Check mesh every 10 seconds
    this.meshCheckInterval = setInterval(() => {
      // Use Rust mesh repair if available
      if (window.safeWasm && window.safeWasm.needs_mesh_repair) {
        try {
          if (window.safeWasm.needs_mesh_repair()) {
            logger.debug('Mesh repair needed, getting repair plan');
            const repairPlan = window.safeWasm.get_mesh_repair_plan();
            this.executeConnectionPlan(repairPlan);
          }

          // Clean up stale peers
          const removedCount = window.safeWasm.cleanup_stale_peers(5); // 5 minute timeout
          if (removedCount > 0) {
            logger.info(`Cleaned up ${removedCount} stale peers`);
          }

          // Log network stats
          const stats = window.safeWasm.get_p2p_network_stats();
          if (stats) {
            logger.debug('Network stats:', stats);
          }
        } catch (error) {
          logger.warn('Failed to use Rust mesh monitoring:', error);
          // Fallback to JS mesh checking
          const expectedPeers = Array.from(this.allKnownPeers);
          if (expectedPeers.length > 0) {
            logger.debug('JS Fallback: Periodic mesh check');
            this.ensureFullMesh(expectedPeers);
          }
        }
      } else {
        // Original JS mesh checking
        const expectedPeers = Array.from(this.allKnownPeers);
        if (expectedPeers.length > 0) {
          logger.debug('Periodic mesh check');
          this.ensureFullMesh(expectedPeers);
        }
      }
    }, 10000);
  }

  /**
   * Ensure full mesh connectivity by checking for missing connections
   */
  async ensureFullMesh(expectedPeers) {
    logger.debug('Ensuring full mesh connectivity');

    const connectedPeers = this.getConnectedPeers();
    const allExpectedPeers = [...expectedPeers];

    logger.debug('Expected peers:', allExpectedPeers.length);
    logger.debug('Currently connected:', connectedPeers.length);

    // Find missing connections
    const missingConnections = allExpectedPeers.filter(peerId =>
      !connectedPeers.includes(peerId) && peerId !== this.clientId
    );

    if (missingConnections.length > 0) {
      logger.info('Found missing connections:', missingConnections.length);

      for (const peerId of missingConnections) {
        try {
          logger.debug(`Attempting to establish missing connection to ${peerId}`);
          await this.createPeerConnection(peerId, true);
        } catch (error) {
          logger.error(`Failed to establish missing connection to ${peerId}:`, error);
        }
      }
    } else {
      logger.debug('Full mesh connectivity confirmed');
    }

    // Log final connection status
    setTimeout(() => {
      const finalConnected = this.getConnectedPeers();
      logger.info(`Mesh status: ${finalConnected.length}/${allExpectedPeers.length} peers connected`);
    }, 3000);
  }

  /**
   * Get list of connected peer IDs
   */
  getConnectedPeers() {
    // First try to get from WASM state
    if (window.safeWasm && window.safeWasm.get_connected_peers) {
      try {
        const peers = window.safeWasm.get_connected_peers();
        if (peers && Array.isArray(peers)) {
          return peers;
        }
      } catch (error) {
        logger.error('Failed to get connected peers from WASM:', error);
      }
    }

    // Fallback to checking local data channels
    const connected = [];
    this.dataChannels.forEach((channel, peerId) => {
      if (channel.readyState === 'open') {
        connected.push(peerId);
      }
    });
    return connected;
  }
}