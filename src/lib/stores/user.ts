/**
 * User state store with localStorage persistence
 */

import { writable, derived, get } from 'svelte/store';
import { browser } from '$app/environment';

export interface User {
	id: string;
	name: string;
	initialized: boolean;
}

const STORAGE_KEY_NAME = 'mindline_userName';
const STORAGE_KEY_ID = 'mindline_userId';

function createUserStore() {
	// Load initial state from localStorage
	const initialState: User = {
		id: '',
		name: '',
		initialized: false
	};

	if (browser) {
		const storedName = localStorage.getItem(STORAGE_KEY_NAME);
		const storedId = localStorage.getItem(STORAGE_KEY_ID);
		if (storedName) initialState.name = storedName;
		if (storedId) initialState.id = storedId;
		initialState.initialized = !!(storedName && storedId);
	}

	const { subscribe, set, update } = writable<User>(initialState);

	return {
		subscribe,

		/**
		 * Initialize user with name and ID
		 */
		initialize: (name: string, id: string) => {
			if (browser) {
				localStorage.setItem(STORAGE_KEY_NAME, name);
				localStorage.setItem(STORAGE_KEY_ID, id);
			}
			set({ id, name, initialized: true });
		},

		/**
		 * Update just the user name
		 */
		setName: (name: string) => {
			if (browser) {
				localStorage.setItem(STORAGE_KEY_NAME, name);
			}
			update((u) => ({ ...u, name }));
		},

		/**
		 * Clear user state
		 */
		clear: () => {
			if (browser) {
				localStorage.removeItem(STORAGE_KEY_NAME);
				localStorage.removeItem(STORAGE_KEY_ID);
			}
			set({ id: '', name: '', initialized: false });
		},

		/**
		 * Get current user synchronously
		 */
		get: () => get({ subscribe })
	};
}

export const user = createUserStore();

// Derived stores for convenience
export const userId = derived(user, ($user) => $user.id);
export const userName = derived(user, ($user) => $user.name);
export const isUserInitialized = derived(user, ($user) => $user.initialized);
