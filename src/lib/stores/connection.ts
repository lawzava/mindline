/**
 * P2P Connection state store
 */

import { writable, derived, get } from 'svelte/store';
import type { PeerTransport } from '$lib/p2p/types';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'failed' | 'local';

interface ReconnectionState {
	isReconnecting: boolean;
	attemptCount: number;
	maxAttempts: number;
	nextRetryAt: number | null;
}

interface SyncState {
	isSyncing: boolean;
	messagesReceived: number;
	totalMessages: number | null;
	syncingWithPeer: string | null;
}

function createConnectionStore() {
	const { subscribe, set, update } = writable<{
		status: ConnectionStatus;
		peers: Set<string>;
		peerNames: Map<string, string>;
		peerTransports: Map<string, PeerTransport>;
		error: string | null;
		reconnection: ReconnectionState;
		sync: SyncState;
		/** Current key generation (PROTOCOL.md §1.4). */
		generation: { g: number; gid: string };
	}>({
		status: 'disconnected',
		peers: new Set(),
		peerNames: new Map(),
		peerTransports: new Map(),
		error: null,
		reconnection: {
			isReconnecting: false,
			attemptCount: 0,
			maxAttempts: 7,
			nextRetryAt: null
		},
		sync: {
			isSyncing: false,
			messagesReceived: 0,
			totalMessages: null,
			syncingWithPeer: null
		},
		generation: { g: 0, gid: '' }
	});

	return {
		subscribe,

		/**
		 * Set connection status
		 */
		setStatus: (status: ConnectionStatus) => {
			update((state) => ({ ...state, status, error: null }));
		},

		/**
		 * Set error state
		 */
		setError: (error: string) => {
			update((state) => ({ ...state, status: 'failed', error }));
		},

		/**
		 * Add a connected peer
		 */
		addPeer: (peerId: string, peerName?: string, transport: PeerTransport = 'direct') => {
			update((state) => {
				state.peers.add(peerId);
				if (peerName) {
					state.peerNames.set(peerId, peerName);
				}
				state.peerTransports.set(peerId, transport);
				return {
					...state,
					peers: new Set(state.peers),
					peerNames: new Map(state.peerNames),
					peerTransports: new Map(state.peerTransports)
				};
			});
		},

		/**
		 * Set peer name (when we learn it from user-connected message)
		 */
		setPeerName: (peerId: string, peerName: string) => {
			update((state) => {
				state.peerNames.set(peerId, peerName);
				return { ...state, peerNames: new Map(state.peerNames) };
			});
		},

		/**
		 * Get peer name by ID
		 */
		getPeerName: (peerId: string): string | undefined => {
			return get({ subscribe }).peerNames.get(peerId);
		},

		/**
		 * Remove a disconnected peer
		 */
		removePeer: (peerId: string) => {
			update((state) => {
				state.peers.delete(peerId);
				state.peerNames.delete(peerId);
				state.peerTransports.delete(peerId);
				return {
					...state,
					peers: new Set(state.peers),
					peerNames: new Map(state.peerNames),
					peerTransports: new Map(state.peerTransports)
				};
			});
		},

		/**
		 * Clear all peers
		 */
		clearPeers: () => {
			update((state) => ({
				...state,
				peers: new Set(),
				peerNames: new Map(),
				peerTransports: new Map()
			}));
		},

		/**
		 * Set reconnection state
		 */
		setReconnecting: (isReconnecting: boolean, attemptCount: number = 0, nextRetryMs: number = 0) => {
			update((state) => ({
				...state,
				reconnection: {
					...state.reconnection,
					isReconnecting,
					attemptCount,
					nextRetryAt: isReconnecting ? Date.now() + nextRetryMs : null
				}
			}));
		},

		/**
		 * Clear reconnection state
		 */
		clearReconnection: () => {
			update((state) => ({
				...state,
				reconnection: {
					isReconnecting: false,
					attemptCount: 0,
					maxAttempts: 7,
					nextRetryAt: null
				}
			}));
		},

		/**
		 * Start sync tracking
		 */
		startSync: (peerId: string) => {
			update((state) => ({
				...state,
				sync: {
					isSyncing: true,
					messagesReceived: 0,
					totalMessages: null,
					syncingWithPeer: peerId
				}
			}));
		},

		/**
		 * Update sync progress
		 */
		updateSyncProgress: (received: number, total?: number) => {
			update((state) => ({
				...state,
				sync: {
					...state.sync,
					messagesReceived: received,
					totalMessages: total ?? state.sync.totalMessages
				}
			}));
		},

		/**
		 * End sync
		 */
		endSync: () => {
			update((state) => ({
				...state,
				sync: {
					isSyncing: false,
					messagesReceived: 0,
					totalMessages: null,
					syncingWithPeer: null
				}
			}));
		},

		/**
		 * Record the room's current key generation (PROTOCOL.md §1.4)
		 */
		setGeneration: (g: number, gid: string) => {
			update((state) => ({ ...state, generation: { g, gid } }));
		},

		/**
		 * Reset to initial state
		 */
		reset: () => {
			set({
				status: 'disconnected',
				peers: new Set(),
				peerNames: new Map(),
				peerTransports: new Map(),
				error: null,
				reconnection: {
					isReconnecting: false,
					attemptCount: 0,
					maxAttempts: 7,
					nextRetryAt: null
				},
				sync: {
					isSyncing: false,
					messagesReceived: 0,
					totalMessages: null,
					syncingWithPeer: null
				},
				generation: { g: 0, gid: '' }
			});
		},

		/**
		 * Get current state synchronously
		 */
		get: () => get({ subscribe })
	};
}

export const connection = createConnectionStore();

// Derived stores for convenience
export const connectionStatus = derived(connection, ($conn) => $conn.status);
export const connectedPeers = derived(connection, ($conn) => Array.from($conn.peers));
export const peerCount = derived(connection, ($conn) => $conn.peers.size);
export const isConnected = derived(connection, ($conn) => $conn.status === 'connected');
export const connectionError = derived(connection, ($conn) => $conn.error);
export const peerNames = derived(connection, ($conn) => $conn.peerNames);
/** Peers reached via the signaling relay instead of a direct channel (§3.6). */
export const relayedPeers = derived(connection, ($conn) =>
	[...$conn.peerTransports].filter(([, transport]) => transport === 'relay').map(([id]) => id)
);
/**
 * Relay-only peers are stranded by a ratchet (§1.4): grants never relay,
 * so once the room has rotated past the link generation they cannot read
 * newer traffic until a direct connection delivers a grant.
 */
export const rotationStranded = derived(
	connection,
	($conn) =>
		$conn.generation.g > 0 &&
		[...$conn.peerTransports.values()].some((transport) => transport === 'relay')
);

// Reconnection state
export const isReconnecting = derived(connection, ($conn) => $conn.reconnection.isReconnecting);
export const reconnectionState = derived(connection, ($conn) => $conn.reconnection);

// Sync state
export const isSyncing = derived(connection, ($conn) => $conn.sync.isSyncing);
export const syncState = derived(connection, ($conn) => $conn.sync);
