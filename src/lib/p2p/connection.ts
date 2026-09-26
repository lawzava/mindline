/**
 * P2P connection layer (PROTOCOL.md §3).
 *
 * Perfect negotiation per peer, two negotiated DataChannels (reliable
 * `chat`, lossy `eph` for drafts), hello key-confirmation bound to the
 * DTLS fingerprints, encrypted envelopes for every byte on the wire, and
 * the signaling relay as encrypted last resort. Signaling loss never
 * tears down healthy DataChannels.
 */

import type { CryptoSession, HelloBinding } from './crypto-session';
import type { Envelope } from '$lib/crypto/envelope';
import type {
	MessageCallback,
	P2PConfig,
	PeerCallback,
	PeerDisconnectedCallback,
	ConnectionLostCallback,
	SignalingMessage,
	TypedP2PMessage
} from './types';
import { DEFAULT_CONFIG } from './types';
import { CooldownGate } from './cooldown';

interface SignalingAuth {
	deviceId: string;
	hmac: string;
}

interface AuthedPayload {
	auth?: SignalingAuth;
	envelope?: Envelope; // relay transport
	description?: RTCSessionDescriptionInit;
	candidate?: RTCIceCandidateInit;
	hello?: string; // serialized hello envelope, relay variant
}

interface Peer {
	clientId: string;
	deviceId: string | null;
	pc: RTCPeerConnection;
	chat: RTCDataChannel;
	eph: RTCDataChannel;
	makingOffer: boolean;
	ignoreOffer: boolean;
	isSettingRemoteAnswerPending: boolean;
	polite: boolean;
	verified: boolean;
	helloSent: boolean;
	queuedCandidates: RTCIceCandidateInit[];
	restartTimer: ReturnType<typeof setTimeout> | null;
	attemptTimer: ReturnType<typeof setTimeout> | null;
	restartAttempts: number;
	chatQueue: { raw: string; bytes: number }[];
	chatQueueBytes: number;
	chatDraining: boolean;
	grantedGeneration: { g: number; gid: string } | null;
}

const CHAT_CHANNEL_ID = 0;
const EPH_CHANNEL_ID = 1;
const MAX_RESTART_ATTEMPTS = 5;
// One full retained history (500 single-message pages) plus controls can
// arrive while the receiver is busy. Allow up to 64 KiB per wire page.
const MAX_QUEUED_CHAT_MESSAGES = 512;
const MAX_QUEUED_CHAT_BYTES = MAX_QUEUED_CHAT_MESSAGES * 64 * 1024;
const MAX_QUEUED_RELIABLE_SENDS = 128;
const MAX_QUEUED_SIGNALING_MESSAGES = 128;
const MAX_QUEUED_SIGNALING_BYTES = 2 * 1024 * 1024;
/** Consecutive non-anchoring segmented rounds before we stop asking a peer (§1.4). */
const SEGMENT_NO_PROGRESS_LIMIT = 4;

/**
 * §3.6: drafts/presence (eph), sync, and media never transit the relay;
 * only live msg-class traffic does. The signaling server's 16 KB
 * maxPayload terminates any socket that exceeds it, so relayed frames
 * are size-guarded with headroom for the {type,targetId,data} wrapper.
 */
const RELAY_FORBIDDEN_TYPES = new Set([
	'typing',
	'sync-request',
	'sync-response',
	'media-offer',
	'media-accept',
	'media-abort',
	// §1.4/§3.6: grants never relay — a relayed grant would hand the
	// operator ciphertext that a leaked link decrypts. Security boundary,
	// not bandwidth. (Defence in depth: these ride 'hs' envelopes, which
	// the relay paths already refuse wholesale.)
	'rekey-grant',
	'rekey-request'
]);
export const MAX_RELAY_WIRE_BYTES = 14 * 1024;

export function relayEligible(type: string, wireBytes: number): boolean {
	return !RELAY_FORBIDDEN_TYPES.has(type) && wireBytes <= MAX_RELAY_WIRE_BYTES;
}

export class P2PConnection {
	private session: CryptoSession;
	private config: P2PConfig;
	private roomId: string;
	private displayName: () => string;

	private ws: WebSocket | null = null;
	private myClientId: string | null = null;
	// TURN servers minted by the signaling server, delivered on the 'client-id'
	// welcome (the static frontend can't hold the Cloudflare secret). Combined
	// with any static config.turnServers in buildRtcConfig.
	private managedIceServers: RTCIceServer[] = [];
	private peers = new Map<string, Peer>(); // by clientId
	private deviceToClient = new Map<string, string>();
	private relayPeers = new Map<string, { deviceId: string; verified: boolean }>();
	private disposed = false;
	private wsQueue: string[] = [];
	private wsDrainTimer: ReturnType<typeof setTimeout> | null = null;
	private reliableSendTail: Promise<void> = Promise.resolve();
	private queuedReliableSends = 0;
	private signalingSendTail: Promise<void> = Promise.resolve();
	private queuedSignalingSends = 0;

	private onMessageCallback: MessageCallback | null = null;
	private onPeerConnectedCallback: PeerCallback | null = null;
	private onPeerDisconnectedCallback: PeerDisconnectedCallback | null = null;
	private onConnectionLostCallback: ConnectionLostCallback | null = null;
	private onKnockingCallback: ((clientId: string) => void) | null = null;
	private onNewcomerCallback: ((deviceId: string) => void) | null = null;
	private onMediaChannelCallback:
		| ((peerDeviceId: string, transferId: string, channel: RTCDataChannel) => void)
		| null = null;
	/**
	 * Per-device rekey-request rate limit (decrypt-failure path, §1.4).
	 * Keyed by the verified deviceId, never clientId — the server-assigned
	 * clientId rotates on every signaling reconnect, which would reset the
	 * window (limiter bypass by socket cycling) and strand dead entries.
	 */
	private rekeyRequestGate = new CooldownGate(5000);
	/** Per-device rate limit for fork-heal replies to rejected grants. */
	private forkReplyGate = new CooldownGate(5000);
	/**
	 * Per-device inbound cooldown on every KEM-encapsulating grant we serve a
	 * peer (§1.4): both the rekey-request answer and the advertised-generation
	 * grant (a re-sent hello must not force one encapsulation per hello).
	 * Shorter than the 5 s outbound request gate so honest segmented catch-up
	 * (≤ one request per 5 s per peer) is never throttled, while a flooder's
	 * forced KEM work is capped at one grant per second per peer.
	 */
	private rekeyRespondGate = new CooldownGate(1000);
	/**
	 * Per-device count of consecutive non-anchoring ('behind') segmented
	 * rounds. A deep fork never anchors, so after SEGMENT_NO_PROGRESS_LIMIT
	 * rounds we stop re-requesting from that peer (the documented link
	 * re-entry then applies); reset on any progress.
	 */
	private segmentNoProgress = new Map<string, number>();

