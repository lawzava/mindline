/**
 * P2P Connection Manager
 * Handles WebRTC peer-to-peer connections with signaling server coordination
 */

import type {
	P2PConfig,
	SignalingMessage,
	EncryptedRelayPayload,
	RelayKeyPayload,
	RelayPayload,
	TypedP2PMessage,
	MessageCallback,
	PeerCallback,
	ConnectionLostCallback
} from './types';
import { DEFAULT_CONFIG } from './types';

/** Queued offer with metadata for collision handling */
interface QueuedOffer {
	offer: RTCSessionDescriptionInit;
	retryCount: number;
	queuedAt: number;
}

export class P2PConnection {
	// Identity
	private clientId: string;
	private serverClientId: string | null = null;
	private roomId: string;
	private config: P2PConfig;

	// WebSocket
	private ws: WebSocket | null = null;

	// Peer connections
	private peers: Map<string, RTCPeerConnection> = new Map();
	private dataChannels: Map<string, RTCDataChannel> = new Map();
	private pendingCandidates: Map<string, RTCIceCandidateInit[]> = new Map();
	private allKnownPeers: Set<string> = new Set();
	private relayPeers: Set<string> = new Set();

	// ICE configuration
	private iceConfig: RTCConfiguration;

	// Monitoring
	private meshCheckInterval: ReturnType<typeof setInterval> | null = null;

	// ICE restart tracking for exponential backoff
	private iceRestartAttempts: Map<string, number> = new Map();
	private readonly MAX_ICE_RESTARTS = 3;

	// Deduplication: prevent double disconnect callbacks
	private disconnectingPeers: Set<string> = new Set();

	// Connection state tracking: prevent concurrent negotiations
	private negotiatingPeers: Set<string> = new Set();
	private pendingOffers: Map<string, QueuedOffer> = new Map();
	private readonly MAX_COLLISION_RETRIES = 3;
	private readonly OFFER_TTL_MS = 30000; // 30 seconds max queue time

	// Mesh retry tracking: prevent infinite reconnection attempts
	private meshConnectionAttempts: Map<string, number> = new Map();
	private readonly MAX_MESH_ATTEMPTS = 3;

	// Callbacks
	private onMessageCallback: MessageCallback | null = null;
	private onPeerConnectedCallback: PeerCallback | null = null;
	private onPeerDisconnectedCallback: PeerCallback | null = null;
	private onConnectionLostCallback: ConnectionLostCallback | null = null;

	// Ready handshake tracking
	private readyPeers: Set<string> = new Set(); // Peers that sent us 'ready'
	private sentReady: Set<string> = new Set(); // Peers we sent 'ready' to
	private peerConnectedFired: Set<string> = new Set(); // Prevent double callback
	private relayKeyPairPromise: Promise<CryptoKeyPair> | null = null;
	private relaySharedKeys: Map<string, CryptoKey> = new Map();
	private relayKeySentToPeers: Set<string> = new Set();
	private pendingRelayMessages: Map<string, TypedP2PMessage[]> = new Map();

	constructor(clientId: string, roomId: string, config?: Partial<P2PConfig>) {
		this.validateClientId(clientId);

		this.clientId = clientId;
		this.roomId = roomId;
		this.config = { ...DEFAULT_CONFIG, ...config };
		this.iceConfig = this.buildIceConfig();
	}

	private shouldUseRelayFallback(): boolean {
		return this.config.allowRelayFallback !== false && this.config.strictDirect !== true;
	}

	private bytesToBase64(bytes: Uint8Array): string {
		let binary = '';
		for (let i = 0; i < bytes.length; i++) {
			binary += String.fromCharCode(bytes[i]);
		}
		return btoa(binary);
	}

