/**
 * P2P Manager
 * High-level API for P2P lifecycle orchestration
 */

import { P2PConnection } from './connection';
import { CryptoSession } from './crypto-session';
import { shouldMint } from './rekey-policy';
import { parseKeyFragment } from '$lib/crypto/keys';
import { routeP2PMessage, setMediaControlFn, setSendToPeerFn, emitToast } from './handlers';
import { MediaTransferEngine, type MediaKind, type MediaOffer } from '$lib/media/transfer';
import { saveRoomMessages } from '$lib/storage/messages';
import type { Message } from '$lib/types/message';
import { connection, user, drafts, currentRoomId, messages, delivery, transfers, mediaConsent } from '$lib/stores';
import type { P2PConfig, TypedP2PMessage, ChatMessage, TypingMessage, EditMessage, DeleteMessage, ReactionMessage, UserConnectedMessage, SyncRequestMessage } from './types';
import { get } from 'svelte/store';

/** Thrown when the URL has no key fragment and no stored keys exist. */
export class NoRoomKeyError extends Error {
	constructor() {
		super('no room key: ask for the full invite link');
		this.name = 'NoRoomKeyError';
	}
}

// Module-level state
let p2pConnection: P2PConnection | null = null;
let cryptoSession: CryptoSession | null = null;
let mediaEngine: MediaTransferEngine | null = null;
let reconnectAttempts = 0;
let reconnectInterval: ReturnType<typeof setInterval> | null = null;
let lastP2PConfig: Partial<P2PConfig> | undefined = undefined;

const MAX_RECONNECT_ATTEMPTS = 7;
const BASE_RECONNECT_DELAY = 1000;
const MAX_RECONNECT_DELAY = 30000;
const DISCONNECT_CLEANUP_DELAY = 500; // Wait for WebSocket to fully close

// Lifecycle handler state
let visibilityHandler: (() => void) | null = null;
let networkHandler: (() => void) | null = null;
let pageLifecycleCleanup: (() => void) | null = null;
let lastHiddenTime: number = 0;
const STALE_CONNECTION_THRESHOLD = 30000; // 30 seconds - reconnect if hidden longer

// Prevent concurrent disconnect/connect operations
let isDisconnecting = false;
let disconnectPromise: Promise<void> | null = null;
let isInitializing = false;
let currentInitRoomId: string | null = null;

// Generation ratchet triggers (PROTOCOL.md §1.4): join/leave events are
// debounced into one mint decision; the lowest-deviceId direct member
// mints, everyone else arms a fallback in case the designated minter is
// gone. Concurrent mints converge by (g, gid) regardless.
let rekeyDebounce: ReturnType<typeof setTimeout> | null = null;
let rekeyFallback: ReturnType<typeof setTimeout> | null = null;
let rekeyBaseline: { g: number; gid: string } | null = null;
let rekeyChannel: BroadcastChannel | null = null;
const REKEY_DEBOUNCE_MS = 2000;
const REKEY_FALLBACK_MS = 6000;

function scheduleRekey(): void {
	if (isDisconnecting || !cryptoSession || !p2pConnection) return;
	rekeyBaseline ??= cryptoSession.generation;
	if (rekeyDebounce) clearTimeout(rekeyDebounce);
	rekeyDebounce = setTimeout(() => {
		rekeyDebounce = null;
		const session = cryptoSession;
		const conn = p2pConnection;
		const baseline = rekeyBaseline;
		rekeyBaseline = null;
		if (!session || !conn || !baseline) return;
		// Someone already ratcheted past the trigger point: nothing to do.
		if (session.generation.g !== baseline.g || session.generation.gid !== baseline.gid) return;
		if (shouldMint(session.deviceId, conn.getDirectPeers())) {
			void mintAndBroadcast();
		} else if (!rekeyFallback) {
			rekeyFallback = setTimeout(() => {
				rekeyFallback = null;
				const s = cryptoSession;
				if (!s || isDisconnecting) return;
				// The designated minter never delivered: mint ourselves.
				if (s.generation.g === baseline.g && s.generation.gid === baseline.gid) {
					void mintAndBroadcast();
				}
			}, REKEY_FALLBACK_MS);
		}
	}, REKEY_DEBOUNCE_MS);
}

