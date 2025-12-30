/**
 * Message delivery tracking store
 * Tracks per-message, per-peer delivery status
 */

import { writable, derived, get } from 'svelte/store';

interface MessageDeliveryState {
	messageId: string;
	roomId: string;
	sentAt: number;
	totalPeers: number;
	deliveredTo: Set<string>;
}

function createDeliveryStore() {
	const { subscribe, set, update } = writable<Map<string, MessageDeliveryState>>(new Map());

	return {
		subscribe,

		/**
		 * Initialize delivery tracking for a sent message
		 */
		trackMessage: (messageId: string, roomId: string, connectedPeers: string[]) => {
			update((state) => {
				state.set(messageId, {
					messageId,
					roomId,
					sentAt: Date.now(),
					totalPeers: connectedPeers.length,
					deliveredTo: new Set()
				});
				return new Map(state);
			});
		},

		/**
		 * Record delivery acknowledgment from a peer
		 */
		recordDelivery: (messageId: string, peerId: string) => {
			update((state) => {
				const tracking = state.get(messageId);
				if (tracking) {
					tracking.deliveredTo.add(peerId);
					state.set(messageId, { ...tracking, deliveredTo: new Set(tracking.deliveredTo) });
				}
				return new Map(state);
			});
		},

		/**
		 * Get delivery status for a message
		 */
		getDeliveryStatus: (messageId: string): { delivered: number; total: number } | null => {
			const state = get({ subscribe });
			const tracking = state.get(messageId);
			if (!tracking) return null;
			return {
				delivered: tracking.deliveredTo.size,
				total: tracking.totalPeers
			};
		},

		/**
		 * Handle peer disconnect - adjust totals
		 */
		handlePeerDisconnect: (peerId: string) => {
			update((state) => {
				state.forEach((tracking, messageId) => {
					// If peer hadn't delivered yet, reduce total
					if (!tracking.deliveredTo.has(peerId) && tracking.totalPeers > 0) {
						tracking.totalPeers = Math.max(0, tracking.totalPeers - 1);
						state.set(messageId, { ...tracking });
					}
				});
				return new Map(state);
			});
		},

		/**
		 * Clean up old delivery tracking (messages older than X minutes)
		 */
		cleanup: (maxAgeMs: number = 300000) => {
			const now = Date.now();
			update((state) => {
				state.forEach((tracking, messageId) => {
					if (now - tracking.sentAt > maxAgeMs) {
						state.delete(messageId);
					}
				});
				return new Map(state);
			});
		},

		/**
		 * Clear all tracking
		 */
		clear: () => set(new Map()),

		/**
		 * Get raw state
		 */
		get: () => get({ subscribe })
	};
}

export const delivery = createDeliveryStore();

// Derived store: get all message IDs with full delivery
export const fullyDeliveredMessages = derived(delivery, ($delivery) => {
	const fullyDelivered: string[] = [];
	$delivery.forEach((tracking, messageId) => {
		if (tracking.deliveredTo.size >= tracking.totalPeers && tracking.totalPeers > 0) {
			fullyDelivered.push(messageId);
		}
	});
	return fullyDelivered;
});
