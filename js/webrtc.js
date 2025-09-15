/**
 * WebRTC P2P Connection Manager
 */

export class P2PConnection {
  constructor(clientId, roomId, signalServer) {
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
      iceCandidatePoolSize: 10 // Better for mobile connections
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

        const protocol = config.USE_SSL ? 'wss:' : 'ws:';
        const host = config.SIGNALING_SERVER;
        const path = config.WEBSOCKET_PATH;

        const wsUrl = `${protocol}//${host}${path}`;

        console.log(`Connecting to signaling server at ${wsUrl}`);
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

        this.ws.onmessage = async (event) => {
          const message = JSON.parse(event.data);
          await this.handleSignalingMessage(message);
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
          }, i * 1000); // 1 second delay between each connection
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

    // Create data channel with mobile-friendly settings
    if (createOffer) {
      const dataChannel = pc.createDataChannel('chat', {
        ordered: true,
        maxRetransmits: 3,
        maxRetransmitTime: 3000 // 3 seconds timeout
      });
      this.setupDataChannel(dataChannel, peerId);

      // Create and send offer with error handling
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
            console.log(`⏰ Offer to ${peerId} timed out`);
          }
        }, 10000); // 10 second timeout
      } catch (error) {
        console.error(`Failed to create offer for ${peerId}:`, error);
        this.removePeer(peerId);
      }
    } else {
      // Wait for data channel from remote peer
      pc.ondatachannel = (event) => {
        console.log(`📥 Received data channel from ${peerId}`);
        this.setupDataChannel(event.channel, peerId);
      };
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
    dataChannel.onopen = () => {
      console.log(`Data channel opened with ${peerId}`);
      this.dataChannels.set(peerId, dataChannel);
      if (this.onPeerConnectedCallback) {
        this.onPeerConnectedCallback(peerId);
      }
    };

    dataChannel.onmessage = (event) => {
      if (this.onMessageCallback) {
        try {
          const message = JSON.parse(event.data);
          console.log(`Received message from ${peerId}:`, message);

          // Extra debugging for chat messages
          if (message.type === 'chat') {
            console.log(`🎯 CHAT MESSAGE RECEIVED in WebRTC layer:`, message.id, message.content);
          }

          this.onMessageCallback(message, peerId);
        } catch (error) {
          console.error('Error parsing message:', error, 'Raw data:', event.data);
        }
      } else {
        console.warn(`No onMessageCallback registered, dropping message from ${peerId}`);
      }
    };

    dataChannel.onerror = (error) => {
      console.error(`Data channel error with ${peerId}:`, error);
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
    let deliveredCount = 0;
    let attemptedCount = 0;

    console.log(`📡 Broadcasting message type '${message.type}' to ${this.dataChannels.size} channels`);

    this.dataChannels.forEach((channel, peerId) => {
      attemptedCount++;

      if (channel.readyState === 'open') {
        try {
          channel.send(messageStr);
          deliveredCount++;
          console.log(`✅ Message sent to ${peerId}`);
        } catch (error) {
          console.error(`❌ Error sending to ${peerId}:`, error);
          // Try to reconnect if send fails
          this.handleConnectionFailure(peerId);
        }
      } else {
        console.warn(`⚠️ Channel to ${peerId} not open: ${channel.readyState}`);
        // Try to re-establish connection if channel is closed
        if (channel.readyState === 'closed') {
          console.log(`🔄 Attempting to re-establish connection to ${peerId}`);
          this.createPeerConnection(peerId, true).catch(err => {
            console.error(`Failed to re-establish connection to ${peerId}:`, err);
          });
        }
      }
    });

    console.log(`📊 Broadcast result: ${deliveredCount}/${attemptedCount} delivered`);

    // If delivery rate is too low, there might be connection issues
    if (attemptedCount > 0 && deliveredCount / attemptedCount < 0.5) {
      console.warn(`🚨 Low delivery rate: ${deliveredCount}/${attemptedCount} - possible connection issues`);
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
        channel.send(JSON.stringify(message));
      } catch (error) {
        console.error(`Error sending to ${peerId}:`, error);
      }
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
   * Handle connection failure
   */
  handleConnectionFailure(peerId) {
    console.log(`Handling connection failure for ${peerId}`);
    const pc = this.peers.get(peerId);
    if (pc && (pc.connectionState === 'failed' || pc.connectionState === 'disconnected')) {
      this.removePeer(peerId);
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
      const expectedPeers = Array.from(this.allKnownPeers);
      if (expectedPeers.length > 0) {
        console.log('🔍 Periodic mesh check...');
        this.ensureFullMesh(expectedPeers);
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
    const connected = [];
    this.dataChannels.forEach((channel, peerId) => {
      if (channel.readyState === 'open') {
        connected.push(peerId);
      }
    });
    return connected;
  }
}