async function mintAndBroadcast(): Promise<void> {
	const session = cryptoSession;
	const conn = p2pConnection;
	if (!session || !conn) return;
	try {
		const wire = await session.mintGeneration();
		conn.broadcastGrant(wire);
		console.log('[P2P Manager] Ratcheted to generation', session.generation.g);
	} catch (error) {
		console.error('[P2P Manager] Mint failed:', error);
	}
}

function clearRekeyState(): void {
	if (rekeyDebounce) clearTimeout(rekeyDebounce);
	if (rekeyFallback) clearTimeout(rekeyFallback);
	rekeyDebounce = null;
	rekeyFallback = null;
	rekeyBaseline = null;
	rekeyChannel?.close();
	rekeyChannel = null;
}

/**
 * Initialize P2P connection for a room
 */
export async function initializeP2P(roomId: string, config?: Partial<P2PConfig>): Promise<void> {
	console.log('[P2P Manager] Initializing P2P for room:', roomId);
	lastP2PConfig = config;

	// Prevent concurrent initialization for the same room
	if (isInitializing && currentInitRoomId === roomId) {
		console.log('[P2P Manager] Already initializing for this room, skipping duplicate call');
		return;
	}

	// Wait for any in-progress disconnect to complete
	if (disconnectPromise) {
		console.log('[P2P Manager] Waiting for previous disconnect to complete...');
		await disconnectPromise;
	}

	// Mark as initializing
	isInitializing = true;
	currentInitRoomId = roomId;

	// Disconnect existing connection if any
	if (p2pConnection) {
		await disconnectP2PAsync();
	}

	// Get user info from store
	const userState = get(user);
	if (!userState.initialized || !userState.id) {
		throw new Error('User not initialized');
	}

	connection.setStatus('connecting');

	// Room crypto: fragment key from the URL, or previously stored keys.
	if (!cryptoSession || cryptoSession.roomId !== roomId) {
		const fragmentKey =
			typeof window !== 'undefined' ? parseKeyFragment(window.location.hash) : null;
		cryptoSession = await CryptoSession.create(roomId, fragmentKey);
		if (!cryptoSession) {
			isInitializing = false;
			currentInitRoomId = null;
			connection.setStatus('disconnected');
			throw new NoRoomKeyError();
		}
	}

	// Generation ratchet plumbing (§1.4): surface changes to the UI store,
	// notify sibling tabs, and pick up their changes.
	connection.setGeneration(cryptoSession.generation.g, cryptoSession.generation.gid);
	cryptoSession.onGenerationChange((g, gid) => {
		connection.setGeneration(g, gid);
		try {
			rekeyChannel?.postMessage({ roomId, g, gid });
		} catch {
			/* channel may be closed during teardown */
		}
	});
	if (typeof BroadcastChannel !== 'undefined') {
		rekeyChannel?.close();
		rekeyChannel = new BroadcastChannel('mindline_rekey');
		rekeyChannel.onmessage = (event: MessageEvent) => {
			const data = event.data as { roomId?: string } | undefined;
			if (data?.roomId === roomId) void cryptoSession?.refreshFromStore();
		};
	}

	// Create connection
	p2pConnection = new P2PConnection(cryptoSession, config, () => get(user).name);

	// Set up the sendToPeer function for handlers
	setSendToPeerFn((peerId: string, message: TypedP2PMessage) => {
		if (p2pConnection) {
			p2pConnection.sendToPeer(peerId, message);
		}
	});

	// Set up handlers
	p2pConnection.onMessage((message, peerId) => {
		routeP2PMessage(message, peerId);
	});

	p2pConnection.onPeerConnected((peerId, transport) => {
		console.log('[P2P Manager] Peer connected:', peerId, `(${transport})`);
		connection.addPeer(peerId, undefined, transport);

		// Target only the new peer: broadcasting here caused O(N^2)
		// hello/sync storms in heavy rooms (ported stability fix).
		sendUserConnectedTo(peerId);

		// Request sync from the new peer after the channel stabilizes.
		// History never relays (§3.5): only direct peers can serve sync.
		if (transport === 'direct') {
			setTimeout(() => requestSyncFrom(peerId, roomId), 1000);
		}

		// Re-announce in case the first one raced the channel opening
		setTimeout(() => sendUserConnectedTo(peerId), 500);
	});

	p2pConnection.onPeerDisconnected((peerId) => {
		console.log('[P2P Manager] Peer disconnected:', peerId);

		// Get peer name before removing (for friendly notification)
		const peerName = connection.getPeerName(peerId);

		connection.removePeer(peerId);
		drafts.clearDraft(peerId);

		// Update delivery tracking - adjust totals for this peer
		delivery.handlePeerDisconnect(peerId);

		// Emit toast notification with name if available
		const displayName = peerName || `Peer ${peerId.slice(0, 8)}...`;
		emitToast('peer-left', `${displayName} left the room`);

		// §1.4 trigger (b): a member left — rotate the generation so a
		// departed device's retained keys stop reading future captures.
		scheduleRekey();
	});

	p2pConnection.onKnocking((clientId) => {
		console.warn('[P2P Manager] Peer without the room key knocked:', clientId);
	});

	// §1.4 trigger (a): a verified newcomer joined over direct — ratchet,
	// debounced, with minter selection. Relay-only joins never trigger
	// (grants cannot reach them; ratcheting would only strand them).
	p2pConnection.onNewcomer(() => scheduleRekey());

	// Media transfers (PROTOCOL.md §5)
	const conn = p2pConnection;
	const session = cryptoSession;
	mediaEngine = new MediaTransferEngine({
		session,
		roomId,
		sendControl: (peerDeviceId, message) => conn.sendToPeer(peerDeviceId, message),
		openChannel: (peerDeviceId, label) => conn.openMediaChannel(peerDeviceId, label),
		events: {
			onProgress: (progress) => {
				transfers.setProgress(progress);
				if (progress.status === 'offered') {
					const pending = mediaEngine?.pendingConsent.get(progress.transferId);
					if (pending) mediaConsent.add(pending);
				}
				if (progress.status === 'done') {
					setTimeout(() => transfers.remove(progress.transferId), 1500);
				}
			},
			onReceived: (offer) => {
				const targetRoomId = offer.roomId || roomId;
				const existing = messages.getMessage(targetRoomId, offer.messageId);
				if (existing?.attachment) {
					messages.updateMessage(targetRoomId, offer.messageId, {
						attachment: { ...existing.attachment, state: 'ready' }
					});
					void saveRoomMessages(targetRoomId, messages.getRoomMessages(targetRoomId));
				}
			},
			onAborted: (transferId, reason) => {
				transfers.remove(transferId);
				mediaConsent.remove(transferId);
				const roomMessages = messages.getRoomMessages(roomId);
				const target = roomMessages.find((m) => m.attachment?.transferId === transferId);
				if (target?.attachment) {
					messages.updateMessage(roomId, target.id, {
						attachment: { ...target.attachment, state: 'failed' }
					});
				}
				if (reason !== 'declined') emitToast('error', `Transfer failed: ${reason}`);
			}
		}
	});
	conn.onMediaChannel((peerDeviceId, transferId, channel) => {
		mediaEngine?.attachIncomingChannel(peerDeviceId, transferId, channel);
	});
	setMediaControlFn((message, peerId) => {
		void mediaEngine?.handleControl(message, peerId);
	});

	p2pConnection.onConnectionLost((reason) => {
		console.warn('[P2P Manager] Connection lost:', reason);

		// Don't trigger reconnection if we're intentionally disconnecting
		// This prevents infinite reconnection loops when switching rooms
		if (isDisconnecting) {
			console.log('[P2P Manager] Ignoring connection loss during intentional disconnect');
			return;
		}

		// Healthy DataChannels keep chatting; only signaling needs repair.
		if (p2pConnection?.hasLivePeers()) {
			connection.setStatus('connected');
		} else {
			connection.setStatus('disconnected');
		}
		startReconnection(roomId, config);
	});

	// Connect
	try {
		await p2pConnection.connect();
		connection.setStatus('connected');
		reconnectAttempts = 0;
		console.log('[P2P Manager] Connected successfully');
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : 'Connection failed';
		console.error('[P2P Manager] Connection failed:', errorMessage);
		connection.setError(errorMessage);
		throw error;
	} finally {
		// Clear initialization flag
		isInitializing = false;
		currentInitRoomId = null;
	}
}