	constructor(session: CryptoSession, config: Partial<P2PConfig> = {}, displayName: () => string) {
		this.session = session;
		this.roomId = session.roomId;
		this.config = { ...DEFAULT_CONFIG, ...config };
		this.displayName = displayName;
	}

	// ============ lifecycle ============

	async connect(): Promise<void> {
		const protocol = this.config.useSSL ? 'wss' : 'ws';
		const url = `${protocol}://${this.config.signalingServer}${this.config.websocketPath}`;

		await new Promise<void>((resolve, reject) => {
			const ws = new WebSocket(url);
			let receiving = Promise.resolve();
			let queuedMessages = 0;
			let queuedBytes = 0;
			const timeout = setTimeout(() => {
				ws.close();
				reject(new Error('signaling connection timeout'));
			}, this.config.connectionTimeout ?? 5000);

			ws.onopen = () => {
				clearTimeout(timeout);
				this.ws = ws;
				ws.send(JSON.stringify({ type: 'join', roomId: this.roomId }));
				resolve();
			};
			ws.onerror = () => {
				clearTimeout(timeout);
				reject(new Error('signaling connection failed'));
			};
			ws.onmessage = (event) => {
				if (!this.isCurrentSignaling(ws)) return;
				const raw = String(event.data);
				const bytes = new TextEncoder().encode(raw).byteLength;
				if (
					queuedMessages >= MAX_QUEUED_SIGNALING_MESSAGES ||
					queuedBytes + bytes > MAX_QUEUED_SIGNALING_BYTES
				) {
					console.warn('[P2P] signaling receive queue exceeded; closing socket');
					ws.close(4009, 'signaling receive queue exceeded');
					return;
				}
				queuedMessages++;
				queuedBytes += bytes;
				// WebSocket events are ordered; async authentication must preserve
				// that order so candidates cannot overtake the offer creating a peer.
				receiving = receiving
					.then(() => this.handleSignaling(raw, ws))
					.catch((error) => console.warn('[P2P] signaling message failed:', error))
					.finally(() => {
						queuedMessages--;
						queuedBytes -= bytes;
					});
			};
			ws.onclose = () => {
				if (this.ws === ws) this.ws = null;
				// Healthy DataChannels survive; manager reconnects signaling.
				if (!this.disposed) this.onConnectionLostCallback?.('signaling_server_disconnect');
			};
		});
	}

	disconnect(): void {
		this.disposed = true;
		try {
			this.ws?.send(JSON.stringify({ type: 'leave' }));
		} catch {
			/* closing anyway */
		}
		this.ws?.close();
		this.ws = null;
		for (const clientId of [...this.peers.keys()]) this.removePeer(clientId);
		for (const clientId of [...this.relayPeers.keys()]) this.removePeer(clientId);
		this.deviceToClient.clear();
		this.rekeyRequestGate.clear();
		this.forkReplyGate.clear();
		this.rekeyRespondGate.clear();
		this.segmentNoProgress.clear();
	}

	isWebSocketConnected(): boolean {
		return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
	}

	/**
	 * Re-open signaling after a drop WITHOUT touching healthy DataChannels.
	 * The server assigns us a fresh clientId; peers rekey us on our first
	 * authenticated signaling message (see handleDescription).
	 */
	async reconnectSignaling(): Promise<void> {
		if (this.disposed || this.isWebSocketConnected()) return;
		// Offers/candidates queued before the drop were authenticated against the
		// old server clientId; the server mints a fresh one on rejoin, so they
		// would be rejected. Drop them — room-joined regenerates what's needed.
		this.wsQueue.length = 0;
		await this.connect();
	}

	/** Verified peers reachable right now (open chat channel). */
	hasLivePeers(): boolean {
		for (const peer of this.peers.values()) {
			if (peer.verified && peer.chat.readyState === 'open') return true;
		}
		return false;
	}

	// ============ callbacks ============

	onMessage(cb: MessageCallback): void {
		this.onMessageCallback = cb;
	}
	onPeerConnected(cb: PeerCallback): void {
		this.onPeerConnectedCallback = cb;
	}
	onPeerDisconnected(cb: PeerDisconnectedCallback): void {
		this.onPeerDisconnectedCallback = cb;
	}
	onConnectionLost(cb: ConnectionLostCallback): void {
		this.onConnectionLostCallback = cb;
	}
	/** A peer reached us but could not prove key knowledge. */
	onKnocking(cb: (clientId: string) => void): void {
		this.onKnockingCallback = cb;
	}

	/** A direct peer verified while at the link generation (§1.4 trigger a). */
	onNewcomer(cb: (deviceId: string) => void): void {
		this.onNewcomerCallback = cb;
	}

	/** An in-band media channel arrived from a verified peer (§5). */
	onMediaChannel(
		cb: (peerDeviceId: string, transferId: string, channel: RTCDataChannel) => void
	): void {
		this.onMediaChannelCallback = cb;
	}

	/** Open a dedicated in-band channel toward a verified peer. */
	openMediaChannel(peerDeviceId: string, label: string): RTCDataChannel | null {
		const clientId = this.deviceToClient.get(peerDeviceId);
		const peer = clientId ? this.peers.get(clientId) : undefined;
		if (!peer || !peer.verified || peer.pc.connectionState !== 'connected') return null;
		try {
			return peer.pc.createDataChannel(label, { ordered: true });
		} catch (error) {
			console.warn('[P2P] media channel open failed:', error);
			return null;
		}
	}

	// ============ sending ============

	/** Peers (by deviceId) with a verified open chat channel or relay. */
	getConnectedPeers(): string[] {
		const ids = this.getDirectPeers();
		for (const relay of this.relayPeers.values()) {
			if (relay.verified) ids.push(relay.deviceId);
		}
		return ids;
	}

