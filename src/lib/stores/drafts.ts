/**
 * Draft messages store for real-time typing indicators
 */

import { writable, derived, get } from 'svelte/store';
import { browser } from '$app/environment';

export interface Draft {
	peerId: string;
	senderName: string;
	content: string;
	timestamp: number;
}

const DRAFT_TIMEOUT_MS = 3000; // Auto-clear drafts after 3 seconds of inactivity

function createDraftsStore() {
	const { subscribe, set, update } = writable<Map<string, Draft>>(new Map());
	const timeouts = new Map<string, ReturnType<typeof setTimeout>>();

	return {
		subscribe,

		/**
		 * Set a draft message from a peer
		 */
		setDraft: (peerId: string, senderName: string, content: string) => {
			// Clear any existing timeout for this peer
			const existingTimeout = timeouts.get(peerId);
			if (existingTimeout) {
				clearTimeout(existingTimeout);
			}

			// Update the draft
			update((drafts) => {
				if (content.trim() === '') {
					// Empty content means clear the draft
					drafts.delete(peerId);
				} else {
					drafts.set(peerId, {
						peerId,
						senderName,
						content,
						timestamp: Date.now()
					});
				}
				return new Map(drafts);
			});

			// Set timeout to auto-clear after inactivity
			if (content.trim() !== '' && browser) {
				const timeout = setTimeout(() => {
					update((drafts) => {
						drafts.delete(peerId);
						return new Map(drafts);
					});
					timeouts.delete(peerId);
				}, DRAFT_TIMEOUT_MS);
				timeouts.set(peerId, timeout);
			}
		},

		/**
		 * Clear a specific draft
		 */
		clearDraft: (peerId: string) => {
			const timeout = timeouts.get(peerId);
			if (timeout) {
				clearTimeout(timeout);
				timeouts.delete(peerId);
			}
			update((drafts) => {
				drafts.delete(peerId);
				return new Map(drafts);
			});
		},

		/**
		 * Clear all drafts
		 */
		clearAll: () => {
			// Clear all timeouts
			for (const timeout of timeouts.values()) {
				clearTimeout(timeout);
			}
			timeouts.clear();
			set(new Map());
		},

		/**
		 * Get all drafts as array
		 */
		getAll: (): Draft[] => {
			const drafts = get({ subscribe });
			return Array.from(drafts.values());
		}
	};
}

export const drafts = createDraftsStore();

// Derived store for draft count
export const draftCount = derived(drafts, ($drafts) => $drafts.size);

// Derived store for drafts as array (sorted by timestamp)
export const draftsList = derived(drafts, ($drafts) =>
	Array.from($drafts.values()).sort((a, b) => a.timestamp - b.timestamp)
);
