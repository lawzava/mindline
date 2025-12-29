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
    this.relayPeers = new Set(); // Peers where P2P failed, use WebSocket relay

    // Build ICE servers from configuration
    this.iceConfig = this.buildIceConfig();
  }

  /**
   * Build ICE configuration with STUN and optional TURN servers
   */
  buildIceConfig() {
    // Start with STUN servers
    const iceServers = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ];

    // Add TURN servers if configured (required for NAT traversal behind firewalls)
    const config = window.MINDLINE_CONFIG || {};
    if (config.TURN_SERVERS && Array.isArray(config.TURN_SERVERS)) {
      iceServers.push(...config.TURN_SERVERS);
      logger.info('P2P: TURN servers configured:', config.TURN_SERVERS.length);
    } else {
      logger.warn('P2P: No TURN servers configured - connections may fail behind NAT/firewalls');
    }

    return {
      iceServers,
      iceCandidatePoolSize: 10,
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
      iceTransportPolicy: 'all',
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
      case 'client-id':
        // Server assigns a secure client ID to prevent spoofing
        logger.info('Received server-assigned client ID');
        this.serverClientId = message.clientId;
        break;

      case 'room-joined':
        // Update to server-assigned ID if provided (security enhancement)
        if (message.yourId) {
          this.serverClientId = message.yourId;
          logger.info('Using server-assigned ID:', message.yourId.slice(0, 8) + '...');
        }
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

      case 'relay':
        // Handle relayed message (P2P fallback via WebSocket)
        logger.debug('Received relay message from:', message.fromId);
        if (this.onMessageCallback && message.data) {
          try {
            this.onMessageCallback(message.data, message.fromId);
          } catch (error) {
            logger.error('Error handling relay message:', error);
          }
        }
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
      }
    };

    dataChannel.onerror = (error) => {
      logger.error(`Data channel error with ${peerId}:`, error);

      // Don't immediately remove peer for "User-Initiated Abort" errors
      if (error.error?.name === 'OperationError' && error.error?.message?.includes('User-Initiated Abort')) {
        return;
      }

      this.handleConnectionFailure(peerId);
    };

    dataChannel.onclose = () => {
      logger.info(`Data channel closed with ${peerId}`);
      this.dataChannels.delete(peerId);
      if (this.onPeerDisconnectedCallback) {
        this.onPeerDisconnectedCallback(peerId);
      }
    };

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
   * Send message to all connected peers (P2P + relay fallback)
   */
  broadcast(message) {
    let successCount = 0;

    // Send via P2P data channels
    for (const [peerId, channel] of this.dataChannels.entries()) {
      if (channel.readyState === 'open') {
        try {
          channel.send(JSON.stringify(message));
          successCount++;
        } catch (error) {
          logger.warn(`P2P send failed to ${peerId}, switching to relay:`, error);
          this.relayPeers.add(peerId);
          this.handleConnectionFailure(peerId);
        }
      }
    }

    // Send via WebSocket relay for peers without P2P
    for (const peerId of this.relayPeers) {
      if (peerId !== this.clientId && this.allKnownPeers.has(peerId)) {
        this.sendRelay(message, peerId);
        successCount++;
      }
    }

    // Also relay to any known peers not in dataChannels (P2P never established)
    for (const peerId of this.allKnownPeers) {
      if (peerId !== this.clientId &&
          !this.dataChannels.has(peerId) &&
          !this.relayPeers.has(peerId)) {
        this.sendRelay(message, peerId);
        successCount++;
      }
    }

    logger.debug(`Broadcast: ${successCount} delivered (P2P + relay)`);
    return successCount;
  }

  /**
   * Send message via WebSocket relay (fallback when P2P fails)
   */
  sendRelay(message, targetId = null) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const relayMessage = {
        type: 'relay',
        data: message,
        targetId: targetId
      };
      this.ws.send(JSON.stringify(relayMessage));
      logger.debug(`Relay sent to ${targetId || 'all'}`);
    }
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
   * Remove peer connection and clean up all resources
   */
  removePeer(peerId) {
    const channel = this.dataChannels.get(peerId);
    if (channel) {
      // Null handlers before closing to prevent memory leaks
      channel.onopen = null;
      channel.onmessage = null;
      channel.onerror = null;
      channel.onclose = null;
      try {
        channel.close();
      } catch (e) {
        // Ignore errors on already-closed channels
      }
      this.dataChannels.delete(peerId);
    }

    const pc = this.peers.get(peerId);
    if (pc) {
      // Null handlers before closing to prevent memory leaks
      pc.onicecandidate = null;
      pc.ondatachannel = null;
      pc.onconnectionstatechange = null;
      pc.oniceconnectionstatechange = null;
      pc.onicegatheringstatechange = null;
      pc.onsignalingstatechange = null;
      pc.onnegotiationneeded = null;
      try {
        pc.close();
      } catch (e) {
        // Ignore errors on already-closed connections
      }
      this.peers.delete(peerId);
    }

    this.pendingCandidates.delete(peerId);
    this.relayPeers.delete(peerId);
    this.allKnownPeers.delete(peerId);

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
   * Start periodic mesh monitoring
   */
  startMeshMonitoring() {
    if (this.meshCheckInterval) {
      clearInterval(this.meshCheckInterval);
    }

    this.meshCheckInterval = setInterval(() => {
      const knownPeers = Array.from(this.allKnownPeers);
      for (const peerId of knownPeers) {
        if (peerId !== this.clientId && !this.dataChannels.has(peerId)) {
          this.createPeerConnection(peerId, true);
        }
      }
    }, 10000);
  }

  /**
   * Ensure full mesh connectivity
   */
  ensureFullMesh(expectedPeers) {
    const connectedPeers = this.getConnectedPeers();
    const missing = expectedPeers.filter(peerId =>
      !connectedPeers.includes(peerId) && peerId !== this.clientId
    );

    for (const peerId of missing) {
      this.createPeerConnection(peerId, true);
    }
  }

  /**
   * Get list of connected peer IDs
   */
  getConnectedPeers() {
    return Array.from(this.dataChannels.entries())
      .filter(([_, channel]) => channel.readyState === 'open')
      .map(([peerId]) => peerId);
  }
}