	/** Peers reachable over a verified open direct channel — the only ones
	 *  eligible for media and sync (§3.5/§3.6). */
	getDirectPeers(): string[] {
		const ids: string[] = [];
		for (const peer of this.peers.values()) {
			if (peer.verified && peer.deviceId && peer.chat.readyState === 'open') {
				ids.push(peer.deviceId);
			}
		}
		return ids;
	}

	broadcast(message: TypedP2PMessage): number {
		const send = async () => {
			for (const deviceId of new Set(this.getConnectedPeers())) {
				try {
					await this.sendToPeerAsync(deviceId, message);
				} catch (error) {
					console.warn(`[P2P] broadcast failed to ${deviceId}:`, error);
				}
			}
		};
		void (message.type === 'typing' ? send() : this.queueReliableSend(send)).catch((error) => {
			console.warn('[P2P] broadcast failed:', error);
		});
		return this.getConnectedPeers().length;
	}

	private queueReliableSend(send: () => Promise<void>): Promise<void> {
		if (this.disposed) return Promise.resolve();
		if (this.queuedReliableSends >= MAX_QUEUED_RELIABLE_SENDS) {
			return Promise.reject(new Error('reliable send queue exceeded'));
		}
		this.queuedReliableSends++;
		const pending = this.reliableSendTail
			.then(async () => {
				if (!this.disposed) await send();
			})
			.finally(() => this.queuedReliableSends--);
		// A failed send must not poison subsequent reliable traffic.
		this.reliableSendTail = pending.catch(() => {});
		return pending;
	}

	sendToPeer(peerDeviceId: string, message: TypedP2PMessage): Promise<void> {
		const send = () => this.sendToPeerAsync(peerDeviceId, message);
		return (message.type === 'typing' ? send() : this.queueReliableSend(send)).catch((error) => {
			console.warn(`[P2P] send failed to ${peerDeviceId}:`, error);
		});
	}

	/** Called inside the reliable queue, or independently for lossy drafts. */
	private async sendToPeerAsync(peerDeviceId: string, message: TypedP2PMessage): Promise<void> {
		if (this.disposed) return;
		const isDraft = message.type === 'typing';
		const clientId = this.deviceToClient.get(peerDeviceId);
		const peer = clientId ? this.peers.get(clientId) : undefined;
		let wire = isDraft
			? await this.session.sealDraft(message as unknown as Record<string, unknown>)
			: peer?.verified
				? await this.sealForPeer(peer, message)
				: await this.session.sealMessage(message as unknown as Record<string, unknown>);
		if (wire === null) {
			// The remote may already have established relay while our old direct
			// peer still exists. Only eligible bodies can use that fallback.
			if (
				!clientId ||
				!this.relayPeers.get(clientId)?.verified ||
				RELAY_FORBIDDEN_TYPES.has(message.type)
			)
				return;
			wire = await this.session.sealMessage(message as unknown as Record<string, unknown>);
		}
		if (this.disposed) return;
		if (peer?.verified && this.isCurrentPeer(peer)) {
			const channel = isDraft ? peer.eph : peer.chat;
			if (channel.readyState === 'open') {
				try {
					channel.send(wire);
					return;
				} catch (error) {
					console.warn(`[P2P] direct send failed to ${peerDeviceId}:`, error);
				}
			}
		}
		if (
			clientId &&
			this.relayPeers.get(clientId)?.verified &&
			relayEligible(message.type, new TextEncoder().encode(wire).length)
		) {
			this.sendSignaling({
				type: 'relay',
				targetId: clientId,
				data: { envelope: JSON.parse(wire) as Envelope } as never
			});
		}
	}

	/** A newly adopted or minted generation must reach this peer before its messages. */
	private async sealForPeer(peer: Peer, message: TypedP2PMessage): Promise<string | null> {
		while (this.isCurrentPeer(peer) && peer.chat.readyState === 'open') {
			const current = this.session.generation;
			if (
				current.g === 0 ||
				(peer.grantedGeneration?.g === current.g && peer.grantedGeneration.gid === current.gid)
			) {
				// No await between checking the generation and sealMessage capturing
				// its key: another peer can adopt a grant while crypto is pending.
				return this.session.sealMessage(message as unknown as Record<string, unknown>);
			}
			await this.sendCurrentGrant(peer);
		}
		return null;
	}

	/** Must run inside queueReliableSend, so the grant's seq cannot be overtaken. */
	private async sendCurrentGrant(peer: Peer, peerG = 0, peerGid?: string): Promise<void> {
		if (!this.isCurrentPeer(peer) || !peer.deviceId || peer.chat.readyState !== 'open') return;
		const generation = this.session.generation;
		const wire = await this.session.grantWireFor(peer.deviceId, peerG, peerGid);
		if (!this.isCurrentPeer(peer) || peer.chat.readyState !== 'open') return;
		peer.chat.send(wire);
		peer.grantedGeneration = generation;
	}

	// ============ signaling ============

	/**
	 * Outbound signaling is rate-queued (~40 msg/s): trickle ICE across a
	 * mesh can burst past the server's per-connection limit (50/s) and get
	 * the socket killed. Ported from the heavy-group-chat stability fix.
	 */
	private sendSignaling(message: SignalingMessage): void {
		this.wsQueue.push(JSON.stringify(message));
		this.drainSignalingQueue();
	}

	private drainSignalingQueue(): void {
		if (this.wsDrainTimer) return;
		const sendNext = () => {
			this.wsDrainTimer = null;
			if (this.ws?.readyState !== WebSocket.OPEN) {
				if (this.disposed) this.wsQueue.length = 0;
				return; // drained again on the next sendSignaling after reconnect
			}
			const next = this.wsQueue.shift();
			if (next === undefined) return;
			this.ws.send(next);
			if (this.wsQueue.length > 0) {
				this.wsDrainTimer = setTimeout(sendNext, 25);
			}
		};
		sendNext();
	}

	private async authedData(extra: Omit<AuthedPayload, 'auth'>): Promise<AuthedPayload> {
		const clientId = this.myClientId ?? '';
		return {
			...extra,
			auth: {
				deviceId: this.session.deviceId,
				hmac: await this.session.signalingAuth(clientId)
			}
		};
	}

