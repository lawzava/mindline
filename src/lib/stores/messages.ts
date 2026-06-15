/**
 * Messages state store
 */

import { writable, derived, get } from 'svelte/store';
import { currentRoomId } from './room';
import type { Message } from '$lib/types/message';

function createMessagesStore() {
	const { subscribe, set, update } = writable<Map<string, Message[]>>(new Map());

	return {
		subscribe,

		/**
		 * Add a message to a room's history
		 */
		addMessage: (roomId: string, message: Message) => {
			update((messages) => {
				const roomMessages = messages.get(roomId) || [];
				// Check if message already exists (by ID)
				const exists = roomMessages.some((m) => m.id === message.id);
				if (!exists) {
					messages.set(roomId, [...roomMessages, message]);
				}
				return new Map(messages);
			});
		},

		/**
		 * Set all messages for a room
		 */
		setRoomMessages: (roomId: string, newMessages: Message[]) => {
			update((messages) => {
				messages.set(roomId, newMessages);
				return new Map(messages);
			});
		},

		/**
		 * Get messages for a specific room
		 */
		getRoomMessages: (roomId: string): Message[] => {
			const messages = get({ subscribe });
			return messages.get(roomId) || [];
		},

		/**
		 * Clear messages for a specific room
		 */
		clearRoom: (roomId: string) => {
			update((messages) => {
				messages.delete(roomId);
				return new Map(messages);
			});
		},

		/**
		 * Clear all messages
		 */
		clearAll: () => {
			set(new Map());
		},

		/**
		 * Update a specific message
		 */
		updateMessage: (roomId: string, messageId: string, updates: Partial<Message>) => {
			update((messages) => {
				const roomMessages = messages.get(roomId) || [];
				const updatedMessages = roomMessages.map((m) =>
					m.id === messageId ? { ...m, ...updates } : m
				);
				messages.set(roomId, updatedMessages);
				return new Map(messages);
			});
		},

		/**
		 * Get a specific message by ID
		 */
		getMessage: (roomId: string, messageId: string): Message | undefined => {
			const allMessages = get({ subscribe });
			const roomMessages = allMessages.get(roomId) || [];
			return roomMessages.find((m) => m.id === messageId);
		}
	};
}

export const messages = createMessagesStore();

// Derived store for current room's messages
export const currentRoomMessages = derived([messages, currentRoomId], ([$messages, $roomId]) => {
	if (!$roomId) return [];
	return $messages.get($roomId) || [];
});

// Derived store for message count in current room
export const messageCount = derived(currentRoomMessages, ($messages) => $messages.length);
