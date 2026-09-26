/**
 * Recent rooms — a purely client-side, never-synced list of rooms this device
 * has been in, so people can step back into a conversation instead of hunting
 * for the invite link.
 *
 * Privacy note: entries hold no key material. Rejoin opens the room from the
 * on-device keystore, which also keeps the link key wrapped for re-sharing.
 * Entries written by older versions may still carry a plaintext fragment;
 * takeLegacyKeys() hands those to the keystore and strips them.
 */

import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';

export interface RecentRoom {
	/** Room id (the URL path segment). */
	id: string;
	/**
	 * Legacy only: a plaintext key fragment (`k=...`) written by older
	 * versions. New entries leave it empty.
	 */
	key: string;
	/** User-chosen label for this room; '' means "show the id". Local only. */
	name: string;
	/** Last time this device opened the room (ms epoch), for ordering. */
	lastActive: number;
}

const STORAGE_KEY = 'mindline_recentRooms';
const MAX_ENTRIES = 30;

function load(): RecentRoom[] {
	if (!browser) return [];
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed
			.filter(
				(r): r is RecentRoom =>
					!!r &&
					typeof r.id === 'string' &&
					typeof r.key === 'string' &&
					typeof r.name === 'string' &&
					typeof r.lastActive === 'number'
			)
			.sort((a, b) => b.lastActive - a.lastActive);
	} catch {
		return [];
	}
}

function persist(rooms: RecentRoom[]): void {
	if (!browser) return;
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(rooms));
	} catch {
		/* storage full or blocked: the list is a convenience, not load-bearing */
	}
}

function createRecentRoomsStore() {
	const { subscribe, update } = writable<RecentRoom[]>(load());

	function mutate(fn: (rooms: RecentRoom[]) => RecentRoom[]): void {
		update((rooms) => {
			const next = fn(rooms)
				.sort((a, b) => b.lastActive - a.lastActive)
				.slice(0, MAX_ENTRIES);
			persist(next);
			return next;
		});
	}

	return {
		subscribe,

		/** Upsert on join: bump lastActive and keep the existing custom name. */
		record: (id: string, now: number) => {
			if (!id) return;
			mutate((rooms) => {
				const existing = rooms.find((r) => r.id === id);
				if (existing) {
					return rooms.map((r) => (r.id === id ? { ...r, lastActive: now } : r));
				}
				return [...rooms, { id, key: '', name: '', lastActive: now }];
			});
		},

		/**
		 * Plaintext keys left by older versions. The caller moves each into the
		 * keystore and then calls forgetKey() for the ones it secured.
		 */
		legacyKeys: (): { id: string; key: string }[] =>
			get({ subscribe })
				.filter((r) => r.key)
				.map(({ id, key }) => ({ id, key })),

		forgetKey: (id: string) => {
			mutate((rooms) => rooms.map((r) => (r.id === id ? { ...r, key: '' } : r)));
		},

		/** Set (or clear, with '') a room's local label. */
		rename: (id: string, name: string) => {
			mutate((rooms) => rooms.map((r) => (r.id === id ? { ...r, name: name.trim() } : r)));
		},

		/** Forget a room (manual removal or after Burn & Leave). */
		remove: (id: string) => {
			mutate((rooms) => rooms.filter((r) => r.id !== id));
		},

		/** Current list synchronously, newest first. */
		get: () => get({ subscribe })
	};
}

export const recentRooms = createRecentRoomsStore();