	private async sendAuthedSignaling(
		peer: Peer,
		type: 'offer' | 'answer' | 'ice-candidate',
		extra: Omit<AuthedPayload, 'auth'>
	): Promise<void> {
		const ws = this.ws;
		if (!ws || !this.isCurrentSignaling(ws) || !this.isCurrentPeer(peer)) return;
		if (this.queuedSignalingSends >= MAX_QUEUED_SIGNALING_MESSAGES) {
			console.warn('[P2P] signaling send queue exceeded; closing socket');
			ws.close(4009, 'signaling send queue exceeded');
			return;
		}
		this.queuedSignalingSends++;
		const pending = this.signalingSendTail
			.then(async () => {
				if (!this.isCurrentSignaling(ws) || !this.isCurrentPeer(peer)) return;
				const data = await this.authedData(extra);
				if (!this.isCurrentSignaling(ws) || !this.isCurrentPeer(peer)) return;
				this.sendSignaling({ type, targetId: peer.clientId, data: data as never });
			})
			.catch((error) => console.warn('[P2P] signaling authentication failed:', error))
			.finally(() => this.queuedSignalingSends--);
		this.signalingSendTail = pending;
		await pending;
	}

	private async verifyAuth(
		fromId: string,
		payload: AuthedPayload | undefined
	): Promise<string | null> {
		const auth = payload?.auth;
		if (!auth?.deviceId || !auth.hmac) return null;
		const valid = await this.session.verifySignalingAuth(auth.deviceId, fromId, auth.hmac);
		return valid ? auth.deviceId : null;
	}

	private isCurrentSignaling(source?: WebSocket): boolean {
		return !this.disposed && (source === undefined || this.ws === source);
	}

	private async handleSignaling(raw: string, source?: WebSocket): Promise<void> {
		if (!this.isCurrentSignaling(source)) return;
		let message: SignalingMessage;
		try {
			message = JSON.parse(raw);
		} catch {
			return;
		}

		switch (message.type) {
			case 'client-id':
				this.myClientId = message.clientId ?? null;
				// Replace (not append) so reconnects refresh rather than accumulate.
				this.managedIceServers = message.iceServers ?? [];
				break;

			case 'room-joined': {
				this.myClientId = message.yourId ?? this.myClientId;
				const listed = new Set(message.peers ?? []);
				// On the initial join `peers`/`relayPeers` are empty and these loops
				// are no-ops. On a reconnect they are the fix for the "everyone must
				// refresh" bug: the server minted us a fresh clientId, and every other
				// member already saw our old socket close (peer-left) and tore us
				// down, so NONE of our existing connections can still be live from the
				// remote side — no matter what our local pc state reports, which can
				// lag a remote teardown by seconds. So every peer must be rebuilt.
				// A member the server STILL lists is the same person we're
				// re-handshaking, not a departure: tear the stale pc down WITHOUT
				// firing peer-disconnected (no "X left" toast, no peer-list flicker,
				// no key rotation) and rebuild it fresh below. A member the server no
				// longer lists genuinely left while we were gone, so remove it fully.
				for (const clientId of [...this.peers.keys()]) {
					if (listed.has(clientId)) this.removePeerConnectionOnly(clientId);
					else this.removePeer(clientId);
				}
				// Relay bindings are keyed to the pre-drop clientId and can't survive
				// it; drop them so the rebuild below re-attempts direct (or a fresh
				// relay hello). Unlisted relay peers genuinely left.
				for (const clientId of [...this.relayPeers.keys()]) this.removePeer(clientId);
				// The newcomer (us) initiates toward every existing member;
				// collisions are handled by perfect negotiation. ensurePeer() builds
				// a fresh connection for every clientId (the quiet teardown above left
				// none in the map), each of which re-verifies via hello.
				for (const peerId of listed) {
					try {
						this.ensurePeer(peerId);
					} catch (error) {
						// No WebRTC at all (blocked/unsupported): relay last resort.
						console.warn('[P2P] RTCPeerConnection unavailable, trying relay:', error);
						void this.offerRelay(peerId);
					}
				}
				break;
			}

			case 'peer-joined':
				// Newcomer initiates; nothing to do until their offer arrives.
				break;

			case 'peer-left':
				if (message.clientId) this.removePeer(message.clientId);
				break;

			case 'offer':
			case 'answer':
				if (message.fromId && message.data) {
					await this.handleDescription(message.fromId, message.data as AuthedPayload, source);
				}
				break;

			case 'ice-candidate':
				if (message.fromId && message.data) {
					await this.handleCandidate(message.fromId, message.data as AuthedPayload, source);
				}
				break;

			case 'relay':
				if (message.fromId && message.data) {
					await this.handleRelay(message.fromId, message.data as unknown as AuthedPayload, source);
				}
				break;

			case 'error':
				console.warn('[P2P] signaling error:', message.error);
				break;
		}
	}

	// ============ peers / perfect negotiation ============

	private isCurrentPeer(peer: Peer): boolean {
		// clientId can change on signaling reconnect; identity must still match
		// after replacement, including when an async callback resumes.
		return !this.disposed && this.peers.get(peer.clientId) === peer;
	}

