/**
 * WebRTC P2P Connection Manager
 */

export class P2PConnection {
  constructor(clientId, roomId, signalServer) {
    // Validate clientId to prevent corruption
    // Allow test IDs (starting with 'test-') or regular IDs (>= 10 chars)
    const isTestId = typeof clientId === 'string' && clientId.startsWith('test-');
    const isValidRegularId = typeof clientId === 'string' && clientId.length >= 10;

    if (typeof clientId !== 'string' || clientId.includes(',') || (!isTestId && !isValidRegularId)) {
      console.error('🚨 Invalid clientId detected:', clientId, 'type:', typeof clientId);
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
          console.log('🔵 P2P: No signaling server configured - running in local mode');
          reject(new Error('No signaling server configured'));
          return;
        }

        const protocol = config.USE_SSL ? 'wss:' : 'ws:';
        const path = config.WEBSOCKET_PATH;
        const wsUrl = `${protocol}//${host}${path}`;

        console.log(`🔵 P2P CONNECT: Connecting to signaling server at ${wsUrl}`);
        console.log(`🔵 Client ID: ${this.clientId}`);
        console.log(`🔵 Room ID: ${this.roomId}`);
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
          console.log('Connected to signaling server');
          // Join room
          this.ws.send(JSON.stringify({
            type: 'join',
            roomId: this.roomId,
            clientId: this.clientId
          }));
        };

        this.ws.onmessage = (event) => {
          console.log(`🔵 SIGNALING: Received message:`, event.data);
          const message = JSON.parse(event.data);
          console.log(`🔵 SIGNALING: Parsed message:`, message);
          // Don't await - handle async to avoid blocking WebSocket event loop
          this.handleSignalingMessage(message).catch(error => {
            console.error('Error handling signaling message:', error);
          });
        };

        this.ws.onerror = (error) => {
          console.error('WebSocket error:', error);
          reject(error);
        };