/**
 * Disconnect from P2P network (sync version for compatibility)
 */
export function disconnectP2P(): void {
	console.log('[P2P Manager] Disconnecting (sync)');

	// Mark as disconnecting
	isDisconnecting = true;
	clearRekeyState();

	if (reconnectInterval) {
		clearInterval(reconnectInterval);
		reconnectInterval = null;
	}

	if (p2pConnection) {
		p2pConnection.disconnect();
		p2pConnection = null;
	}
	cryptoSession = null;
	mediaEngine = null;
	setMediaControlFn(null);
	transfers.clear();
	mediaConsent.clear();

	connection.reset();
	drafts.clearAll();

	// Reset flag after short delay
	setTimeout(() => {
		isDisconnecting = false;
	}, DISCONNECT_CLEANUP_DELAY);
}

/**
 * Disconnect from P2P network (async version with proper cleanup wait)
 */
async function disconnectP2PAsync(): Promise<void> {
	console.log('[P2P Manager] Disconnecting (async)');

	// Prevent concurrent disconnects
	if (isDisconnecting && disconnectPromise) {
		return disconnectPromise;
	}

	isDisconnecting = true;

	disconnectPromise = new Promise<void>((resolve) => {
		if (reconnectInterval) {
			clearInterval(reconnectInterval);
			reconnectInterval = null;
		}

		if (p2pConnection) {
			p2pConnection.disconnect();
			p2pConnection = null;
		}

		connection.reset();
		drafts.clearAll();

		// Wait for WebSocket and peer connections to fully close
		setTimeout(() => {
			isDisconnecting = false;
			disconnectPromise = null;
			console.log('[P2P Manager] Disconnect cleanup complete');
			resolve();
		}, DISCONNECT_CLEANUP_DELAY);
	});

	return disconnectPromise;
}