	private ensurePeer(clientId: string): Peer {
		const existing = this.peers.get(clientId);
		if (existing) return existing;

		const pc = new RTCPeerConnection(this.buildRtcConfig());

		// Negotiated channels: identical on both sides, no ondatachannel race.
		const chat = pc.createDataChannel('chat', {
			negotiated: true,
			id: CHAT_CHANNEL_ID,
			ordered: true
		});
		const eph = pc.createDataChannel('eph', {
			negotiated: true,
			id: EPH_CHANNEL_ID,
			ordered: false,
			maxRetransmits: 0
		});

		const peer: Peer = {
			clientId,
			deviceId: null,
			pc,
			chat,
			eph,
			makingOffer: false,
			ignoreOffer: false,
			isSettingRemoteAnswerPending: false,
			// Provisional politeness from clientIds; both sides see the same
			// pair, so the comparison is symmetric per pairing. Refined to
			// deviceIds once known.
			polite: (this.myClientId ?? '') < clientId,
			verified: false,
			helloSent: false,
			queuedCandidates: [],
			restartTimer: null,
			attemptTimer: null,
			restartAttempts: 0,
			chatQueue: [],
			chatQueueBytes: 0,
			chatDraining: false,
			grantedGeneration: null
		};
		this.peers.set(clientId, peer);
		this.armIceAttemptDeadline(peer);

		pc.onnegotiationneeded = async () => {
			if (!this.isCurrentPeer(peer)) return;
			try {
				peer.makingOffer = true;
				await pc.setLocalDescription();
				if (!this.isCurrentPeer(peer)) return;
				await this.sendAuthedSignaling(peer, 'offer', { description: pc.localDescription! });
			} catch (error) {
				console.warn('[P2P] negotiation failed:', error);
			} finally {
				peer.makingOffer = false;
			}
		};

		pc.onicecandidate = async ({ candidate }) => {
			if (candidate && this.isCurrentPeer(peer)) {
				await this.sendAuthedSignaling(peer, 'ice-candidate', { candidate: candidate.toJSON() });
			}
		};

		pc.onconnectionstatechange = () => {
			if (!this.isCurrentPeer(peer)) return;
			if (pc.connectionState === 'failed') {
				this.scheduleIceRestart(peer);
			} else if (pc.connectionState === 'connected') {
				peer.restartAttempts = 0;
				this.clearIceTimers(peer);
			} else if (pc.connectionState === 'closed') {
				this.removePeer(peer.clientId);
			} else {
				this.armIceAttemptDeadline(peer);
			}
		};

		chat.onopen = () => void this.sendHello(peer);
		chat.onmessage = (event) => this.enqueueChatMessage(peer, event.data);
		eph.onmessage = (event) => void this.handleChannelMessage(peer, event.data);

		// In-band media channels (§5): created per transfer by the sender.
		pc.ondatachannel = ({ channel }) => {
			if (!channel.label.startsWith('media-')) return;
			if (!this.isCurrentPeer(peer) || !peer.verified || !peer.deviceId) {
				channel.close();
				return;
			}
			const transferId = channel.label.slice('media-'.length);
			this.onMediaChannelCallback?.(peer.deviceId, transferId, channel);
		};

		return peer;
	}

	private buildRtcConfig(): RTCConfiguration {
		const iceServers: RTCIceServer[] = [{ urls: 'stun:stun.cloudflare.com:3478' }];
		if (!this.config.strictDirect) {
			if (this.config.turnServers?.length) iceServers.push(...this.config.turnServers);
			if (this.managedIceServers.length) iceServers.push(...this.managedIceServers);
		}
		return {
			iceServers,
			iceCandidatePoolSize: this.config.icePoolSize ?? 0
		};
	}

	private async handleDescription(
		fromId: string,
		payload: AuthedPayload,
		source?: WebSocket
	): Promise<void> {
		const deviceId = await this.verifyAuth(fromId, payload);
		if (!this.isCurrentSignaling(source)) return;
		if (!deviceId) {
			console.warn(`[P2P] dropping unauthenticated description from ${fromId}`);
			return;
		}
		const description = payload.description;
		if (!description) return;

		// A known device arriving under a new clientId means their signaling
		// reconnected: rekey the existing peer instead of creating a ghost.
		const knownClient = this.deviceToClient.get(deviceId);
		if (knownClient && knownClient !== fromId) {
			const existing = this.peers.get(knownClient);
			if (existing) {
				this.peers.delete(knownClient);
				existing.clientId = fromId;
				this.peers.set(fromId, existing);
			}
			const relay = this.relayPeers.get(knownClient);
			if (relay) {
				this.relayPeers.delete(knownClient);
				this.relayPeers.set(fromId, relay);
			}
			this.deviceToClient.set(deviceId, fromId);
		}

		let peer: Peer;
		try {
			peer = this.ensurePeer(fromId);
		} catch (error) {
			// Their offer reached us but we cannot do WebRTC: relay instead.
			console.warn('[P2P] RTCPeerConnection unavailable, answering via relay:', error);
			void this.offerRelay(fromId);
			return;
		}
		peer.deviceId = deviceId;
		// Device ordering survives reconnects; tabs sharing an identity need
		// the connection-specific clientIds to choose complementary roles.
		peer.polite =
			this.session.deviceId === deviceId
				? (this.myClientId ?? '') < fromId
				: this.session.deviceId < deviceId;

		const pc = peer.pc;
		const readyForOffer =
			!peer.makingOffer && (pc.signalingState === 'stable' || peer.isSettingRemoteAnswerPending);
		const offerCollision = description.type === 'offer' && !readyForOffer;

		peer.ignoreOffer = !peer.polite && offerCollision;
		if (peer.ignoreOffer) return;

		try {
			peer.isSettingRemoteAnswerPending = description.type === 'answer';
			await pc.setRemoteDescription(description);
		} finally {
			peer.isSettingRemoteAnswerPending = false;
		}
		if (!this.isCurrentPeer(peer) || !this.isCurrentSignaling(source)) return;

		for (const candidate of peer.queuedCandidates.splice(0)) {
			try {
				await pc.addIceCandidate(candidate);
			} catch (error) {
				if (!peer.ignoreOffer) console.warn('[P2P] queued candidate failed:', error);
			}
			if (!this.isCurrentPeer(peer) || !this.isCurrentSignaling(source)) return;
		}

		if (description.type === 'offer') {
			await pc.setLocalDescription();
			if (!this.isCurrentPeer(peer) || !this.isCurrentSignaling(source)) return;
			await this.sendAuthedSignaling(peer, 'answer', { description: pc.localDescription! });
		}
	}

	private async handleCandidate(
		fromId: string,
		payload: AuthedPayload,
		source?: WebSocket
	): Promise<void> {
		const deviceId = await this.verifyAuth(fromId, payload);
		if (!this.isCurrentSignaling(source)) return;
		if (!deviceId) return;
		const candidate = payload.candidate;
		if (!candidate) return;

		const peer = this.peers.get(fromId);
		if (!peer) return;
		if (!peer.pc.remoteDescription) {
			peer.queuedCandidates.push(candidate);
			return;
		}
		try {
			await peer.pc.addIceCandidate(candidate);
		} catch (error) {
			if (!peer.ignoreOffer) console.warn('[P2P] addIceCandidate failed:', error);
		}
	}

	private clearIceTimers(peer: Peer): void {
		if (peer.attemptTimer) clearTimeout(peer.attemptTimer);
		if (peer.restartTimer) clearTimeout(peer.restartTimer);
		peer.attemptTimer = null;
		peer.restartTimer = null;
	}

