/**
 * Recent rooms — a purely client-side, never-synced list of rooms this device
 * has been in, so people can step back into a conversation instead of hunting
 * for the invite link.
 *
 * Privacy note: each entry keeps the room's key fragment (the capability that
 * grants read access) in localStorage to allow one-tap rejoin. This is the same
 * trust level as the encrypted history + keys this device already caches at
 * rest (IndexedDB keystore) — anyone with access to the device can already read
 * the room. "Burn & Leave" removes the entry along with that at-rest data.
 */

import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';

export interface RecentRoom {
	/** Room id (the URL path segment). */
	id: string;
	/** Key fragment WITHOUT the leading '#', e.g. `k=AbC...`. Empty if unknown. */
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

		/**
		 * Upsert on join: bump lastActive, keep the existing custom name, and fill
		 * in the key fragment when we have one (a link-join carries it; a
		 * stored-key rejoin may not, and that's fine — the keystore still serves).
		 */
		record: (id: string, key: string, now: number) => {
			if (!id) return;
			mutate((rooms) => {
				const existing = rooms.find((r) => r.id === id);
				if (existing) {
					return rooms.map((r) => (r.id === id ? { ...r, key: key || r.key, lastActive: now } : r));
				}
				return [...rooms, { id, key, name: '', lastActive: now }];
			});
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