/**
 * Broadcast a message to all peers
 */
export function broadcastMessage(message: TypedP2PMessage): boolean {
	if (!p2pConnection) {
		console.warn('[P2P Manager] No P2P connection available for broadcasting');
		return false;
	}

	try {
		const deliveredCount = p2pConnection.broadcast(message);
		return deliveredCount > 0;
	} catch (error) {
		console.error('[P2P Manager] Error broadcasting message:', error);
		return false;
	}
}

/**
 * Broadcast a chat message
 */
export function broadcastChat(content: string, messageId: string): void {
	const userState = get(user);
	const roomId = get(currentRoomId);

	if (!p2pConnection || !userState.initialized || !roomId) {
		console.warn('[P2P Manager] Cannot broadcast chat: not ready');
		return;
	}

	// Get connected peers for delivery tracking
	const connectedPeers = p2pConnection.getConnectedPeers();

	// Initialize delivery tracking for this message
	delivery.trackMessage(messageId, roomId, connectedPeers);

	const message: ChatMessage = {
		type: 'chat',
		content,
		senderId: userState.id,
		senderName: userState.name,
		messageId,
		timestamp: Date.now(),
		roomId
	};

	const deliveredCount = p2pConnection.broadcast(message);
	console.log(`[P2P Manager] Chat broadcast to ${deliveredCount} peers, tracking ${connectedPeers.length}`);
}