	private armIceAttemptDeadline(peer: Peer): void {
		if (
			!this.isCurrentPeer(peer) ||
			peer.pc.connectionState === 'connected' ||
			peer.attemptTimer ||
			peer.restartTimer
		)
			return;
		// Browsers can stall in new/connecting without ever reporting failed.
		// Signaling progress does not extend an attempt or replenish its budget.
		peer.attemptTimer = setTimeout(() => {
			peer.attemptTimer = null;
			if (!this.isCurrentPeer(peer) || peer.pc.connectionState === 'connected') return;
			this.scheduleIceRestart(peer);
		}, this.config.offerTimeout ?? 15000);
	}

	private scheduleIceRestart(peer: Peer): void {
		if (peer.restartTimer || !this.isCurrentPeer(peer)) return;
		if (peer.attemptTimer) clearTimeout(peer.attemptTimer);
		peer.attemptTimer = null;
		if (peer.restartAttempts >= MAX_RESTART_ATTEMPTS) {
			// Out of restarts: relay last resort (if allowed), else drop.
			if (this.config.allowRelayFallback !== false && !this.config.strictDirect && peer.deviceId) {
				void this.enterRelayMode(peer);
			} else {
				this.removePeer(peer.clientId);
			}
			return;
		}
		const delay = Math.min(1000 * 2 ** peer.restartAttempts, 15000);
		peer.restartAttempts++;
		peer.restartTimer = setTimeout(() => {
			peer.restartTimer = null;
			if (!this.isCurrentPeer(peer) || peer.pc.connectionState === 'connected') return;
			try {
				peer.pc.restartIce(); // triggers negotiationneeded → fresh offer
			} catch (error) {
				console.warn('[P2P] restartIce failed:', error);
			} finally {
				this.armIceAttemptDeadline(peer);
			}
		}, delay);
	}

	// ============ channel data ============

	private enqueueChatMessage(peer: Peer, raw: unknown): void {
		if (!this.isCurrentPeer(peer) || typeof raw !== 'string') return;
		const bytes = new TextEncoder().encode(raw).byteLength;
		if (
			peer.chatQueue.length >= MAX_QUEUED_CHAT_MESSAGES ||
			peer.chatQueueBytes + bytes > MAX_QUEUED_CHAT_BYTES
		) {
			console.warn('[P2P] reliable receive queue exceeded; closing peer');
			this.removePeer(peer.clientId);
			return;
		}
		peer.chatQueue.push({ raw, bytes });
		peer.chatQueueBytes += bytes;
		if (!peer.chatDraining) void this.drainChatMessages(peer);
	}

	private async drainChatMessages(peer: Peer): Promise<void> {
		peer.chatDraining = true;
		try {
			while (this.isCurrentPeer(peer)) {
				const next = peer.chatQueue.shift();
				if (!next) break;
				peer.chatQueueBytes -= next.bytes;
				try {
					await this.handleChannelMessage(peer, next.raw);
				} catch (error) {
					console.warn('[P2P] reliable message failed:', error);
				}
			}
		} finally {
			peer.chatDraining = false;
		}
	}

	private async sendHello(peer: Peer): Promise<void> {
		if (peer.helloSent || !this.isCurrentPeer(peer)) return;
		peer.helloSent = true;
		try {
			await this.queueReliableSend(async () => {
				if (!this.isCurrentPeer(peer)) return;
				const binding = this.channelBinding(peer.pc);
				const wire = await this.session.makeHello(this.displayName(), binding);
				if (!this.isCurrentPeer(peer)) return;
				peer.chat.send(wire);
			});
		} catch (error) {
			console.warn('[P2P] hello send failed:', error);
			peer.helloSent = false;
		}
	}

	/**
	 * Sorted DTLS fingerprint pair from the negotiated SDP (§3.4), as
	 * separate lp() fields (§0 — no delimiter joining).
	 */
	private channelBinding(pc: RTCPeerConnection): HelloBinding {
		const extract = (sdp: string | undefined): string =>
			[...(sdp ?? '').matchAll(/^a=fingerprint:\S+\s+(\S+)\s*$/gim)].map((m) => m[1])[0] ?? '';
		const pair = [extract(pc.localDescription?.sdp), extract(pc.remoteDescription?.sdp)].sort();
		return { label: 'hello-v4', fields: pair };
	}

	private async handleChannelMessage(peer: Peer, raw: unknown): Promise<void> {
		if (!this.isCurrentPeer(peer) || typeof raw !== 'string') return;
		let envelope: Envelope;
		try {
			envelope = JSON.parse(raw);
		} catch {
			return;
		}

		// hello first: it proves key knowledge and registers identity
		if (!peer.verified) {
			const info = await this.session.acceptHello(envelope, this.channelBinding(peer.pc));
			if (!this.isCurrentPeer(peer)) return;
			if (info) {
				peer.deviceId = info.deviceId;
				peer.verified = true;
				peer.grantedGeneration = { g: info.g, gid: info.gid };
				this.deviceToClient.set(info.deviceId, peer.clientId);
				// Direct supersedes relay: a stale verified relay entry would
				// keep ciphertext flowing through the server while the UI
				// says "direct" — a false security indication.
				this.relayPeers.delete(peer.clientId);
				await this.sendHello(peer); // reciprocate if their hello came first
				if (!this.isCurrentPeer(peer)) return;
				this.onPeerConnectedCallback?.(info.deviceId, 'direct');
				await this.respondToAdvertisedGeneration(peer, info.g, info.gid);
			} else {
				this.onKnockingCallback?.(peer.clientId);
			}
			return;
		}

		try {
			const body = (await this.session.openMessage(
				envelope,
				peer.deviceId ?? ''
			)) as unknown as TypedP2PMessage;
			if (!this.isCurrentPeer(peer)) return;
			const type = (body as { type?: string }).type;
			if (type === 'hello') {
				// Duplicate hello: identity already pinned, but the generation
				// advertisement may have moved (§3.4).
				const dup = body as unknown as { g?: number; gid?: string };
				if (Number.isInteger(dup.g) && typeof dup.gid === 'string') {
					await this.respondToAdvertisedGeneration(peer, dup.g!, dup.gid);
				}
				return;
			}
			if (type === 'rekey-grant' || type === 'rekey-request') {
				await this.handleRekeyBody(peer, body as unknown as Record<string, unknown>);
				return;
			}
			if (peer.deviceId) this.onMessageCallback?.(body, peer.deviceId);
		} catch (error) {
			if (!this.isCurrentPeer(peer)) return;
			console.warn('[P2P] dropping envelope:', error);
			// A verified peer sealed something we cannot read at its stated
			// generation: ask for the generation, rate-limited (§1.4).
			if (envelope.t !== 'hs') void this.requestGenerationFrom(peer, envelope.g);
		}
	}

