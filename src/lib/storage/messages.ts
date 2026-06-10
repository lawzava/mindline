/**
 * Room message persistence.
 *
 * localStorage `chatHistory_{roomId}`, multi-tab safe: saving merges with
 * whatever another tab wrote, with the in-memory list taking precedence so
 * edits and soft-deletes are never resurrected by a stale copy. Reads both
 * the v2 shape and the legacy Rust RoomMessageState shape.
 */

import type { Message } from '$lib/types/message';

const KEY_PREFIX = 'chatHistory_';
const MAX_STORED_MESSAGES = 500;

interface StoredHistory {
	version?: number;
	room_id: string;
	messages: Message[];
}

function storageKey(roomId: string): string {
	return `${KEY_PREFIX}${roomId}`;
}

function parseStored(raw: string): Message[] | null {
	try {
		const data = JSON.parse(raw) as StoredHistory;
		if (!Array.isArray(data.messages)) return null;
		return data.messages;
	} catch {
		return null;
	}
}

export function loadRoomMessages(roomId: string): Message[] {
	let raw: string | null;
	try {
		raw = localStorage.getItem(storageKey(roomId));
	} catch {
		return [];
	}
	if (!raw) return [];
	const stored = parseStored(raw);
	if (!stored) {
		try {
			localStorage.removeItem(storageKey(roomId));
		} catch {
			/* quota/security errors are non-fatal */
		}
		return [];
	}
	return [...stored].sort((a, b) => a.timestamp - b.timestamp);
}

export function saveRoomMessages(roomId: string, inMemory: Message[]): void {
	let existing: Message[] = [];
	try {
		const raw = localStorage.getItem(storageKey(roomId));
		if (raw) existing = parseStored(raw) ?? [];
	} catch {
		/* fall through with empty existing */
	}

	// In-memory first so its versions win; storage-only messages then fill in.
	const byId = new Map<string, Message>();
	for (const msg of inMemory) byId.set(msg.id, msg);
	for (const msg of existing) if (!byId.has(msg.id)) byId.set(msg.id, msg);

	const merged = [...byId.values()]
		.sort((a, b) => a.timestamp - b.timestamp)
		.slice(-MAX_STORED_MESSAGES);

	const payload: StoredHistory = { version: 2, room_id: roomId, messages: merged };
	try {
		localStorage.setItem(storageKey(roomId), JSON.stringify(payload));
	} catch {
		/* quota exceeded: history persistence is best-effort */
	}
}

export function clearRoomMessages(roomId: string): void {
	try {
		localStorage.removeItem(storageKey(roomId));
	} catch {
		/* ignore */
	}
}