/**
 * Broadcast a typing indicator
 */
export function broadcastTyping(content: string): void {
	const userState = get(user);

	if (!p2pConnection || !userState.initialized) {
		return;
	}

	const message: TypingMessage = {
		type: 'typing',
		content,
		senderId: userState.id,
		senderName: userState.name,
		timestamp: Date.now()
	};

	p2pConnection.broadcast(message);
}

/**
 * Broadcast a message edit
 */
export function broadcastEdit(messageId: string, newContent: string): void {
	const userState = get(user);
	const roomId = get(currentRoomId);

	if (!p2pConnection || !userState.initialized || !roomId) {
		console.warn('[P2P Manager] Cannot broadcast edit: not ready');
		return;
	}

	const message: EditMessage = {
		type: 'edit',
		messageId,
		roomId,
		newContent,
		senderId: userState.id,
		timestamp: Date.now()
	};

	p2pConnection.broadcast(message);
}

/**
 * Broadcast a message deletion
 */
export function broadcastDelete(messageId: string): void {
	const userState = get(user);
	const roomId = get(currentRoomId);

	if (!p2pConnection || !userState.initialized || !roomId) {
		console.warn('[P2P Manager] Cannot broadcast delete: not ready');
		return;
	}

	const message: DeleteMessage = {
		type: 'delete',
		messageId,
		roomId,
		senderId: userState.id,
		timestamp: Date.now()
	};

	p2pConnection.broadcast(message);
}

/**
 * Broadcast a reaction
 */
export function broadcastReaction(messageId: string, reaction: string, action: 'add' | 'remove'): void {
	const userState = get(user);
	const roomId = get(currentRoomId);

	if (!p2pConnection || !userState.initialized || !roomId) {
		console.warn('[P2P Manager] Cannot broadcast reaction: not ready');
		return;
	}

	const message: ReactionMessage = {
		type: 'reaction',
		messageId,
		roomId,
		reaction,
		// Display/compat hint only: receivers key membership by the
		// envelope-verified deviceId (PROTOCOL.md §3.5).
		senderId: cryptoSession?.deviceId ?? userState.id,
		senderName: userState.name,
		action,
		timestamp: Date.now()
	};

	p2pConnection.broadcast(message);
}

/**
 * Request message synchronization from peers
 */
function requestSyncFrom(peerDeviceId: string, roomId: string): void {
	if (!p2pConnection) {
		return;
	}

	try {
		const userState = get(user);

		// Get stats from store
		const roomMessages = messages.getRoomMessages(roomId);
		const lastSync = roomMessages.length > 0
			? Math.max(...roomMessages.map(m => m.timestamp))
			: 0;

		const syncRequest: SyncRequestMessage = {
			type: 'sync-request',
			roomId,
			lastSync,
			messageCount: roomMessages.length,
			requesterId: userState.id
		};

		p2pConnection.sendToPeer(peerDeviceId, syncRequest);
		console.log('[P2P Manager] Sync requested from peer:', peerDeviceId);
	} catch (error) {
		console.error('[P2P Manager] Failed to request sync:', error);
	}
}

/**
 * Announce ourselves to one newly connected peer
 */
function sendUserConnectedTo(peerDeviceId: string): void {
	const userState = get(user);

	if (!p2pConnection || !userState.initialized) {
		return;
	}

	const message: UserConnectedMessage = {
		type: 'user-connected',
		senderId: userState.id,
		senderName: userState.name,
		timestamp: Date.now()
	};

	p2pConnection.sendToPeer(peerDeviceId, message);
}