	// ============ generation ratchet choreography (§1.4/§3.4) ============

	/**
	 * §3.4: a verified hello advertising a generation we hold while the
	 * peer is behind (or a sibling we lack) prompts a grant; a generation
	 * ahead of ours prompts a request. The hello itself never moves us.
	 */
	private async respondToAdvertisedGeneration(
		peer: Peer,
		peerG: number,
		peerGid: string
	): Promise<void> {
		try {
			const mine = this.session.generation;
			if (peerG > mine.g) {
				await this.requestGenerationFrom(peer, peerG, peerGid);
				return;
			}
			if (peerG === 0 && mine.g === 0) {
				// Both at the link generation: a newcomer joined a fresh room —
				// the join trigger (debounced, minter-selected) ratchets it.
				this.onNewcomerCallback?.(peer.deviceId ?? peer.clientId);
				return;
			}
			if (peerG < mine.g || !this.session.hasGeneration(peerG, peerGid)) {
				if (!peer.deviceId) return;
				// Same inbound cooldown as the rekey-request answer: a peer
				// re-sending hellos (fresh epoch:seq) must not force one KEM
				// encapsulation per hello. Shared gate caps total grant-serving
				// per peer across both triggers; the first hello always passes.
				if (!this.rekeyRespondGate.allow(peer.deviceId)) return;
				await this.queueReliableSend(() => this.sendCurrentGrant(peer, peerG, peerGid));
				if (!this.isCurrentPeer(peer)) return;
				// A peer still at the link generation is a newcomer (§1.4
				// trigger a): grant it the current generation for immediate
				// readability, then let the join trigger ratchet the room.
				if (peerG === 0) this.onNewcomerCallback?.(peer.deviceId ?? peer.clientId);
			}
		} catch (error) {
			console.warn('[P2P] generation response failed:', error);
		}
	}

	/** Direct-only rekey-request, rate-limited per peer (§1.4). */
	private async requestGenerationFrom(peer: Peer, g: number, gid?: string): Promise<void> {
		if (!peer.verified || peer.chat.readyState !== 'open') return;
		if (!Number.isInteger(g) || g <= 0) return;
		// Only ask when the generation is actually missing — a failure we
		// could have decrypted (replay, corruption) is not a key gap.
		if (this.session.canReadGeneration(g) && gid === undefined) return;
		if (!peer.deviceId || !this.rekeyRequestGate.allow(peer.deviceId)) return;
		try {
			await this.queueReliableSend(async () => {
				if (!this.isCurrentPeer(peer) || peer.chat.readyState !== 'open') return;
				const wire = await this.session.makeRekeyRequestWire(g, gid);
				if (this.isCurrentPeer(peer) && peer.chat.readyState === 'open') peer.chat.send(wire);
			});
		} catch (error) {
			console.warn('[P2P] rekey-request send failed:', error);
		}
	}

	/** Verified rekey bodies — never surfaced to the app layer. */
	private async handleRekeyBody(peer: Peer, body: Record<string, unknown>): Promise<void> {
		if (!peer.deviceId) return;
		if (body.type === 'rekey-request') {
			// Answer with a chained grant, minting if we cannot grant (§1.4).
			// Rate-limited inbound so a request-flooder cannot force unbounded
			// KEM encapsulations; honest catch-up (≤ 1 req/5 s/peer) is unaffected.
			if (!this.rekeyRespondGate.allow(peer.deviceId)) return;
			await this.queueReliableSend(async () => {
				if (!this.isCurrentPeer(peer) || !peer.deviceId || peer.chat.readyState !== 'open') return;
				const generation = this.session.generation;
				const wire = await this.session.handleRekeyRequest(body as never, peer.deviceId);
				if (!this.isCurrentPeer(peer) || peer.chat.readyState !== 'open') return;
				peer.chat.send(wire);
				peer.grantedGeneration = generation;
			});
			return;
		}
		const outcome = await this.session.handleRekeyGrant(body as never);
		const grant = (body as { grant?: { g?: number; gid?: string } }).grant;
		if (outcome === 'adopted') {
			// Gossip: re-grant verbatim to our verified direct peers so
			// meshes and partitions converge without the minter reaching
			// everyone (§1.4). Duplicates die as 'stale' at the receivers.
			this.segmentNoProgress.delete(peer.deviceId);
			this.gossipCurrentGrant(peer.clientId);
		} else if (outcome === 'extended') {
			// Segmented catch-up advanced our frontier (§1.4): ask the same
			// peer for the next bounded segment. This immediate follow-up is
			// usually swallowed by the 5 s outbound cooldown (just stamped by
			// the request that produced this round) — by design: catch-up is
			// re-pumped by the steady stream of undecryptable current-
			// generation envelopes (each retriggers a request once the
			// cooldown opens) and by hello advertisements, so it converges
			// while there is current traffic to read and defers harmlessly in
			// a quiet room. The frontier is preserved in memory across the gap.
			this.segmentNoProgress.delete(peer.deviceId);
			if (grant && Number.isInteger(grant.g)) {
				await this.requestGenerationFrom(peer, grant.g!, grant.gid);
			}
		} else if (outcome === 'wedged') {
			// Past the segmented depth cap (§1.4): stop asking this peer. The
			// member stays at its generation until a peer on a reachable line
			// serves it or it re-enters through the link.
			this.segmentNoProgress.delete(peer.deviceId);
		} else if (outcome === 'behind') {
			// No anchor this round. A shallow gap resolves on a follow-up
			// request; a deep fork never anchors, so bound the retries —
			// after the cap, stop (the documented link re-entry applies).
			const n = (this.segmentNoProgress.get(peer.deviceId) ?? 0) + 1;
			if (n < SEGMENT_NO_PROGRESS_LIMIT && grant && Number.isInteger(grant.g)) {
				this.segmentNoProgress.set(peer.deviceId, n);
				await this.requestGenerationFrom(peer, grant.g!, grant.gid);
			} else {
				this.segmentNoProgress.delete(peer.deviceId);
			}
		} else if (outcome === 'rejected') {
			// Their line lost a fork tie-break (§1.4): the winning side
			// converges the room by answering with its own chained grant so
			// the heal applies in the other direction. Rate-limited; an
			// already-converged sender drops the reply as 'stale'.
			if (peer.chat.readyState === 'open' && this.forkReplyGate.allow(peer.deviceId)) {
				try {
					await this.queueReliableSend(() => this.sendCurrentGrant(peer));
				} catch (error) {
					console.warn('[P2P] fork-heal reply failed:', error);
				}
			}
		}
	}

