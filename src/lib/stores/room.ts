/**
 * Room state store with localStorage persistence
 */

import { writable, derived, get } from 'svelte/store';
import { browser } from '$app/environment';

const STORAGE_KEY = 'mindline_currentRoomId';

function createRoomStore() {
	// Load initial state from localStorage
	let initialRoomId = '';
	if (browser) {
		const stored = localStorage.getItem(STORAGE_KEY);
		if (stored) initialRoomId = stored;
	}

	const { subscribe, set } = writable<string>(initialRoomId);

	return {
		subscribe,

		/**
		 * Set the current room ID
		 */
		set: (roomId: string) => {
			if (browser) {
				localStorage.setItem(STORAGE_KEY, roomId);
			}
			set(roomId);
		},

		/**
		 * Clear the current room
		 */
		clear: () => {
			if (browser) {
				localStorage.removeItem(STORAGE_KEY);
			}
			set('');
		},

		/**
		 * Get current room ID synchronously
		 */
		get: () => get({ subscribe })
	};
}

export const currentRoomId = createRoomStore();

// Derived store for checking if user is in a room
export const isInRoom = derived(currentRoomId, ($roomId) => $roomId !== '');