/**
 * Start reconnection with exponential backoff
 */
function startReconnection(roomId: string, config?: Partial<P2PConfig>): void {
	if (reconnectInterval || reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
		if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
			connection.setError('Max reconnection attempts reached');
			connection.clearReconnection();
			emitToast('error', 'Failed to reconnect after multiple attempts');
		}
		return;
	}

	console.log('[P2P Manager] Starting reconnection with exponential backoff...');

	const attemptReconnect = async () => {
		if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
			if (reconnectInterval) {
				clearTimeout(reconnectInterval);
				reconnectInterval = null;
			}
			connection.setError('Max reconnection attempts reached');
			connection.clearReconnection();
			emitToast('error', 'Failed to reconnect after multiple attempts');
			return;
		}

		reconnectAttempts++;

		// Exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s, 30s
		const delay = Math.min(BASE_RECONNECT_DELAY * Math.pow(2, reconnectAttempts - 1), MAX_RECONNECT_DELAY);
		console.log(`[P2P Manager] Reconnection attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} in ${delay}ms`);

		// Update store with reconnection state (before waiting)
		connection.setReconnecting(true, reconnectAttempts, delay);

		await new Promise((r) => setTimeout(r, delay));

		try {
			// Signaling-only repair first: existing DataChannels stay up.
			if (p2pConnection) {
				await p2pConnection.reconnectSignaling();
			} else {
				await initializeP2P(roomId, config);
			}
			if (reconnectInterval) {
				clearTimeout(reconnectInterval);
				reconnectInterval = null;
			}
			connection.setStatus('connected');
			connection.clearReconnection();
			emitToast('success', 'Reconnected successfully');
			console.log('[P2P Manager] Reconnection successful');
		} catch (error) {
			console.warn(`[P2P Manager] Reconnection attempt ${reconnectAttempts} failed:`, error);
			// Schedule next attempt
			if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
				reconnectInterval = setTimeout(attemptReconnect, 0);
			} else {
				connection.clearReconnection();
			}
		}
	};

	// Start first attempt
	reconnectInterval = setTimeout(attemptReconnect, 0);
}

/**
 * Get the current P2P connection (for advanced use)
 */
export function getP2PConnection(): P2PConnection | null {
	return p2pConnection;
}

/** The authenticated device id for this session's room, if joined. */
export function getSessionDeviceId(): string | null {
	return cryptoSession?.deviceId ?? null;
}

/** Room keys for at-rest blob access (UI rendering). */
export function getRoomKeys() {
	return cryptoSession?.roomKeys ?? null;
}

/**
 * Offer media to every connected peer and place the message in the stream.
 */
export async function sendMediaMessage(
	data: Uint8Array,
	meta: {
		kind: MediaKind;
		name: string;
		mime: string;
		thumb?: string;
		thumbMime?: string;
		duration?: number;
		waveform?: number[];
	}
): Promise<void> {
	const userState = get(user);
	const roomId = get(currentRoomId);
	if (!mediaEngine || !p2pConnection || !roomId || !userState.initialized) {
		throw new Error('media transfer requires an active room connection');
	}

	// Media never relays (§3.6): offering to relay-only peers would show
	// the attachment as sent while the bytes can never arrive.
	const directPeers = p2pConnection.getDirectPeers();
	if (directPeers.length === 0 && p2pConnection.getConnectedPeers().length > 0) {
		throw new Error('Direct connection needed for files — the relay cannot carry media.');
	}

	const messageId = crypto.randomUUID();
	const offer = await mediaEngine.offer(
		data,
		meta,
		directPeers,
		{ id: userState.id, name: userState.name },
		messageId
	);

	const message: Message = {
		id: messageId,
		sender_id: userState.id,
		sender_name: userState.name,
		message_type: 'Media',
		content: meta.name,
		timestamp: Date.now(),
		room_id: roomId,
		status: 'Sent',
		edited: false,
		edit_timestamp: null,
		original_content: null,
		reply_to: null,
		reactions: {},
		mentions: [],
		local_timestamp: Date.now(),
		delivery_attempts: 0,
		size_bytes: data.byteLength,
		sender_device: cryptoSession?.deviceId,
		attachment: {
			transferId: offer.transferId,
			kind: meta.kind,
			name: meta.name,
			mime: meta.mime,
			size: data.byteLength,
			thumb: meta.thumb,
			thumbMime: meta.thumbMime,
			duration: meta.duration,
			waveform: meta.waveform,
			state: 'ready'
		}
	};
	messages.addMessage(roomId, message);
	void saveRoomMessages(roomId, messages.getRoomMessages(roomId));
}

