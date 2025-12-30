/**
 * P2P Connection state store
 */

import { writable, derived, get } from 'svelte/store';

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
		error: string | null;
		reconnection: ReconnectionState;
		sync: SyncState;
	}>({
		status: 'disconnected',
		peers: new Set(),
		peerNames: new Map(),
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
		}
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
		addPeer: (peerId: string, peerName?: string) => {
			update((state) => {
				state.peers.add(peerId);
				if (peerName) {
					state.peerNames.set(peerId, peerName);
				}
				return { ...state, peers: new Set(state.peers), peerNames: new Map(state.peerNames) };
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
				return { ...state, peers: new Set(state.peers), peerNames: new Map(state.peerNames) };
			});
		},

		/**
		 * Clear all peers
		 */
		clearPeers: () => {
			update((state) => ({ ...state, peers: new Set(), peerNames: new Map() }));
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
		 * Reset to initial state
		 */
		reset: () => {
			set({
				status: 'disconnected',
				peers: new Set(),
				peerNames: new Map(),
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
				}
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

// Reconnection state
export const isReconnecting = derived(connection, ($conn) => $conn.reconnection.isReconnecting);
export const reconnectionState = derived(connection, ($conn) => $conn.reconnection);

// Sync state
export const isSyncing = derived(connection, ($conn) => $conn.sync.isSyncing);
export const syncState = derived(connection, ($conn) => $conn.sync);
