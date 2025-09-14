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
    this.onMessageCallback = null;
    this.onPeerConnectedCallback = null;
    this.onPeerDisconnectedCallback = null;

    // ICE servers configuration
    this.iceConfig = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    };
  }

  /**
   * Connect to signaling server and join room
   */
  async connect() {
    return new Promise((resolve, reject) => {
      try {
        // Determine WebSocket URL based on current location
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.hostname;
        const wsUrl = `${protocol}//${host}:3000`;

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
        console.log('Joined room:', message.roomId);
        // Connect to existing peers
        for (const peerId of message.peers) {
          await this.createPeerConnection(peerId, true);
        }
        break;

      case 'peer-joined':
        console.log('Peer joined:', message.clientId);
        // New peer joined, wait for their offer
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
    // Check if connection already exists
    if (this.peers.has(peerId)) {
      const existingPc = this.peers.get(peerId);
      console.log(`Peer connection already exists for ${peerId} in state: ${existingPc.signalingState}`);

      // If we're supposed to create an offer but connection exists, skip
      if (createOffer && existingPc.signalingState !== 'closed') {
        return;
      }

      // If connection is closed, remove it and create new one
      if (existingPc.connectionState === 'closed' || existingPc.connectionState === 'failed') {
        this.removePeer(peerId);
      } else {
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

    // Create data channel
    if (createOffer) {
      const dataChannel = pc.createDataChannel('chat', {
        ordered: true,
        maxRetransmits: 3
      });
      this.setupDataChannel(dataChannel, peerId);

      // Create and send offer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      this.sendSignalingMessage({
        type: 'offer',
        targetId: peerId,
        data: offer
      });
    } else {
      // Wait for data channel from remote peer
      pc.ondatachannel = (event) => {
        this.setupDataChannel(event.channel, peerId);
      };
    }

    // Handle connection state changes
    pc.onconnectionstatechange = () => {
      console.log(`Connection state with ${peerId}:`, pc.connectionState);
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        this.removePeer(peerId);
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
          this.onMessageCallback(message, peerId);
        } catch (error) {
          console.error('Error parsing message:', error, 'Raw data:', event.data);
        }
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

      // Only set remote description if we're in the right state
      if (pc.signalingState === 'stable' || pc.signalingState === 'have-remote-offer') {
        await pc.setRemoteDescription(new RTCSessionDescription(offer));

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        this.sendSignalingMessage({
          type: 'answer',
          targetId: peerId,
          data: answer
        });
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
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (error) {
        console.error('Error adding ICE candidate:', error);
      }
    }
  }

  /**
   * Send message to all connected peers
   */
  broadcast(message) {
    const messageStr = JSON.stringify(message);
    let deliveredCount = 0;

    this.dataChannels.forEach((channel, peerId) => {
      if (channel.readyState === 'open') {
        try {
          channel.send(messageStr);
          deliveredCount++;
        } catch (error) {
          console.error(`Error sending to ${peerId}:`, error);
          // Try to reconnect if send fails
          this.handleConnectionFailure(peerId);
        }
      } else {
        console.warn(`Channel to ${peerId} not open: ${channel.readyState}`);
      }
    });

    console.log(`Message broadcast to ${deliveredCount} peers`);
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

    if (this.onPeerDisconnectedCallback) {
      this.onPeerDisconnectedCallback(peerId);
    }
  }

  /**
   * Disconnect from all peers and signaling server
   */
  disconnect() {
    // Send leave message
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'leave' }));
      this.ws.close();
    }

    // Close all peer connections
    this.peers.forEach((pc, peerId) => {
      this.removePeer(peerId);
    });
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