	private base64ToBytes(base64: string): Uint8Array {
		const binary = atob(base64);
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) {
			bytes[i] = binary.charCodeAt(i);
		}
		return bytes;
	}

	private async getRelayKeyPair(): Promise<CryptoKeyPair> {
		if (this.relayKeyPairPromise) {
			return this.relayKeyPairPromise;
		}

		this.relayKeyPairPromise = crypto.subtle.generateKey(
			{
				name: 'ECDH',
				namedCurve: 'P-256'
			},
			true,
			['deriveKey']
		);

		return this.relayKeyPairPromise;
	}

	private async sendRelayKey(peerId: string, force = false): Promise<void> {
		if (!peerId || (!force && this.relayKeySentToPeers.has(peerId))) {
			return;
		}

		if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
			return;
		}

		try {
			const keyPair = await this.getRelayKeyPair();
			const exported = await crypto.subtle.exportKey('raw', keyPair.publicKey);
			const payload: RelayKeyPayload = {
				version: 1,
				curve: 'P-256',
				publicKey: this.bytesToBase64(new Uint8Array(exported))
			};

			this.sendSignalingMessage({
				type: 'relay-key',
				targetId: peerId,
				data: payload
			});
			this.relayKeySentToPeers.add(peerId);
		} catch (error) {
			console.error('[P2P] Failed to send relay key:', error);
		}
	}

	private isRelayKeyPayload(payload: unknown): payload is RelayKeyPayload {
		if (typeof payload !== 'object' || payload === null) return false;
		const candidate = payload as Partial<RelayKeyPayload>;
		return (
			candidate.version === 1 &&
			candidate.curve === 'P-256' &&
			typeof candidate.publicKey === 'string'
		);
	}

	private async handleRelayKey(peerId: string, payload: RelayKeyPayload): Promise<void> {
		try {
			const keyPair = await this.getRelayKeyPair();
			const remotePublicKey = await crypto.subtle.importKey(
				'raw',
				this.base64ToBytes(payload.publicKey) as BufferSource,
				{
					name: 'ECDH',
					namedCurve: 'P-256'
				},
				false,
				[]
			);

			const sharedKey = await crypto.subtle.deriveKey(
				{
					name: 'ECDH',
					public: remotePublicKey
				},
				keyPair.privateKey,
				{ name: 'AES-GCM', length: 256 },
				false,
				['encrypt', 'decrypt']
			);

			this.relaySharedKeys.set(peerId, sharedKey);
			await this.sendRelayKey(peerId);
			await this.flushPendingRelayMessages(peerId);
		} catch (error) {
			console.error('[P2P] Failed to process relay key:', error);
		}
	}

	private async flushPendingRelayMessages(peerId: string): Promise<void> {
		const pending = this.pendingRelayMessages.get(peerId);
		if (!pending || pending.length === 0) {
			return;
		}

		this.pendingRelayMessages.delete(peerId);
		for (const message of pending) {
			await this.sendRelay(message, peerId);
		}
	}

	private isEncryptedRelayPayload(payload: RelayPayload): payload is EncryptedRelayPayload {
		if (typeof payload !== 'object' || payload === null) return false;

		const candidate = payload as Partial<EncryptedRelayPayload>;
		return (
			candidate.version === 1 &&
			candidate.algorithm === 'AES-GCM' &&
			typeof candidate.iv === 'string' &&
			typeof candidate.ciphertext === 'string'
		);
	}

	private async encryptRelayPayload(
		message: TypedP2PMessage,
		key: CryptoKey
	): Promise<EncryptedRelayPayload | null> {
		try {
			const iv = crypto.getRandomValues(new Uint8Array(12));
			const plaintext = new TextEncoder().encode(JSON.stringify(message));
			const ciphertext = await crypto.subtle.encrypt(
				{
					name: 'AES-GCM',
					iv: iv as BufferSource
				},
				key,
				plaintext as BufferSource
			);

			return {
				version: 1,
				algorithm: 'AES-GCM',
				iv: this.bytesToBase64(iv),
				ciphertext: this.bytesToBase64(new Uint8Array(ciphertext))
			};
		} catch (error) {
			console.error('[P2P] Failed to encrypt relay payload:', error);
			return null;
		}
	}

	private async decryptRelayPayload(
		payload: EncryptedRelayPayload,
		key: CryptoKey
	): Promise<TypedP2PMessage | null> {
		try {
			const iv = this.base64ToBytes(payload.iv);
			const ciphertext = this.base64ToBytes(payload.ciphertext);
			const plaintext = await crypto.subtle.decrypt(
				{
					name: 'AES-GCM',
					iv: iv as BufferSource
				},
				key,
				ciphertext as BufferSource
			);

			const decoded = new TextDecoder().decode(new Uint8Array(plaintext));
			return JSON.parse(decoded) as TypedP2PMessage;
		} catch (error) {
			console.error('[P2P] Failed to decrypt relay payload:', error);
			return null;
		}
	}

	/**
	 * Validate client ID to prevent corruption
	 */
	private validateClientId(clientId: string): void {
		const isTestId = typeof clientId === 'string' && clientId.startsWith('test-');
		const isValidRegularId = typeof clientId === 'string' && clientId.length >= 10;

		if (typeof clientId !== 'string' || clientId.includes(',') || (!isTestId && !isValidRegularId)) {
			throw new Error(`Invalid clientId: ${clientId}`);
		}
	}

	/**
	 * Build ICE configuration with STUN and optional TURN servers
	 */
	private buildIceConfig(): RTCConfiguration {
		const iceServers: RTCIceServer[] = [
			{ urls: 'stun:stun.l.google.com:19302' },
			{ urls: 'stun:stun1.l.google.com:19302' },
			{ urls: 'stun:stun2.l.google.com:19302' },
			{ urls: 'stun:stun3.l.google.com:19302' }
		];

		// Add TURN servers if configured (critical for mobile/NAT traversal)
		if (this.config.turnServers && Array.isArray(this.config.turnServers)) {
			iceServers.push(...this.config.turnServers);
			console.log('[P2P] TURN servers configured:', this.config.turnServers.length);
		} else {
			console.warn('[P2P] No TURN servers configured - connections may fail behind NAT/firewalls');
		}

		return {
			iceServers,
			iceCandidatePoolSize: this.config.icePoolSize ?? 10,
			bundlePolicy: 'max-bundle',
			rtcpMuxPolicy: 'require',
			// Force relay mode if configured (useful for problematic networks)
			iceTransportPolicy: this.config.forceRelay ? 'relay' : 'all'
		};
	}

	/**
	 * Connect to signaling server and join room
	 */
	async connect(): Promise<void> {
		return new Promise((resolve, reject) => {
			try {
				const host = this.config.signalingServer;
				const timeout = this.config.connectionTimeout ?? 2000;

				if (!host) {
					console.log('[P2P] No signaling server configured - running in local mode');
					reject(new Error('No signaling server configured'));
					return;
				}

				const protocol = this.config.useSSL ? 'wss:' : 'ws:';
				const path = this.config.websocketPath;
				const wsUrl = `${protocol}//${host}${path}`;

				console.log('[P2P] Connecting to signaling server at', wsUrl);
				this.ws = new WebSocket(wsUrl);

				// Connection timeout - reject if not connected in time
				const connectionTimer = setTimeout(() => {
					if (this.ws?.readyState !== WebSocket.OPEN) {
						console.error('[P2P] WebSocket connection timeout after', timeout, 'ms');
						this.ws?.close();
						reject(new Error('Connection timeout'));
					}
				}, timeout);

				this.ws.onopen = () => {
					clearTimeout(connectionTimer);
					console.log('[P2P] Connected to signaling server');
					this.ws?.send(
						JSON.stringify({
							type: 'join',
							roomId: this.roomId,
							clientId: this.clientId
						})
					);
					// Resolve on actual connection, not arbitrary timeout
					resolve();
				};

				this.ws.onmessage = (event) => {
					try {
						const message = JSON.parse(event.data) as SignalingMessage;
						// Don't await - handle async to avoid blocking WebSocket event loop
						this.handleSignalingMessage(message).catch((error) => {
							console.error('[P2P] Error handling signaling message:', error);
						});
					} catch (error) {
						console.error('[P2P] Failed to parse signaling message:', error);
					}
				};

				this.ws.onerror = (error) => {
					clearTimeout(connectionTimer);
					console.error('[P2P] WebSocket error:', error);
					reject(error);
				};

				this.ws.onclose = () => {
					clearTimeout(connectionTimer);
					console.log('[P2P] Disconnected from signaling server');
					// Clean up all peer connections
					this.peers.forEach((_, peerId) => {
						this.removePeer(peerId);
					});

					// Notify about connection loss for reconnection
					if (this.onConnectionLostCallback) {
						this.onConnectionLostCallback('signaling_server_disconnect');
					}
				};
			} catch (error) {
				reject(error);
			}
		});
	}

	/**
	 * Handle signaling messages
	 */
	private async handleSignalingMessage(message: SignalingMessage): Promise<void> {
		switch (message.type) {
			case 'client-id':
				console.log('[P2P] Received server-assigned client ID');
				this.serverClientId = message.clientId ?? null;
				break;

			case 'room-joined':
				if (message.yourId) {
					this.serverClientId = message.yourId;
					console.log('[P2P] Using server-assigned ID:', message.yourId.slice(0, 8) + '...');
				}
				console.log(
					'[P2P] Joined room:',
					message.roomId,
					'with',
					message.peers?.length ?? 0,
					'existing peers'
				);

				// Track all known peers
				message.peers?.forEach((peerId) => this.allKnownPeers.add(peerId));

				// Connect to ALL existing peers using deterministic initiator logic
				// Use same rule as peer-joined: higher ID initiates to prevent offer collisions
				// CRITICAL: Must compare server-assigned IDs, not local IDs, for consistency
				const peers = message.peers ?? [];
				const myServerId = this.serverClientId || this.clientId;
				for (let i = 0; i < peers.length; i++) {
					const peerId = peers[i];
					void this.sendRelayKey(peerId);
					// Use consistent deterministic rule: higher server ID creates offer
					const shouldInitiate = myServerId > peerId;
					// Stagger connection attempts to reduce race conditions
					// Use faster delays in fastConnect mode for tests
					const baseDelay = this.config.fastConnect ? 100 : 2000;
					const randomDelay = this.config.fastConnect ? 100 : 1000;
					setTimeout(
						async () => {
							try {
								console.log(
									`[P2P] Connecting to existing peer ${i + 1}/${peers.length}:`,
									peerId,
									shouldInitiate ? '(initiating)' : '(waiting)'
								);
								await this.createPeerConnection(peerId, shouldInitiate);
							} catch (error) {
								console.error(`[P2P] Failed to connect to existing peer ${peerId}:`, error);
							}
						},
						i * baseDelay + (this.clientId.charCodeAt(0) % randomDelay)
					);
				}

				// Start periodic mesh checking
				this.startMeshMonitoring();

				// Trigger mesh completion check after all initial connections
				setTimeout(() => {
					this.ensureFullMesh(Array.from(this.allKnownPeers));
				}, (peers.length + 1) * 1000);
				break;

			case 'peer-joined':
				console.log('[P2P] Peer joined:', message.clientId);
				// CRITICAL: Compare server IDs, not local IDs - peer IDs from server use server ID space
				const myServerIdForJoin = this.serverClientId || this.clientId;
				if (message.clientId && message.clientId !== myServerIdForJoin) {
					this.allKnownPeers.add(message.clientId);
					void this.sendRelayKey(message.clientId);

					// Use string comparison to avoid duplicate offers (compare server IDs)
					const shouldInitiate = myServerIdForJoin > message.clientId;
					// Use faster delays in fastConnect mode for tests
					const delay = this.config.fastConnect
						? (shouldInitiate ? 50 : 150)
						: (shouldInitiate ? 500 : 1500);

					console.log(
						`[P2P] Will ${shouldInitiate ? 'initiate' : 'wait for'} connection to peer:`,
						message.clientId
					);

					const peerId = message.clientId;
					setTimeout(async () => {
						try {
							const existingPc = this.peers.get(peerId);
							if (
								!existingPc ||
								['failed', 'closed', 'disconnected'].includes(existingPc.connectionState)
							) {
								console.log(`[P2P] Creating connection to new peer ${peerId}`);
								await this.createPeerConnection(peerId, shouldInitiate);
							} else {
								console.log(`[P2P] Connection to ${peerId} already exists`);
							}
						} catch (error) {
							console.error(`[P2P] Failed to connect to new peer ${peerId}:`, error);
						}
					}, delay);
				}
				break;

			case 'offer':
				if (message.fromId && message.data) {
					console.log('[P2P] Received offer from:', message.fromId);
					await this.handleOffer(message.fromId, message.data as RTCSessionDescriptionInit);
				}
				break;

			case 'answer':
				if (message.fromId && message.data) {
					console.log('[P2P] Received answer from:', message.fromId);
					await this.handleAnswer(message.fromId, message.data as RTCSessionDescriptionInit);
				}
				break;

			case 'ice-candidate':
				if (message.fromId && message.data) {
					console.log('[P2P] Received ICE candidate from:', message.fromId);
					await this.handleIceCandidate(message.fromId, message.data as RTCIceCandidateInit);
				}
				break;

			case 'peer-left':
				console.log('[P2P] Peer left:', message.clientId);
				if (message.clientId) {
					this.removePeer(message.clientId);
				}
				break;

			case 'relay-key':
				if (message.fromId && message.data && this.isRelayKeyPayload(message.data)) {
					await this.handleRelayKey(message.fromId, message.data);
				}
				break;

			case 'relay':
				// Handle relayed message (P2P fallback via WebSocket)
				console.log('[P2P] Received relay message from:', message.fromId);
				if (this.onMessageCallback && message.data && message.fromId) {
					try {
						const payload = message.data as RelayPayload;
						if (this.isEncryptedRelayPayload(payload)) {
							const key = this.relaySharedKeys.get(message.fromId);
							if (!key) {
								void this.sendRelayKey(message.fromId, true);
								console.warn(`[P2P] Missing relay shared key for ${message.fromId}`);
								return;
							}

							const decrypted = await this.decryptRelayPayload(payload, key);
							if (decrypted) {
								this.onMessageCallback(decrypted, message.fromId);
							}
							return;
						}

						// Backward compatibility for older clients that may still send plaintext relay payloads.
						this.onMessageCallback(payload as TypedP2PMessage, message.fromId);
					} catch (error) {
						console.error('[P2P] Error handling relay message:', error);
					}
				}
				break;
		}
	}

	/**
	 * Create a peer connection
	 */
	private async createPeerConnection(peerId: string, createOffer: boolean): Promise<void> {
		console.log(`[P2P] Creating peer connection to ${peerId}, createOffer: ${createOffer}`);

		// Check if connection already exists
		const existingPc = this.peers.get(peerId);
		if (existingPc) {
			console.log(
				`[P2P] Peer connection already exists for ${peerId} in state: ${existingPc.connectionState}`
			);

			// If connection is connecting/connected and healthy, skip
			if (['connecting', 'connected'].includes(existingPc.connectionState)) {
				console.log(`[P2P] Skipping duplicate connection to ${peerId}, already connected`);
				return;
			}

			// If connection is failed/closed/disconnected, clean up and recreate
			if (['failed', 'closed', 'disconnected'].includes(existingPc.connectionState)) {
				console.log(`[P2P] Removing failed connection to ${peerId}, will recreate`);
				this.removePeer(peerId);
			} else if (createOffer && existingPc.signalingState !== 'stable') {
				console.log(`[P2P] Waiting for existing negotiation with ${peerId} to complete`);
				return;
			}
		}

		const pc = new RTCPeerConnection(this.iceConfig);
		this.peers.set(peerId, pc);

		// Track negotiation state - only mark as negotiating if we're creating an offer
		// Non-initiating peers should NOT be marked as negotiating until they process an offer
		if (createOffer) {
			this.negotiatingPeers.add(peerId);
		}

		// Handle ICE candidates
		pc.onicecandidate = (event) => {
			if (event.candidate) {
				// Log candidate type for debugging mobile/TURN issues
				const candidateType = event.candidate.type || 'unknown';
				const protocol = event.candidate.protocol || 'unknown';
				console.log(`[P2P] ICE candidate for ${peerId}: type=${candidateType}, protocol=${protocol}`);

				this.sendSignalingMessage({
					type: 'ice-candidate',
					targetId: peerId,
					data: event.candidate
				});
			}
		};

		// Only create data channel if we're the initiator to prevent duplicates
		if (createOffer) {
			console.log(`[P2P] Creating data channel for peer ${peerId} (we are initiator)`);
			const dataChannel = pc.createDataChannel('chat', {
				ordered: true,
				maxRetransmits: 3
			});
			this.setupDataChannel(dataChannel, peerId);
		} else {
			console.log(`[P2P] Waiting for data channel from ${peerId} (they are initiator)`);
		}

		// Listen for incoming data channel from remote peer
		pc.ondatachannel = (event) => {
			console.log(`[P2P] Received data channel from ${peerId}`);

			// Close existing channel if any to prevent conflicts
			const existingChannel = this.dataChannels.get(peerId);
			if (existingChannel) {
				// CRITICAL: Remove onclose handler BEFORE closing to prevent race condition
				// The async onclose event could otherwise fire after new channel is set up
				// and incorrectly trigger peer removal
				existingChannel.onclose = null;
				existingChannel.onerror = null;
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

				console.log(`[P2P] Sending offer to ${peerId}`);
				this.sendSignalingMessage({
					type: 'offer',
					targetId: peerId,
					data: offer
				});

				// Set timeout for offer response (configurable)
				const offerTimeout = this.config.offerTimeout ?? 15000;
				setTimeout(() => {
					if (pc.signalingState === 'have-local-offer') {
						console.warn(`[P2P] Offer to ${peerId} timed out - restarting connection`);
						this.removePeer(peerId);
						const retryDelay = this.config.fastConnect ? 500 : 2000;
						setTimeout(() => this.createPeerConnection(peerId, true), retryDelay);
					}
				}, offerTimeout);
			} catch (error) {
				console.error(`[P2P] Failed to create offer for ${peerId}:`, error);
				this.removePeer(peerId);
			}
		}

		// Handle connection state changes
		pc.onconnectionstatechange = () => {
			console.log(`[P2P] Connection state with ${peerId}:`, pc.connectionState);

			if (pc.connectionState === 'connected') {
				console.log(`[P2P] Successfully connected to peer ${peerId}`);
				// Clear negotiation state and process any queued offers
				this.negotiatingPeers.delete(peerId);
				this.processQueuedOffer(peerId);
			} else if (pc.connectionState === 'failed') {
				console.warn(`[P2P] Connection failed with peer ${peerId}`);
				this.negotiatingPeers.delete(peerId);
				this.removePeer(peerId);
				this.processQueuedOffer(peerId);
				if (this.onPeerDisconnectedCallback) {
					this.onPeerDisconnectedCallback(peerId);
				}
			} else if (pc.connectionState === 'disconnected') {
				// 'disconnected' is a transient state - WebRTC may auto-recover
				// This is common on mobile during network jitter or brief packet loss
				// Only 'failed' and 'closed' are terminal states that require removal
				console.log(`[P2P] Peer ${peerId} temporarily disconnected, waiting for recovery`);
				// Don't remove peer - let it recover or transition to 'failed'
			}
		};

		// Handle ICE gathering state (critical for mobile/Safari)
		let iceGatheringTimeout: ReturnType<typeof setTimeout> | null = null;
		pc.onicegatheringstatechange = () => {
			console.log(`[P2P] ICE gathering state with ${peerId}:`, pc.iceGatheringState);

			if (pc.iceGatheringState === 'gathering') {
				// Set timeout for ICE gathering (mobile browsers can hang)
				iceGatheringTimeout = setTimeout(() => {
					if (pc.iceGatheringState === 'gathering') {
						console.warn(`[P2P] ICE gathering timeout for ${peerId} - may need TURN relay`);
						// Don't fail, but log for debugging
					}
				}, 10000); // 10 second gathering timeout
			} else if (pc.iceGatheringState === 'complete') {
				if (iceGatheringTimeout) {
					clearTimeout(iceGatheringTimeout);
					iceGatheringTimeout = null;
				}
				console.log(`[P2P] ICE gathering complete for ${peerId}`);
			}
		};

		// Handle ICE connection state changes with exponential backoff retry
		pc.oniceconnectionstatechange = () => {
			console.log(`[P2P] ICE connection state with ${peerId}:`, pc.iceConnectionState);

			if (pc.iceConnectionState === 'failed') {
				const attempts = this.iceRestartAttempts.get(peerId) ?? 0;

				if (attempts < this.MAX_ICE_RESTARTS) {
					// Exponential backoff: 1s, 2s, 4s
					const delay = Math.pow(2, attempts) * 1000;
					console.warn(
						`[P2P] ICE failed, retry ${attempts + 1}/${this.MAX_ICE_RESTARTS} in ${delay}ms for ${peerId}`
					);

					this.iceRestartAttempts.set(peerId, attempts + 1);

					setTimeout(() => {
						try {
							if (this.peers.has(peerId)) {
								pc.restartIce();
							}
						} catch (error) {
							console.error(`[P2P] ICE restart failed for ${peerId}:`, error);
							this.removePeer(peerId);
						}
					}, delay);
				} else {
					console.error(
						`[P2P] ICE exhausted ${this.MAX_ICE_RESTARTS} restart attempts for ${peerId}`
					);
					this.iceRestartAttempts.delete(peerId);
					this.removePeer(peerId);

					// Mark peer for relay fallback
					if (this.shouldUseRelayFallback()) {
						this.relayPeers.add(peerId);
					}
				}
			} else if (
				pc.iceConnectionState === 'connected' ||
				pc.iceConnectionState === 'completed'
			) {
				// Reset restart counter on successful connection
				this.iceRestartAttempts.delete(peerId);
			}
		};
	}

	/**
	 * Setup data channel event handlers
	 */
	private setupDataChannel(dataChannel: RTCDataChannel, peerId: string): void {
		console.log(`[P2P] Setting up data channel for ${peerId}, state: ${dataChannel.readyState}`);

		// Send ready message and check if both sides are ready to fire callback
		const sendReadyAndCheck = () => {
			if (!this.sentReady.has(peerId)) {
				const readyMsg = JSON.stringify({
					type: 'ready',
					peerId: this.serverClientId || this.clientId,
					timestamp: Date.now()
				});
				try {
					dataChannel.send(readyMsg);
					this.sentReady.add(peerId);
					console.log(`[P2P] Sent ready message to ${peerId}`);
				} catch (error) {
					console.error(`[P2P] Failed to send ready to ${peerId}:`, error);
				}
			}
			this.checkAndFirePeerConnected(peerId);
		};

		// CRITICAL: When receiving a channel via ondatachannel, it might already be 'open'
		// In that case, the onopen callback will never fire, so we must handle it immediately
		const handleChannelOpen = () => {
			console.log(`[P2P] Data channel opened with ${peerId}`);
			this.dataChannels.set(peerId, dataChannel);
			sendReadyAndCheck();
		};

		// CRITICAL: Set up message handler FIRST before checking state
		// This ensures we don't miss any queued ready messages
		dataChannel.onmessage = (event) => {
			try {
				const message = JSON.parse(event.data) as TypedP2PMessage;
				console.log(`[P2P] Received ${message.type} message from ${peerId}`);

				// Handle ready message internally for handshake
				if (message.type === 'ready') {
					this.readyPeers.add(peerId);
					console.log(`[P2P] Received ready from ${peerId}`);
					this.checkAndFirePeerConnected(peerId);
					return; // Don't pass ready messages to application callback
				}

				if (this.onMessageCallback) {
					this.onMessageCallback(message, peerId);
				}
			} catch (error) {
				console.error('[P2P] Error parsing message:', error);
			}
		};

		dataChannel.onopen = () => {
			// Only handle if not already in dataChannels (prevents double callback)
			if (!this.dataChannels.has(peerId)) {
				handleChannelOpen();
			}
		};

		// Check if channel is already open (common when receiving via ondatachannel)
		if (dataChannel.readyState === 'open') {
			console.log(`[P2P] Data channel already open for ${peerId}, handling immediately`);
			handleChannelOpen();
		}

		dataChannel.onerror = (error) => {
			console.error(`[P2P] Data channel error with ${peerId}:`, error);

			// Don't immediately remove peer for "User-Initiated Abort" errors
			const rtcError = error as RTCErrorEvent;
			if (rtcError.error?.message?.includes('User-Initiated Abort')) {
				return;
			}

			this.handleConnectionFailure(peerId);
		};

		dataChannel.onclose = () => {
			console.log(`[P2P] Data channel closed with ${peerId}`);
			this.dataChannels.delete(peerId);

			// Only remove peer if the underlying RTCPeerConnection is also dead
			// Data channels can close temporarily on mobile while connection is still viable
			const pc = this.peers.get(peerId);
			if (!pc || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
				console.log(`[P2P] Connection to ${peerId} is dead, removing peer`);
				this.removePeer(peerId);
			} else {
				console.log(`[P2P] Connection to ${peerId} still alive (${pc.connectionState}), keeping peer`);
			}
		};

		dataChannel.binaryType = 'arraybuffer';
	}

	/**
	 * Check if both sides have exchanged ready messages and fire callback
	 */
	private checkAndFirePeerConnected(peerId: string): void {
		// Only fire callback when both sides are ready
		if (
			this.sentReady.has(peerId) &&
			this.readyPeers.has(peerId) &&
			!this.peerConnectedFired.has(peerId)
		) {
			this.peerConnectedFired.add(peerId);
			console.log(`[P2P] Both sides ready with ${peerId}, firing onPeerConnected`);
			if (this.onPeerConnectedCallback) {
				this.onPeerConnectedCallback(peerId);
			}
		}
	}

	/**
	 * Handle offer from remote peer
	 */
	private async handleOffer(peerId: string, offer: RTCSessionDescriptionInit): Promise<void> {
		try {
			// If peer is already in negotiation, queue the offer
			if (this.negotiatingPeers.has(peerId)) {
				const existingQueued = this.pendingOffers.get(peerId);
				const retryCount = existingQueued?.retryCount ?? 0;

				if (retryCount >= this.MAX_COLLISION_RETRIES) {
					console.warn(
						`[P2P] Max collision retries (${this.MAX_COLLISION_RETRIES}) reached for ${peerId}, dropping offer`
					);
					return;
				}

				console.log(
					`[P2P] Peer ${peerId} in negotiation, queueing offer (retry ${retryCount + 1}/${this.MAX_COLLISION_RETRIES})`
				);
				this.pendingOffers.set(peerId, {
					offer,
					retryCount: retryCount + 1,
					queuedAt: Date.now()
				});
				return;
			}

			let pc = this.peers.get(peerId);

			if (pc) {
				// If connected and stable, ignore duplicate offer
				if (pc.signalingState === 'stable' && pc.connectionState === 'connected') {
					console.log(`[P2P] Already connected to ${peerId}, ignoring duplicate offer`);
					return;
				}

				// If connection exists but not connected, remove and recreate
				if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
					this.removePeer(peerId);
					pc = undefined;
				}
			}

			// Create new connection if needed
			if (!pc) {
				await this.createPeerConnection(peerId, false);
				pc = this.peers.get(peerId);
			}

			if (!pc) {
				console.error(`[P2P] Failed to create peer connection for ${peerId}`);
				return;
			}

			// Handle offer based on current signaling state
			if (pc.signalingState === 'stable' || pc.signalingState === 'have-remote-offer') {
				await pc.setRemoteDescription(new RTCSessionDescription(offer));
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
				// CRITICAL: Must use server-assigned IDs for consistent comparison
				console.log(`[P2P] Offer collision detected with peer ${peerId}`);
				const myServerIdForCollision = this.serverClientId || this.clientId;

				if (myServerIdForCollision > peerId) {
					console.log(`[P2P] Ignoring offer from ${peerId} (we have priority)`);
					return;
				} else {
					console.log(`[P2P] Rolling back for ${peerId} (they have priority)`);

					try {
						await pc.setLocalDescription({ type: 'rollback' });
						await pc.setRemoteDescription(new RTCSessionDescription(offer));
						await this.processQueuedCandidates(peerId);

						const answer = await pc.createAnswer();
						await pc.setLocalDescription(answer);

						this.sendSignalingMessage({
							type: 'answer',
							targetId: peerId,
							data: answer
						});
					} catch (collisionError) {
						console.error(`[P2P] Error resolving offer collision with ${peerId}:`, collisionError);

						// Queue for retry instead of immediate removal
						const existingQueued = this.pendingOffers.get(peerId);
						const retryCount = existingQueued?.retryCount ?? 0;

						if (retryCount < this.MAX_COLLISION_RETRIES) {
							console.log(
								`[P2P] Queueing offer for retry after collision error (${retryCount + 1}/${this.MAX_COLLISION_RETRIES})`
							);
							this.pendingOffers.set(peerId, {
								offer,
								retryCount: retryCount + 1,
								queuedAt: Date.now()
							});

							// Schedule retry with exponential backoff: 500ms, 1s, 2s
							const delay = Math.pow(2, retryCount) * 500;
							setTimeout(() => this.processQueuedOffer(peerId), delay);
						} else {
							console.warn(`[P2P] Max collision retries reached for ${peerId}, removing peer`);
							this.removePeer(peerId);
						}
						return;
					}
				}
			} else {
				console.warn(`[P2P] Cannot handle offer in state ${pc.signalingState} for peer ${peerId}`);
			}
		} catch (error) {
			console.error(`[P2P] Error handling offer from ${peerId}:`, error);
		}
	}

	/**
	 * Handle answer from remote peer
	 */
	private async handleAnswer(peerId: string, answer: RTCSessionDescriptionInit): Promise<void> {
		const pc = this.peers.get(peerId);
		if (pc) {
			if (pc.signalingState === 'have-local-offer') {
				try {
					await pc.setRemoteDescription(new RTCSessionDescription(answer));
					await this.processQueuedCandidates(peerId);

					// Clear negotiation state - we've received an answer
					this.negotiatingPeers.delete(peerId);

					// Process any queued offers now that negotiation is complete
					this.processQueuedOffer(peerId);
				} catch (error) {
					console.error(`[P2P] Error setting remote answer for ${peerId}:`, error);
					this.negotiatingPeers.delete(peerId);
				}
			} else {
				console.warn(`[P2P] Received answer in wrong state (${pc.signalingState}) for peer ${peerId}`);
			}
		} else {
			console.warn(`[P2P] No peer connection found for ${peerId}`);
		}
	}

	/**
	 * Process queued offer for a peer after negotiation completes
	 */
	private async processQueuedOffer(peerId: string): Promise<void> {
		const queued = this.pendingOffers.get(peerId);
		if (!queued) {
			return;
		}

		// Check if offer is stale (queued too long ago)
		if (Date.now() - queued.queuedAt > this.OFFER_TTL_MS) {
			console.log(`[P2P] Discarding stale queued offer for ${peerId}`);
			this.pendingOffers.delete(peerId);
			return;
		}

		// Check if peer is still negotiating
		if (this.negotiatingPeers.has(peerId)) {
			console.log(`[P2P] Peer ${peerId} still negotiating, will retry queued offer later`);
			// Schedule another check with backoff
			const delay = Math.pow(2, queued.retryCount) * 500;
			setTimeout(() => this.processQueuedOffer(peerId), delay);
			return;
		}

		console.log(
			`[P2P] Processing queued offer for ${peerId} (retry ${queued.retryCount}/${this.MAX_COLLISION_RETRIES})`
		);
		this.pendingOffers.delete(peerId);

		// Re-enter handleOffer with the queued offer
		await this.handleOffer(peerId, queued.offer);
	}

	/**
	 * Handle ICE candidate from remote peer
	 */
	private async handleIceCandidate(peerId: string, candidate: RTCIceCandidateInit): Promise<void> {
		const pc = this.peers.get(peerId);
		if (pc) {
			try {
				if (pc.remoteDescription) {
					await pc.addIceCandidate(new RTCIceCandidate(candidate));
				} else {
					// Queue the candidate for later when remote description is set
					console.log(`[P2P] Queueing ICE candidate for ${peerId} (no remote description yet)`);
					const pending = this.pendingCandidates.get(peerId) ?? [];
					pending.push(candidate);
					this.pendingCandidates.set(peerId, pending);
				}
			} catch (error) {
				console.error('[P2P] Error adding ICE candidate:', error);
			}
		}
	}

	/**
	 * Process queued ICE candidates after setting remote description
	 */
	private async processQueuedCandidates(peerId: string): Promise<void> {
		const pc = this.peers.get(peerId);
		const candidates = this.pendingCandidates.get(peerId);

		if (pc && candidates && candidates.length > 0) {
			console.log(`[P2P] Processing ${candidates.length} queued ICE candidates for ${peerId}`);

			for (const candidate of candidates) {
				try {
					await pc.addIceCandidate(new RTCIceCandidate(candidate));
				} catch (error) {
					console.error('[P2P] Error adding queued ICE candidate:', error);
				}
			}

			this.pendingCandidates.delete(peerId);
		}
	}

	/**
	 * Send message to all connected peers (P2P + relay fallback)
	 */
	broadcast(message: TypedP2PMessage): number {
		let successCount = 0;
		const allowRelayFallback = this.shouldUseRelayFallback();

		// Send via P2P data channels
		for (const [peerId, channel] of this.dataChannels.entries()) {
			if (channel.readyState === 'open') {
				try {
					channel.send(JSON.stringify(message));
					successCount++;
				} catch (error) {
					if (allowRelayFallback) {
						console.warn(`[P2P] P2P send failed to ${peerId}, switching to relay:`, error);
						this.relayPeers.add(peerId);
					} else {
						console.warn(`[P2P] P2P send failed to ${peerId} in strict direct mode:`, error);
					}
					this.handleConnectionFailure(peerId);
				}
			}
		}

		if (!allowRelayFallback) {
			console.log(`[P2P] Broadcast: ${successCount} delivered (strict direct mode)`);
			return successCount;
		}

		// Send via WebSocket relay for peers without P2P
		// Use server-assigned ID to properly skip self
		const myServerId = this.serverClientId || this.clientId;
		for (const peerId of this.relayPeers) {
			if (peerId !== myServerId && this.allKnownPeers.has(peerId)) {
				void this.sendRelay(message, peerId);
				successCount++;
			}
		}

		// Also relay to any known peers not in dataChannels
		for (const peerId of this.allKnownPeers) {
			if (
				peerId !== myServerId &&
				!this.dataChannels.has(peerId) &&
				!this.relayPeers.has(peerId)
			) {
				void this.sendRelay(message, peerId);
				successCount++;
			}
		}

		console.log(`[P2P] Broadcast: ${successCount} delivered (P2P + relay)`);
		return successCount;
	}

	/**
	 * Send message via WebSocket relay (fallback when P2P fails)
	 */
	private async sendRelay(message: TypedP2PMessage, targetId: string | null = null): Promise<void> {
		if (!this.shouldUseRelayFallback()) {
			return;
		}

		if (!targetId) {
			return;
		}

		if (this.ws && this.ws.readyState === WebSocket.OPEN) {
			const sharedKey = this.relaySharedKeys.get(targetId);
			if (!sharedKey) {
				const pending = this.pendingRelayMessages.get(targetId) ?? [];
				pending.push(message);
				this.pendingRelayMessages.set(targetId, pending);
				await this.sendRelayKey(targetId, true);
				return;
			}

			const encryptedPayload = await this.encryptRelayPayload(message, sharedKey);
			if (!encryptedPayload) {
				return;
			}

			const relayMessage = {
				type: 'relay',
				data: encryptedPayload,
				targetId: targetId
			};
			this.ws.send(JSON.stringify(relayMessage));
			console.log(`[P2P] Relay sent to ${targetId ?? 'all'}`);
		}
	}

	/**
	 * Send message to specific peer
	 */
	sendToPeer(peerId: string, message: TypedP2PMessage): void {
		const channel = this.dataChannels.get(peerId);

		if (channel && channel.readyState === 'open') {
			try {
				const messageStr = JSON.stringify(message);
				console.log(`[P2P] Sending ${message.type} to ${peerId}`);
				channel.send(messageStr);
			} catch (error) {
				console.error(`[P2P] Error sending to ${peerId}:`, error);
			}
		} else {
			console.warn(
				`[P2P] Cannot send to ${peerId}: channel state = ${channel ? channel.readyState : 'no-channel'}`
			);
		}
	}

	/**
	 * Send signaling message
	 */
	private sendSignalingMessage(message: Partial<SignalingMessage>): void {
		if (this.ws && this.ws.readyState === WebSocket.OPEN) {
			this.ws.send(JSON.stringify(message));
		}
	}

	/**
	 * Remove peer connection and clean up all resources
	 * Uses deduplication to prevent double callback firing
	 */
	private removePeer(peerId: string): void {
		// Deduplication: check if already disconnecting this peer
		if (this.disconnectingPeers.has(peerId)) {
			console.log(`[P2P] Already disconnecting peer ${peerId}, skipping duplicate removal`);
			return;
		}

		// Mark as disconnecting to prevent duplicate callbacks
		this.disconnectingPeers.add(peerId);

		const channel = this.dataChannels.get(peerId);
		if (channel) {
			channel.onopen = null;
			channel.onmessage = null;
			channel.onerror = null;
			channel.onclose = null;
			try {
				channel.close();
			} catch {
				// Ignore errors on already-closed channels
			}
			this.dataChannels.delete(peerId);
		}

		const pc = this.peers.get(peerId);
		if (pc) {
			pc.onicecandidate = null;
			pc.ondatachannel = null;
			pc.onconnectionstatechange = null;
			pc.oniceconnectionstatechange = null;
			try {
				pc.close();
			} catch {
				// Ignore errors on already-closed connections
			}
			this.peers.delete(peerId);
		}

		this.pendingCandidates.delete(peerId);
		this.relayPeers.delete(peerId);
		this.relaySharedKeys.delete(peerId);
		this.relayKeySentToPeers.delete(peerId);
		this.pendingRelayMessages.delete(peerId);
		this.allKnownPeers.delete(peerId);
		this.negotiatingPeers.delete(peerId);
		this.pendingOffers.delete(peerId);
		this.meshConnectionAttempts.delete(peerId);
		// Clear ready handshake state
		this.readyPeers.delete(peerId);
		this.sentReady.delete(peerId);
		this.peerConnectedFired.delete(peerId);

		// Fire callback only once per peer
		if (this.onPeerDisconnectedCallback) {
			this.onPeerDisconnectedCallback(peerId);
		}

		// Clear the disconnecting flag after a short delay
		// This prevents rapid reconnect/disconnect cycles from being deduplicated
		setTimeout(() => {
			this.disconnectingPeers.delete(peerId);
		}, 1000);
	}

	/**
	 * Disconnect from all peers and signaling server
	 */
	disconnect(): void {
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
		this.peers.forEach((_, peerId) => {
			this.removePeer(peerId);
		});

		// Clear known peers
		this.allKnownPeers.clear();
		this.relaySharedKeys.clear();
		this.relayKeySentToPeers.clear();
		this.pendingRelayMessages.clear();
	}

	/**
	 * Set callback for incoming messages
	 */
	onMessage(callback: MessageCallback): void {
		this.onMessageCallback = callback;
	}

	/**
	 * Set callback for peer connection events
	 */
	onPeerConnected(callback: PeerCallback): void {
		this.onPeerConnectedCallback = callback;
	}

	/**
	 * Set callback for peer disconnection events
	 */
	onPeerDisconnected(callback: PeerCallback): void {
		this.onPeerDisconnectedCallback = callback;
	}

	/**
	 * Set callback for connection loss events
	 */
	onConnectionLost(callback: ConnectionLostCallback): void {
		this.onConnectionLostCallback = callback;
	}

	/**
	 * Handle connection failure with retry logic
	 */
	private handleConnectionFailure(peerId: string): void {
		console.log(`[P2P] Handling connection failure for ${peerId}`);
		const pc = this.peers.get(peerId);
		if (pc && (pc.connectionState === 'failed' || pc.connectionState === 'disconnected')) {
			console.log(`[P2P] Attempting ICE restart for ${peerId}`);

			try {
				if (pc.connectionState === 'failed' && pc.iceConnectionState !== 'closed') {
					pc.restartIce();

					// Give ICE restart a chance to work (5 seconds)
					setTimeout(() => {
						if (pc.connectionState === 'failed') {
							console.warn(`[P2P] ICE restart failed for ${peerId}, removing peer`);
							this.removePeer(peerId);
						}
					}, 5000);
					return;
				}
			} catch (error) {
				console.error(`[P2P] ICE restart failed for ${peerId}:`, error);
			}

			this.removePeer(peerId);
		}
	}

	/**
	 * Start periodic mesh monitoring with retry limits
	 */
	private startMeshMonitoring(): void {
		if (this.meshCheckInterval) {
			clearInterval(this.meshCheckInterval);
		}

		this.meshCheckInterval = setInterval(() => {
			const knownPeers = Array.from(this.allKnownPeers);
			const myServerId = this.serverClientId || this.clientId;

			for (const peerId of knownPeers) {
				// Skip self (use server ID for comparison)
				if (peerId === myServerId) {
					continue;
				}

				// Check if we already have a data channel
				if (this.dataChannels.has(peerId)) {
					// Reset attempt counter on successful connection
					this.meshConnectionAttempts.delete(peerId);
					continue;
				}

				// CRITICAL: Check if a peer connection exists and is still trying to connect
				// Don't interfere with ongoing connection attempts
				const existingPc = this.peers.get(peerId);
				if (existingPc) {
					const state = existingPc.connectionState;
					if (state === 'connecting' || state === 'new') {
						// Connection is in progress, don't create another one
						console.log(`[P2P] Mesh: peer ${peerId} connection in progress (${state}), skipping`);
						continue;
					}
					if (state === 'connected') {
						// Connected but no data channel yet - give it more time
						console.log(`[P2P] Mesh: peer ${peerId} connected but no channel yet, waiting`);
						continue;
					}
				}

				// Check retry count to prevent infinite connection attempts
				const attempts = this.meshConnectionAttempts.get(peerId) ?? 0;
				if (attempts >= this.MAX_MESH_ATTEMPTS) {
					continue;
				}

				// Track the attempt
				this.meshConnectionAttempts.set(peerId, attempts + 1);
				console.log(
					`[P2P] Mesh reconnect attempt ${attempts + 1}/${this.MAX_MESH_ATTEMPTS} for peer ${peerId}`
				);

				// Use deterministic initiator rule (same as peer-joined)
				const shouldInitiate = myServerId > peerId;
				this.createPeerConnection(peerId, shouldInitiate);
			}
		}, this.config.meshCheckInterval ?? 10000);
	}

	/**
	 * Ensure full mesh connectivity
	 */
	private ensureFullMesh(expectedPeers: string[]): void {
		const connectedPeers = this.getConnectedPeers();
		const myServerId = this.serverClientId || this.clientId;

		const missing = expectedPeers.filter(
			(peerId) => !connectedPeers.includes(peerId) && peerId !== myServerId
		);

		for (const peerId of missing) {
			// Skip if connection already in progress
			const existingPc = this.peers.get(peerId);
			if (existingPc && ['new', 'connecting', 'connected'].includes(existingPc.connectionState)) {
				continue;
			}

			// Use deterministic initiator rule
			const shouldInitiate = myServerId > peerId;
			this.createPeerConnection(peerId, shouldInitiate);
		}
	}

	/**
	 * Get list of connected peer IDs
	 */
	getConnectedPeers(): string[] {
		return Array.from(this.dataChannels.entries())
			.filter(([_, channel]) => channel.readyState === 'open')
			.map(([peerId]) => peerId);
	}

	/**
	 * Check if WebSocket is connected to signaling server
	 */
	isWebSocketConnected(): boolean {
		return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
	}
}
