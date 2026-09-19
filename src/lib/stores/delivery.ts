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
	const recipients = new Map<string, Set<string>>();

	return {
		subscribe,

		/**
		 * Initialize delivery tracking for a sent message
		 */
		trackMessage: (messageId: string, roomId: string, connectedPeers: string[]) => {
			const intendedPeers = new Set(connectedPeers);
			recipients.set(messageId, intendedPeers);
			update((state) => {
				state.set(messageId, {
					messageId,
					roomId,
					sentAt: Date.now(),
					totalPeers: intendedPeers.size,
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
				if (tracking && recipients.get(messageId)?.has(peerId)) {
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
		 * Preserve acknowledgment truth when a peer disconnects.
		 */
		handlePeerDisconnect: (_peerId: string) => {
			// Disconnecting neither proves delivery nor removes an intended recipient.
			// Keep this hook for callers; a later acknowledgment can still count.
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
						recipients.delete(messageId);
					}
				});
				return new Map(state);
			});
		},

		/**
		 * Clear all tracking
		 */
		clear: () => {
			recipients.clear();
			set(new Map());
		},

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
