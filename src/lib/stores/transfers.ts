/**
 * Live media transfer state for the UI: progress bars and consent prompts.
 */

import { writable } from 'svelte/store';
import type { MediaOffer, TransferProgress } from '$lib/media/transfer';

export interface ConsentRequest {
	offer: MediaOffer;
	peerDeviceId: string;
}

function createTransfersStore() {
	const { subscribe, update } = writable<Map<string, TransferProgress>>(new Map());

	return {
		subscribe,
		setProgress(progress: TransferProgress) {
			update((map) => {
				map.set(progress.transferId, progress);
				return new Map(map);
			});
		},
		remove(transferId: string) {
			update((map) => {
				map.delete(transferId);
				return new Map(map);
			});
		},
		clear() {
			update(() => new Map());
		}
	};
}

function createConsentStore() {
	const { subscribe, update } = writable<ConsentRequest[]>([]);
	return {
		subscribe,
		add(request: ConsentRequest) {
			update((list) =>
				list.some((r) => r.offer.transferId === request.offer.transferId)
					? list
					: [...list, request]
			);
		},
		remove(transferId: string) {
			update((list) => list.filter((r) => r.offer.transferId !== transferId));
		},
		clear() {
			update(() => []);
		}
	};
}

export const transfers = createTransfersStore();
export const mediaConsent = createConsentStore();