        this.ws.onclose = () => {
          console.log('Disconnected from signaling server');
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
        console.log('Joined room:', message.roomId, 'with existing peers:', message.peers);

        // Track all known peers
        message.peers.forEach(peerId => this.allKnownPeers.add(peerId));

        // Connect to ALL existing peers (I'm the new joiner, so I initiate all connections)
        for (let i = 0; i < message.peers.length; i++) {
          const peerId = message.peers[i];
          // Stagger connection attempts to reduce race conditions
          setTimeout(async () => {
            try {
              console.log(`🔗 New user connecting to existing peer ${i + 1}/${message.peers.length}:`, peerId);
              await this.createPeerConnection(peerId, true); // Always initiate as the new joiner
            } catch (error) {
              console.error(`❌ Failed to connect to existing peer ${peerId}:`, error);
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
        console.log('Peer joined:', message.clientId);
        // New peer joined - track them and ensure connection
        if (message.clientId !== this.clientId) {
          // Add to known peers
          this.allKnownPeers.add(message.clientId);

          // Use a small delay and string comparison to avoid duplicate offers
          const shouldInitiate = this.clientId > message.clientId;
          const delay = shouldInitiate ? 500 : 1500; // Stagger by priority

          console.log(`Will ${shouldInitiate ? 'initiate' : 'wait for'} connection to new peer:`, message.clientId, `(delay: ${delay}ms)`);

          setTimeout(async () => {
            try {
              // Check if connection already exists (might have been created by the other peer)
              if (!this.peers.has(message.clientId) ||
                  ['failed', 'closed', 'disconnected'].includes(this.peers.get(message.clientId).connectionState)) {
                console.log(`🔗 Creating connection to new peer ${message.clientId}`);
                await this.createPeerConnection(message.clientId, shouldInitiate);
              } else {
                console.log(`✅ Connection to ${message.clientId} already exists`);
              }
            } catch (error) {
              console.error(`Failed to connect to new peer ${message.clientId}:`, error);
            }
          }, delay);
        }
        break;

      case 'offer':
        console.log('Received offer from:', message.fromId);
        await this.handleOffer(message.fromId, message.data);
        break;

      case 'answer':
        console.log('Received answer from:', message.fromId);
        await this.handleAnswer(message.fromId, message.data);
        break;

      case 'ice-candidate':
        console.log('Received ICE candidate from:', message.fromId);
        await this.handleIceCandidate(message.fromId, message.data);
        break;

      case 'peer-left':
        console.log('Peer left:', message.clientId);
        this.removePeer(message.clientId);
        break;
    }
  }

  /**
   * Create a peer connection
   */
  async createPeerConnection(peerId, createOffer = false) {
    console.log(`Creating peer connection to ${peerId}, createOffer: ${createOffer}`);

    // Check if connection already exists
    if (this.peers.has(peerId)) {
      const existingPc = this.peers.get(peerId);
      console.log(`Peer connection already exists for ${peerId} in state: ${existingPc.signalingState}/${existingPc.connectionState}`);

      // If connection is connecting/connected and healthy, skip
      if (['connecting', 'connected'].includes(existingPc.connectionState)) {
        console.log(`Skipping duplicate connection to ${peerId}, already connected`);
        return;
      }

      // If connection is failed/closed/disconnected, clean up and recreate
      if (['failed', 'closed', 'disconnected'].includes(existingPc.connectionState)) {
        console.log(`Removing failed connection to ${peerId}, will recreate`);
        this.removePeer(peerId);
      } else if (createOffer && existingPc.signalingState !== 'stable') {
        // Wait for existing negotiation to complete
        console.log(`Waiting for existing negotiation with ${peerId} to complete`);
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
      console.log(`🔗 Creating data channel for peer ${peerId} (we are initiator)`);
      const dataChannel = pc.createDataChannel('chat', {
        ordered: true,
        maxRetransmits: 3,
        maxRetransmitTime: 3000 // 3 seconds timeout
      });
      console.log(`📊 Data channel created, initial state: ${dataChannel.readyState}`);
      this.setupDataChannel(dataChannel, peerId);
    } else {
      console.log(`⏳ Waiting for data channel from ${peerId} (they are initiator)`);
    }

    // Also listen for incoming data channel from remote peer
    pc.ondatachannel = (event) => {
      console.log(`📥 Received data channel from ${peerId}`);
      console.log(`📊 Data channel state: ${event.channel.readyState}, ordered: ${event.channel.ordered}`);
      // ALWAYS use the received data channel for bidirectional communication
      console.log(`🔄 Using received data channel for ${peerId} (replacing any existing)`);

      // Close existing channel if any to prevent conflicts
      if (this.dataChannels.has(peerId)) {
        console.log(`🧹 Closing existing data channel for ${peerId}`);
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

        console.log(`📤 Sending offer to ${peerId}`);
        this.sendSignalingMessage({
          type: 'offer',
          targetId: peerId,
          data: offer
        });

        // Set timeout for offer response
        setTimeout(() => {
          if (pc.signalingState === 'have-local-offer') {
            console.log(`⏰ Offer to ${peerId} timed out - restarting connection`);
            this.removePeer(peerId);
            // Retry connection after cleanup
            setTimeout(() => this.createPeerConnection(peerId, true), 2000);
          }
        }, 15000); // 15 second timeout (more generous)
      } catch (error) {
        console.error(`Failed to create offer for ${peerId}:`, error);
        this.removePeer(peerId);
      }
    }

    // Handle connection state changes with more detailed logging
    pc.onconnectionstatechange = () => {
      console.log(`Connection state with ${peerId}:`, pc.connectionState, `(signaling: ${pc.signalingState})`);

      if (pc.connectionState === 'connected') {
        console.log(`✅ Successfully connected to peer ${peerId}`);
        // Clear any pending reconnection attempts for this peer
      } else if (pc.connectionState === 'failed') {
        console.log(`❌ Connection failed with peer ${peerId}`);
        // Clean up failed connection immediately, let main reconnection logic handle it
        this.removePeer(peerId);
        if (this.onPeerDisconnectedCallback) {
          this.onPeerDisconnectedCallback(peerId);
        }
      } else if (pc.connectionState === 'disconnected') {
        console.log(`⚠️ Peer ${peerId} disconnected, removing connection`);
        this.removePeer(peerId);
      }
    };

    // Handle ICE connection state changes
    pc.oniceconnectionstatechange = () => {
      console.log(`ICE connection state with ${peerId}:`, pc.iceConnectionState);

      if (pc.iceConnectionState === 'failed') {
        console.log(`ICE connection failed with ${peerId}, will restart ICE`);
        try {
          pc.restartIce();
        } catch (error) {
          console.error(`Failed to restart ICE for ${peerId}:`, error);
        }
      }
    };
  }

  /**
   * Setup data channel event handlers
   */
  setupDataChannel(dataChannel, peerId) {
    console.log(`🔧 SETTING UP DATA CHANNEL for ${peerId}`);
    console.log(`🔧 Data channel state: ${dataChannel.readyState}`);

    dataChannel.onopen = () => {
      console.log(`Data channel opened with ${peerId}`);
      this.dataChannels.set(peerId, dataChannel);

      // Register peer with Rust P2P coordination
      if (window.safeWasm) {
        try {
          console.log(`🎯 Registering peer ${peerId} with Rust P2P manager`);

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
          console.error(`Failed to register peer ${peerId} with Rust:`, e);
        }
      }

      if (this.onPeerConnectedCallback) {
        this.onPeerConnectedCallback(peerId);
      }
    };

    console.log(`🔧 ATTACHING onmessage handler for ${peerId}`);
    dataChannel.onmessage = (event) => {
      console.log(`🔴 LOWEST LEVEL: WebRTC data channel onmessage triggered`);
      console.log(`🔴 Peer ID: ${peerId}`);
      console.log(`🔴 Raw event:`, event);
      console.log(`🔴 Raw event.data:`, event.data);
      console.log(`🔴 Raw event.data type:`, typeof event.data);
      console.log(`🔴 Raw event.data length:`, event.data ? event.data.length : 'null');

      if (this.onMessageCallback) {
        console.log(`🔴 onMessageCallback exists:`, this.onMessageCallback);
        console.log(`🔴 typeof onMessageCallback:`, typeof this.onMessageCallback);
        console.log(`🔴 Attempting JSON parse...`);
        try {
          const message = JSON.parse(event.data);
          console.log(`📨 PARSED MESSAGE from ${peerId}:`, message);

          // Extra debugging for chat messages
          if (message.type === 'chat') {
            console.log(`🎯 CHAT MESSAGE RECEIVED - calling onMessageCallback:`, message.id, message.content);
          }

          this.onMessageCallback(message, peerId);
          console.log(`✅ MESSAGE CALLBACK COMPLETED for ${peerId}`);
        } catch (error) {
          console.error('❌ ERROR PARSING MESSAGE:', error, 'Raw data:', event.data);
        }
      } else {
        console.error(`❌ NO onMessageCallback REGISTERED - dropping message from ${peerId}`);
      }
    };

    dataChannel.onerror = (error) => {
      console.error(`Data channel error with ${peerId}:`, error);
      console.error(`Error type: ${error.error?.name}, message: ${error.error?.message}`);

      // Don't immediately remove peer for "User-Initiated Abort" errors
      if (error.error?.name === 'OperationError' && error.error?.message?.includes('User-Initiated Abort')) {
        console.log(`🔧 Ignoring User-Initiated Abort error for ${peerId} - keeping connection`);
        return;
      }

      // Only handle connection failure for serious errors
      console.log(`🚨 Serious data channel error, handling connection failure for ${peerId}`);
      this.handleConnectionFailure(peerId);
    };

    dataChannel.onclose = () => {
      console.log(`Data channel closed with ${peerId}`);
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
          console.log(`Already connected to ${peerId}, ignoring duplicate offer`);
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
        console.log(`Offer collision detected with peer ${peerId}`);

        // Compare client IDs lexicographically to determine who should back down
        if (this.clientId > peerId) {
          // We have higher priority, ignore their offer
          console.log(`Ignoring offer from ${peerId} (we have priority)`);
          return;
        } else {
          // They have higher priority, we need to restart
          console.log(`Restarting connection for ${peerId} (they have priority)`);

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
            console.error(`Error resolving offer collision with ${peerId}:`, collisionError);
            // Clean up and let reconnection logic handle it
            this.removePeer(peerId);
            return;
          }
        }
      } else {
        console.warn(`Cannot handle offer in state ${pc.signalingState} for peer ${peerId}`);
      }
    } catch (error) {
      console.error(`Error handling offer from ${peerId}:`, error);
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
          console.error(`Error setting remote answer for ${peerId}:`, error);
          console.log('Current signaling state:', pc.signalingState);
        }
      } else {
        console.warn(`Received answer in wrong state (${pc.signalingState}) for peer ${peerId}`);
      }
    } else {
      console.warn(`No peer connection found for ${peerId}`);
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
          console.log(`Queueing ICE candidate for ${peerId} (no remote description yet)`);
          if (!this.pendingCandidates.has(peerId)) {
            this.pendingCandidates.set(peerId, []);
          }
          this.pendingCandidates.get(peerId).push(candidate);
        }
      } catch (error) {
        console.error('Error adding ICE candidate:', error);
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
      console.log(`Processing ${candidates.length} queued ICE candidates for ${peerId}`);

      for (const candidate of candidates) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (error) {
          console.error('Error adding queued ICE candidate:', error);
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
          console.log(`📡 Broadcasting to ${targetPeers.length} optimal peers selected by Rust`);
        }
      } catch (e) {
        console.warn('Failed to get optimal peers from Rust:', e);
      }
    }

    // Fallback to all peers if Rust optimization not available
    if (targetPeers.length === 0) {
      targetPeers = Array.from(this.dataChannels.keys());
      console.log(`📡 Broadcasting message type '${message.type}' to ${targetPeers.length} channels`);
    }

    for (const peerId of targetPeers) {
      const channel = this.dataChannels.get(peerId);
      if (!channel) continue;

      attemptedCount++;
      console.log(`📤 ATTEMPTING TO SEND to ${peerId}, channel state: ${channel.readyState}`);

      if (channel.readyState === 'open') {
        // Check if we should send to this peer based on message priority
        const priority = message.priority || 5; // Default medium priority
        let shouldSend = true;

        if (window.safeWasm && window.safeWasm.should_send_to_peer) {
          try {
            shouldSend = window.safeWasm.should_send_to_peer(peerId, priority);
            console.log(`🔍 Rust P2P check for ${peerId}: shouldSend=${shouldSend}, priority=${priority}`);
          } catch (e) {
            console.warn(`⚠️ Rust P2P check failed for ${peerId}:`, e);
            shouldSend = true; // Default to sending if check fails
          }
        }

        if (shouldSend) {
          try {
            console.log(`📤 SENDING RAW DATA to ${peerId}:`, messageStr);
            channel.send(messageStr);
            deliveredCount++;
            console.log(`✅ Message sent to ${peerId}`);

            // Record successful send in Rust
            if (window.safeWasm && window.safeWasm.record_peer_message_sent) {
              try {
                window.safeWasm.record_peer_message_sent(peerId, messageSize);
              } catch (e) {
                // Non-critical, continue
              }
            }
          } catch (error) {
            console.error(`❌ Error sending to ${peerId}:`, error);
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
        console.warn(`⚠️ Channel to ${peerId} not open: ${channel.readyState}`);

        // Queue message for later delivery
        if (window.safeWasm && window.safeWasm.queue_p2p_message) {
          try {
            const messageType = message.type || 'unknown';
            const priority = message.priority || 5;
            const messageId = window.safeWasm.queue_p2p_message(peerId, messageStr, messageType, priority);
            if (messageId) {
              queuedCount++;
              console.log(`📥 Message queued for ${peerId} with ID: ${messageId}`);
            }
          } catch (e) {
            console.warn(`Failed to queue message for ${peerId}:`, e);
          }
        }

        // Try to re-establish connection if channel is closed
        if (channel.readyState === 'closed') {
          console.log(`🔄 Attempting to re-establish connection to ${peerId}`);
          this.createPeerConnection(peerId, true).catch(err => {
            console.error(`Failed to re-establish connection to ${peerId}:`, err);
          });
        }
      }
    }

    console.log(`📊 Broadcast result: ${deliveredCount}/${attemptedCount} delivered, ${queuedCount} queued`);

    // If delivery rate is too low, there might be connection issues
    if (attemptedCount > 0 && deliveredCount / attemptedCount < 0.5) {
      console.warn(`🚨 Low delivery rate: ${deliveredCount}/${attemptedCount} - possible connection issues`);
    }

    // Display queue status if messages were queued
    if (queuedCount > 0 && window.safeWasm && window.safeWasm.get_p2p_queue_status) {
      try {
        const queueStatus = window.safeWasm.get_p2p_queue_status();
        console.log(`📦 Queue status: ${queueStatus.pending} pending, ${queueStatus.highPriority} high priority`);
      } catch (e) {
        // Non-critical
      }
    }

    return deliveredCount;
  }

  /**
   * Send message to specific peer
   */
  sendToPeer(peerId, message) {
    const channel = this.dataChannels.get(peerId);
    console.log(`🔌 Sending to ${peerId}, channel state: ${channel ? channel.readyState : 'no-channel'}, message type: ${message.type}`);

    if (channel && channel.readyState === 'open') {
      try {
        const messageStr = JSON.stringify(message);
        console.log(`📤 Actually sending to ${peerId}:`, messageStr.substring(0, 100) + '...');
        channel.send(messageStr);
      } catch (error) {
        console.error(`Error sending to ${peerId}:`, error);
      }
    } else {
      console.warn(`❌ Cannot send to ${peerId}: channel state = ${channel ? channel.readyState : 'no-channel'}`);
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
        console.log(`🧹 Removed peer ${peerId} from Rust P2P manager`);
      } catch (e) {
        console.error(`Failed to remove peer ${peerId} from Rust:`, e);
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
    console.log(`Handling connection failure for ${peerId}`);
    const pc = this.peers.get(peerId);
    if (pc && (pc.connectionState === 'failed' || pc.connectionState === 'disconnected')) {
      console.log(`🔄 Attempting ICE restart for ${peerId} before removing`);

      try {
        // First try ICE restart if supported
        if (pc.connectionState === 'failed' && pc.iceConnectionState !== 'closed') {
          pc.restartIce();

          // Give ICE restart a chance to work (5 seconds)
          setTimeout(() => {
            if (pc.connectionState === 'failed') {
              console.log(`🚫 ICE restart failed for ${peerId}, removing peer`);
              this.removePeer(peerId);
            }
          }, 5000);
          return;
        }
      } catch (error) {
        console.error(`ICE restart failed for ${peerId}:`, error);
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
      console.warn('Invalid connection plan:', plan);
      return;
    }

    for (const decision of plan) {
      if (decision && decision.should_connect) {
        const delay = decision.delay_ms || 500;
        console.log(`📋 Scheduled connection to ${decision.peer_id || 'unknown'} (priority: ${decision.priority}, delay: ${delay}ms)`);

        setTimeout(async () => {
          try {
            const peerId = decision.peer_id || decision.peerId; // Handle both naming conventions
            if (peerId) {
              await this.createPeerConnection(peerId, true);
            }
          } catch (error) {
            console.error(`Failed to execute connection plan for peer:`, error);
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
            console.log('🔍 Rust: Mesh repair needed, getting repair plan...');
            const repairPlan = window.safeWasm.get_mesh_repair_plan();
            this.executeConnectionPlan(repairPlan);
          }

          // Clean up stale peers
          const removedCount = window.safeWasm.cleanup_stale_peers(5); // 5 minute timeout
          if (removedCount > 0) {
            console.log(`🧹 Cleaned up ${removedCount} stale peers`);
          }

          // Log network stats
          const stats = window.safeWasm.get_p2p_network_stats();
          if (stats) {
            console.log('📊 Network stats:', stats);
          }
        } catch (error) {
          console.warn('Failed to use Rust mesh monitoring:', error);
          // Fallback to JS mesh checking
          const expectedPeers = Array.from(this.allKnownPeers);
          if (expectedPeers.length > 0) {
            console.log('🔍 JS Fallback: Periodic mesh check...');
            this.ensureFullMesh(expectedPeers);
          }
        }
      } else {
        // Original JS mesh checking
        const expectedPeers = Array.from(this.allKnownPeers);
        if (expectedPeers.length > 0) {
          console.log('🔍 Periodic mesh check...');
          this.ensureFullMesh(expectedPeers);
        }
      }
    }, 10000);
  }

  /**
   * Ensure full mesh connectivity by checking for missing connections
   */
  async ensureFullMesh(expectedPeers) {
    console.log('🕸️ Ensuring full mesh connectivity...');

    const connectedPeers = this.getConnectedPeers();
    const allExpectedPeers = [...expectedPeers];

    console.log('Expected peers:', allExpectedPeers);
    console.log('Currently connected:', connectedPeers);

    // Find missing connections
    const missingConnections = allExpectedPeers.filter(peerId =>
      !connectedPeers.includes(peerId) && peerId !== this.clientId
    );

    if (missingConnections.length > 0) {
      console.log('🔧 Found missing connections:', missingConnections);

      for (const peerId of missingConnections) {
        try {
          console.log(`🔗 Attempting to establish missing connection to ${peerId}`);
          await this.createPeerConnection(peerId, true);
        } catch (error) {
          console.error(`❌ Failed to establish missing connection to ${peerId}:`, error);
        }
      }
    } else {
      console.log('✅ Full mesh connectivity confirmed');
    }

    // Log final connection status
    setTimeout(() => {
      const finalConnected = this.getConnectedPeers();
      console.log(`📊 Final mesh status: ${finalConnected.length}/${allExpectedPeers.length} peers connected`);
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
        console.error('Failed to get connected peers from WASM:', error);
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