/**
 * Room message persistence (PROTOCOL.md §4).
 *
 * IndexedDB `mindline-messages`: per room, an AES-256-GCM blob of the
 * message page under k_storage, nonce random, AAD lp(roomId, 'storage',
 * pageIndex). Multi-tab safe: saving merges with whatever another tab
 * wrote, with the in-memory list taking precedence so edits and
 * soft-deletes are never resurrected by a stale copy.
 *
 * Legacy plaintext localStorage (`chatHistory_{roomId}`, the v2 shape and
 * the older Rust RoomMessageState shape) is migrated then deleted on
 * first load. Rooms whose keys were never persisted cannot be encrypted;
 * the start-up sweep deletes their plaintext instead of leaving it
 * readable on disk.
 */

import { lp } from '$lib/crypto/lp';
import { loadRoomKeys } from '$lib/crypto/keystore';
import type { RoomKeys } from '$lib/crypto/keys';
import type { Message } from '$lib/types/message';

const DB_NAME = 'mindline-messages';
const DB_VERSION = 1;
const STORE = 'pages';
const PAGE_INDEX = '0';
const LEGACY_PREFIX = 'chatHistory_';
const MAX_STORED_MESSAGES = 500;

interface StoredPage {
	nonce: ArrayBuffer;
	data: ArrayBuffer; // AES-GCM ciphertext of { version: 3, room_id, messages }
}

interface StoredHistory {
	version?: number;
	room_id: string;
	messages: Message[];
}

// Subkeys are non-extractable CryptoKeys loaded from the keystore; the
// cache avoids an IDB read per save. Only successful loads are cached so
// a knocking session picks keys up once they are persisted.
const keyCache = new Map<string, RoomKeys>();

function openDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);
		request.onupgradeneeded = () => {
			if (!request.result.objectStoreNames.contains(STORE)) {
				request.result.createObjectStore(STORE);
			}
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

async function withStore<T>(
	mode: IDBTransactionMode,
	fn: (s: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
	const db = await openDb();
	try {
		return await new Promise<T>((resolve, reject) => {
			const tx = db.transaction(STORE, mode);
			const request = fn(tx.objectStore(STORE));
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
	} finally {
		db.close();
	}
}

async function roomKeysFor(roomId: string): Promise<RoomKeys | null> {
	const cached = keyCache.get(roomId);
	if (cached) return cached;
	try {
		const keys = await loadRoomKeys(roomId);
		if (keys) keyCache.set(roomId, keys);
		return keys;
	} catch {
		return null;
	}
}

async function readPage(keys: RoomKeys, roomId: string): Promise<Message[]> {
	let record: StoredPage | undefined;
	try {
		record = await withStore<StoredPage | undefined>('readonly', (s) => s.get(roomId));
	} catch {
		return [];
	}
	if (!record) return [];
	try {
		const plaintext = await crypto.subtle.decrypt(
			{
				name: 'AES-GCM',
				iv: record.nonce,
				additionalData: lp(roomId, 'storage', PAGE_INDEX)
			},
			keys.storage,
			record.data
		);
		const parsed = JSON.parse(new TextDecoder().decode(plaintext)) as StoredHistory;
		return Array.isArray(parsed.messages) ? parsed.messages : [];
	} catch {
		// Wrong slot, tampered, or foreign key: fail closed, treat as absent.
		console.warn(`[storage] history page failed authentication for ${roomId}`);
		return [];
	}
}

async function writePage(keys: RoomKeys, roomId: string, messages: Message[]): Promise<void> {
	if (messages.length === 0) {
		await withStore('readwrite', (s) => s.delete(roomId));
		return;
	}
	const payload: StoredHistory = { version: 3, room_id: roomId, messages };
	const nonce = crypto.getRandomValues(new Uint8Array(12));
	const ciphertext = await crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv: nonce, additionalData: lp(roomId, 'storage', PAGE_INDEX) },
		keys.storage,
		new TextEncoder().encode(JSON.stringify(payload))
	);
	const record: StoredPage = { nonce: nonce.slice().buffer as ArrayBuffer, data: ciphertext };
	await withStore('readwrite', (s) => s.put(record, roomId));
}

/** Primary wins on id conflict; secondary fills the gaps. */
function merge(primary: Message[], secondary: Message[]): Message[] {
	const byId = new Map<string, Message>();
	for (const msg of primary) byId.set(msg.id, msg);
	for (const msg of secondary) if (!byId.has(msg.id)) byId.set(msg.id, msg);
	return [...byId.values()];
}

function readLegacyPlaintext(roomId: string): Message[] {
	let raw: string | null;
	try {
		raw = localStorage.getItem(`${LEGACY_PREFIX}${roomId}`);
	} catch {
		return [];
	}
	if (!raw) return [];
	try {
		const data = JSON.parse(raw) as StoredHistory;
		return Array.isArray(data.messages) ? data.messages : [];
	} catch {
		removeLegacyPlaintext(roomId);
		return [];
	}
}

function removeLegacyPlaintext(roomId: string): void {
	try {
		localStorage.removeItem(`${LEGACY_PREFIX}${roomId}`);
	} catch {
		/* ignore */
	}
}

export async function loadRoomMessages(roomId: string): Promise<Message[]> {
	const keys = await roomKeysFor(roomId);
	if (!keys) return [];

	let stored = await readPage(keys, roomId);
	const legacy = readLegacyPlaintext(roomId);
	if (legacy.length > 0) {
		// The encrypted copy is newer when both exist; migrate-then-delete (§4).
		stored = merge(stored, legacy)
			.sort((a, b) => a.timestamp - b.timestamp)
			.slice(-MAX_STORED_MESSAGES);
		try {
			await writePage(keys, roomId, stored);
			removeLegacyPlaintext(roomId);
		} catch {
			/* quota errors: keep plaintext until a later attempt succeeds */
		}
	}
	return [...stored].sort((a, b) => a.timestamp - b.timestamp);
}

export async function saveRoomMessages(roomId: string, inMemory: Message[]): Promise<void> {
	const keys = await roomKeysFor(roomId);
	if (!keys) return; // no k_storage: nothing is ever persisted in plaintext

	const existing = await readPage(keys, roomId);
	const merged = merge(inMemory, existing)
		.sort((a, b) => a.timestamp - b.timestamp)
		.slice(-MAX_STORED_MESSAGES);
	try {
		await writePage(keys, roomId, merged);
	} catch {
		/* quota exceeded: history persistence is best-effort */
	}
}

export async function clearRoomMessages(roomId: string): Promise<void> {
	keyCache.delete(roomId);
	try {
		await withStore('readwrite', (s) => s.delete(roomId));
	} catch {
		/* best-effort */
	}
	removeLegacyPlaintext(roomId);
}

/**
 * Start-up sweep: encrypt any remaining legacy plaintext history, or
 * delete it when the room's keys were never persisted on this device
 * (without k_storage it cannot be encrypted; peers re-serve history on
 * the next keyed visit).
 */
export async function migrateLegacyPlaintext(): Promise<void> {
	const legacyKeys: string[] = [];
	try {
		for (let i = 0; i < localStorage.length; i++) {
			const key = localStorage.key(i);
			if (key?.startsWith(LEGACY_PREFIX)) legacyKeys.push(key);
		}
	} catch {
		return;
	}
	for (const storageKey of legacyKeys) {
		const roomId = storageKey.slice(LEGACY_PREFIX.length);
		const keys = await roomKeysFor(roomId);
		if (keys) {
			await loadRoomMessages(roomId); // load migrates-then-deletes
		} else {
			try {
				localStorage.removeItem(storageKey);
			} catch {
				/* ignore */
			}
		}
	}
}