	/**
	 * Send a grant wire to every verified direct peer (never the relay).
	 * Per-recipient wires (§1.4 v4): each peer gets the secret wrapped to
	 * its own pinned KEM key; the signed cert inside is identical.
	 */
	private gossipCurrentGrant(excludeClientId?: string): void {
		void this.queueReliableSend(() => this.sendGrants(excludeClientId)).catch((error) => {
			console.warn('[P2P] grant gossip failed:', error);
		});
	}

	/** Broadcast a freshly minted grant (manager-driven trigger, §1.4). */
	async broadcastGrant(): Promise<void> {
		await this.queueReliableSend(() => this.sendGrants());
	}

	/** Mint and deliver grants before any later reliable body can use their keys. */
	async mintAndBroadcastGrant(): Promise<void> {
		await this.queueReliableSend(async () => {
			await this.session.mintGeneration();
			if (!this.disposed) await this.sendGrants();
		});
	}

	private async sendGrants(excludeClientId?: string): Promise<void> {
		for (const p of this.peers.values()) {
			if (p.clientId === excludeClientId) continue;
			if (p.verified && p.deviceId && p.chat.readyState === 'open') {
				try {
					await this.sendCurrentGrant(p);
				} catch (error) {
					console.warn('[P2P] grant broadcast failed:', error);
				}
			}
		}
	}

	// ============ relay last resort ============

	private async enterRelayMode(peer: Peer): Promise<void> {
		const clientId = peer.clientId;
		this.removePeerConnectionOnly(clientId);
		await this.offerRelay(clientId);
	}

	/** Send a relay-hello; the peer entry is created when theirs verifies. */
	private async offerRelay(clientId: string): Promise<void> {
		if (this.config.allowRelayFallback === false || this.config.strictDirect) return;
		await this.queueReliableSend(async () => {
			const hello = await this.session.makeHello(this.displayName(), this.relayBinding(clientId));
			if (!this.disposed) {
				this.sendSignaling({ type: 'relay', targetId: clientId, data: { hello } as never });
			}
		});
	}

	private relayBinding(peerClientId: string): HelloBinding {
		// Sorted so both ends compute the same binding (§3.4 relay variant);
		// distinct label and lp() fields (§0) — a relay hello can never be
		// replayed as a direct one or vice versa.
		const pair = [this.myClientId ?? '', peerClientId].sort();
		return { label: 'hello-relay-v4', fields: [pair[0], pair[1], this.roomId] };
	}

	private async handleRelay(
		fromId: string,
		payload: AuthedPayload,
		source?: WebSocket
	): Promise<void> {
		if (payload.hello) {
			const info = await this.session.acceptHello(payload.hello, this.relayBinding(fromId));
			if (!this.isCurrentSignaling(source)) return;
			if (info) {
				const existing = this.relayPeers.get(fromId);
				this.relayPeers.set(fromId, { deviceId: info.deviceId, verified: true });
				this.deviceToClient.set(info.deviceId, fromId);
				if (!existing) {
					// Their side initiated relay mode; reciprocate the hello.
					await this.offerRelay(fromId);
				}
				if (!this.isCurrentSignaling(source)) return;
				this.onPeerConnectedCallback?.(info.deviceId, 'relay');
			} else {
				this.onKnockingCallback?.(fromId);
			}
			return;
		}

		const envelope = payload.envelope;
		if (!envelope) return;
		// Inbound mirror of the outbound relay policy (§3.5/§3.6): eph,
		// sync, and media bodies are rejected even if a modified peer
		// pushes them through the server.
		if (envelope.t !== 'msg') return;
		const relay = this.relayPeers.get(fromId);
		if (!relay?.verified) return;
		try {
			const body = (await this.session.openMessage(
				envelope,
				relay.deviceId
			)) as unknown as TypedP2PMessage;
			if (!this.isCurrentSignaling(source)) return;
			if (RELAY_FORBIDDEN_TYPES.has(body.type)) {
				console.warn('[P2P] dropping relay-forbidden body type:', body.type);
				return;
			}
			this.onMessageCallback?.(body, relay.deviceId);
		} catch (error) {
			console.warn('[P2P] dropping relayed envelope:', error);
		}
	}

	// ============ teardown ============

	/** Close the RTCPeerConnection without firing peer-disconnected. */
	private removePeerConnectionOnly(clientId: string): void {
		const peer = this.peers.get(clientId);
		if (!peer) return;
		this.peers.delete(clientId);
		peer.chatQueue.length = 0;
		peer.chatQueueBytes = 0;
		this.clearIceTimers(peer);
		try {
			peer.chat.close();
			peer.eph.close();
			peer.pc.close();
		} catch {
			/* already closed */
		}
	}

	private removePeer(clientId: string): void {
		const peer = this.peers.get(clientId);
		const relay = this.relayPeers.get(clientId);

		if (peer) {
			this.removePeerConnectionOnly(clientId);
			if (peer.deviceId) {
				this.deviceToClient.delete(peer.deviceId);
				this.rekeyRequestGate.forget(peer.deviceId);
				this.forkReplyGate.forget(peer.deviceId);
				this.rekeyRespondGate.forget(peer.deviceId);
				this.segmentNoProgress.delete(peer.deviceId);
				if (peer.verified) this.onPeerDisconnectedCallback?.(peer.deviceId);
			}
		}
		if (relay) {
			this.relayPeers.delete(clientId);
			this.deviceToClient.delete(relay.deviceId);
			this.rekeyRequestGate.forget(relay.deviceId);
			this.forkReplyGate.forget(relay.deviceId);
			this.rekeyRespondGate.forget(relay.deviceId);
			this.segmentNoProgress.delete(relay.deviceId);
			if (relay.verified && !peer?.verified) this.onPeerDisconnectedCallback?.(relay.deviceId);
		}
	}
}