/** Consent controls for large incoming transfers. */
export function acceptMediaTransfer(offer: MediaOffer, peerDeviceId: string): void {
	mediaConsent.remove(offer.transferId);
	mediaEngine?.accept(offer, peerDeviceId);
}

export function declineMediaTransfer(transferId: string): void {
	mediaConsent.remove(transferId);
	mediaEngine?.decline(transferId);
}

/**
 * Check if P2P is connected
 */
export function isP2PConnected(): boolean {
	return p2pConnection !== null && get(connection).status === 'connected';
}

/**
 * Get connected peer count
 */
export function getConnectedPeerCount(): number {
	return p2pConnection?.getConnectedPeers().length ?? 0;
}

/**
 * Manually trigger reconnection
 */
export async function reconnectP2P(): Promise<void> {
	const roomId = get(currentRoomId);
	if (!roomId) {
		throw new Error('No room to reconnect to');
	}

	// Reset reconnect attempts
	reconnectAttempts = 0;

	// Clear any existing reconnection interval
	if (reconnectInterval) {
		clearInterval(reconnectInterval);
		reconnectInterval = null;
	}

	// Attempt to reconnect
	await initializeP2P(roomId, lastP2PConfig);
}

/**
 * Setup visibility change listener for mobile background/foreground handling
 */
export function setupVisibilityHandler(roomId: string, config?: Partial<P2PConfig>): void {
	if (typeof document === 'undefined') return;

	// Remove existing handler if any
	if (visibilityHandler) {
		document.removeEventListener('visibilitychange', visibilityHandler);
	}

	visibilityHandler = async () => {
		if (document.visibilityState === 'hidden') {
			console.log('[P2P Manager] App backgrounded - recording time');
			lastHiddenTime = Date.now();
		} else if (document.visibilityState === 'visible') {
			const hiddenDuration = Date.now() - lastHiddenTime;
			console.log(`[P2P Manager] App foregrounded after ${hiddenDuration}ms`);

			// Only reconnect if WebSocket is actually disconnected
			// Don't reconnect just because we were hidden - the connection might still be working
			const wsConnected = p2pConnection?.isWebSocketConnected?.() ?? false;
			const hasDataChannels = (p2pConnection?.getConnectedPeers()?.length ?? 0) > 0;

			console.log(`[P2P Manager] Connection state: ws=${wsConnected}, channels=${hasDataChannels}, storeConnected=${isP2PConnected()}`);

			// Only reconnect if WebSocket is actually dead AND we were hidden for a while
			if (!wsConnected && hiddenDuration > STALE_CONNECTION_THRESHOLD) {
				console.log('[P2P Manager] WebSocket disconnected after long background, triggering reconnect');
				emitToast('info', 'Reconnecting...');
				try {
					await reconnectP2P();
				} catch (error) {
					console.error('[P2P Manager] Reconnect after foreground failed:', error);
				}
			} else if (!wsConnected && !hasDataChannels) {
				// WebSocket dead and no data channels - definitely need to reconnect
				console.log('[P2P Manager] No active connections, triggering reconnect');
				emitToast('info', 'Reconnecting...');
				try {
					await reconnectP2P();
				} catch (error) {
					console.error('[P2P Manager] Reconnect failed:', error);
				}
			} else {
				console.log('[P2P Manager] Connection still alive, not reconnecting');
			}
		}
	};

	document.addEventListener('visibilitychange', visibilityHandler);
	console.log('[P2P Manager] Visibility handler registered');
}

