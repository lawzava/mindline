/**
 * P2P Manager
 * High-level API for P2P lifecycle orchestration
 */

import { P2PConnection } from './connection';
import { routeP2PMessage, setSendToPeerFn, emitToast } from './handlers';
import { connection, user, drafts, currentRoomId, messages } from '$lib/stores';
import { wasm, isWasmReady } from '$lib/wasm';
import type { P2PConfig, TypedP2PMessage, ChatMessage, TypingMessage, EditMessage, DeleteMessage, ReactionMessage, UserConnectedMessage, SyncRequestMessage } from './types';
import { get } from 'svelte/store';

// Module-level state
let p2pConnection: P2PConnection | null = null;
let reconnectAttempts = 0;
let reconnectInterval: ReturnType<typeof setInterval> | null = null;

const MAX_RECONNECT_ATTEMPTS = 7;
const BASE_RECONNECT_DELAY = 1000;
const MAX_RECONNECT_DELAY = 30000;

/**
 * Initialize P2P connection for a room
 */
export async function initializeP2P(roomId: string, config?: Partial<P2PConfig>): Promise<void> {
	console.log('[P2P Manager] Initializing P2P for room:', roomId);

	// Disconnect existing connection if any
	if (p2pConnection) {
		disconnectP2P();
		await new Promise((r) => setTimeout(r, 100));
	}

	// Get user info from store
	const userState = get(user);
	if (!userState.initialized || !userState.id) {
		throw new Error('User not initialized');
	}

	connection.setStatus('connecting');

	// Create connection
	p2pConnection = new P2PConnection(userState.id, roomId, config);

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

	p2pConnection.onPeerConnected((peerId) => {
		console.log('[P2P Manager] Peer connected:', peerId);
		connection.addPeer(peerId);

		// Request sync after connection stabilizes
		setTimeout(() => requestSync(roomId), 1000);

		// Announce our connection
		setTimeout(() => broadcastUserConnected(), 500);
	});

	p2pConnection.onPeerDisconnected((peerId) => {
		console.log('[P2P Manager] Peer disconnected:', peerId);

		// Get peer name before removing (for friendly notification)
		const peerName = connection.getPeerName(peerId);

		connection.removePeer(peerId);
		drafts.clearDraft(peerId);

		// Emit toast notification with name if available
		const displayName = peerName || `Peer ${peerId.slice(0, 8)}...`;
		emitToast('peer-left', `${displayName} left the room`);
	});

	p2pConnection.onConnectionLost((reason) => {
		console.warn('[P2P Manager] Connection lost:', reason);
		connection.setStatus('disconnected');
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
	}
}

/**
 * Disconnect from P2P network
 */
export function disconnectP2P(): void {
	console.log('[P2P Manager] Disconnecting');

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

	const message: ChatMessage = {
		type: 'chat',
		content,
		senderId: userState.id,
		senderName: userState.name,
		messageId,
		timestamp: Date.now(),
		roomId
	};

	p2pConnection.broadcast(message);
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
		senderId: userState.id,
		senderName: userState.name,
		action,
		timestamp: Date.now()
	};

	p2pConnection.broadcast(message);
}

/**
 * Request message synchronization from peers
 */
function requestSync(roomId: string): void {
	if (!p2pConnection || !isWasmReady()) {
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

		p2pConnection.broadcast(syncRequest);
		console.log('[P2P Manager] Sync request sent for room:', roomId);
	} catch (error) {
		console.error('[P2P Manager] Failed to request sync:', error);
	}
}

/**
 * Broadcast user connected notification
 */
function broadcastUserConnected(): void {
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

	p2pConnection.broadcast(message);
}

/**
 * Start reconnection with exponential backoff
 */
function startReconnection(roomId: string, config?: Partial<P2PConfig>): void {
	if (reconnectInterval || reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
		if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
			connection.setError('Max reconnection attempts reached');
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
			emitToast('error', 'Failed to reconnect after multiple attempts');
			return;
		}

		reconnectAttempts++;

		// Exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s, 30s
		const delay = Math.min(BASE_RECONNECT_DELAY * Math.pow(2, reconnectAttempts - 1), MAX_RECONNECT_DELAY);
		console.log(`[P2P Manager] Reconnection attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} in ${delay}ms`);

		await new Promise((r) => setTimeout(r, delay));

		try {
			await initializeP2P(roomId, config);
			if (reconnectInterval) {
				clearTimeout(reconnectInterval);
				reconnectInterval = null;
			}
			emitToast('success', 'Reconnected successfully');
			console.log('[P2P Manager] Reconnection successful');
		} catch (error) {
			console.warn(`[P2P Manager] Reconnection attempt ${reconnectAttempts} failed:`, error);
			// Schedule next attempt
			if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
				reconnectInterval = setTimeout(attemptReconnect, 0);
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
	await initializeP2P(roomId);
}