/**
 * Cleanup visibility handler
 */
export function cleanupVisibilityHandler(): void {
	if (visibilityHandler && typeof document !== 'undefined') {
		document.removeEventListener('visibilitychange', visibilityHandler);
		visibilityHandler = null;
		console.log('[P2P Manager] Visibility handler removed');
	}
}

/**
 * Setup network change listener for WiFi/cellular transitions
 */
export function setupNetworkHandler(roomId: string, config?: Partial<P2PConfig>): void {
	if (typeof navigator === 'undefined') return;

	const connection = (navigator as unknown as { connection?: { addEventListener: (type: string, listener: () => void) => void; removeEventListener: (type: string, listener: () => void) => void; type?: string; effectiveType?: string; downlink?: number } }).connection;

	if (!connection) {
		console.log('[P2P Manager] Network Information API not available');
		return;
	}

	// Remove existing handler if any
	if (networkHandler) {
		connection.removeEventListener('change', networkHandler);
	}

	networkHandler = async () => {
		console.log('[P2P Manager] Network change detected:', {
			type: connection.type,
			effectiveType: connection.effectiveType,
			downlink: connection.downlink
		});

		// Give network a moment to stabilize
		await new Promise((r) => setTimeout(r, 1000));

		// Force reconnection on network change
		emitToast('info', 'Network changed, reconnecting...');
		try {
			await reconnectP2P();
		} catch (error) {
			console.error('[P2P Manager] Reconnect after network change failed:', error);
		}
	};

	connection.addEventListener('change', networkHandler);
	console.log('[P2P Manager] Network handler registered');
}

/**
 * Cleanup network handler
 */
export function cleanupNetworkHandler(): void {
	if (networkHandler && typeof navigator !== 'undefined') {
		const connection = (navigator as unknown as { connection?: { removeEventListener: (type: string, listener: () => void) => void } }).connection;
		if (connection) {
			connection.removeEventListener('change', networkHandler);
		}
		networkHandler = null;
		console.log('[P2P Manager] Network handler removed');
	}
}

/**
 * Setup page lifecycle handlers for graceful cleanup on close/navigate
 */
export function setupPageLifecycleHandlers(): void {
	if (typeof window === 'undefined') return;

	// pagehide is more reliable than beforeunload on mobile
	const handlePageHide = (event: PageTransitionEvent) => {
		console.log('[P2P Manager] Page hide event, persisted:', event.persisted);
		if (!event.persisted) {
			// Page is being unloaded, not just hidden for bfcache
			disconnectP2P();
		}
	};

	// beforeunload as fallback for desktop browsers
	const handleBeforeUnload = () => {
		console.log('[P2P Manager] beforeunload event');
		disconnectP2P();
	};

	window.addEventListener('pagehide', handlePageHide);
	window.addEventListener('beforeunload', handleBeforeUnload);

	// Store cleanup function
	pageLifecycleCleanup = () => {
		window.removeEventListener('pagehide', handlePageHide);
		window.removeEventListener('beforeunload', handleBeforeUnload);
	};

	console.log('[P2P Manager] Page lifecycle handlers registered');
}

/**
 * Cleanup page lifecycle handlers
 */
export function cleanupPageLifecycleHandlers(): void {
	if (pageLifecycleCleanup) {
		pageLifecycleCleanup();
		pageLifecycleCleanup = null;
		console.log('[P2P Manager] Page lifecycle handlers removed');
	}
}
