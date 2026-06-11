import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, test } from 'vitest';
import {
	clearRoomMessages,
	loadRoomMessages,
	migrateLegacyPlaintext,
	saveRoomMessages
} from '$lib/storage/messages';
import {
	createRoomKey,
	deriveRoomKeys,
	importRoomKeyMaterial,
	type RoomKeys
} from '$lib/crypto/keys';
import { saveRoomKeys } from '$lib/crypto/keystore';
import type { Message } from '$lib/types/message';

function makeMessage(overrides: Partial<Message> = {}): Message {
	return {
		id: crypto.randomUUID(),
		sender_id: 'alice',
		sender_name: 'Alice',
		message_type: 'Text',
		content: 'hello',
		timestamp: Date.now(),
		room_id: 'room-1',
		status: 'sent',
		edited: false,
		edit_timestamp: null,
		original_content: null,
		reply_to: null,
		reactions: {},
		mentions: [],
		local_timestamp: Date.now(),
		delivery_attempts: 0,
		size_bytes: 5,
		...overrides
	};
}

class MemoryStorage implements Storage {
	private map = new Map<string, string>();
	get length() {
		return this.map.size;
	}
	clear() {
		this.map.clear();
	}
	getItem(k: string) {
		return this.map.get(k) ?? null;
	}
	key(i: number) {
		return [...this.map.keys()][i] ?? null;
	}
	removeItem(k: string) {
		this.map.delete(k);
	}
	setItem(k: string, v: string) {
		this.map.set(k, v);
	}
}

async function seedKeys(roomId: string): Promise<RoomKeys> {
	const keys = await deriveRoomKeys(await importRoomKeyMaterial(createRoomKey()));
	await saveRoomKeys(roomId, keys);
	return keys;
}

// The storage module caches keys per room; unique ids isolate tests from
// the cache across the fresh-IDB resets below.
function uniqueRoom(): string {
	return `room-${crypto.randomUUID()}`;
}

interface RawPage {
	nonce: ArrayBuffer;
	data: ArrayBuffer;
}

/** Raw IDB read of the stored page record, bypassing the module. */
function rawPage(roomId: string): Promise<RawPage | undefined> {
	return new Promise((resolve, reject) => {
		const open = indexedDB.open('mindline-messages');
		open.onsuccess = () => {
			const db = open.result;
			if (!db.objectStoreNames.contains('pages')) {
				db.close();
				resolve(undefined);
				return;
			}
			const get = db.transaction('pages').objectStore('pages').get(roomId) as IDBRequest<
				RawPage | undefined
			>;
			get.onsuccess = () => {
				db.close();
				resolve(get.result);
			};
			get.onerror = () => {
				db.close();
				reject(get.error);
			};
		};
		open.onerror = () => reject(open.error);
	});
}

function putRawPage(roomId: string, record: RawPage): Promise<void> {
	return new Promise((resolve, reject) => {
		const open = indexedDB.open('mindline-messages');
		open.onsuccess = () => {
			const db = open.result;
			const put = db.transaction('pages', 'readwrite').objectStore('pages').put(record, roomId);
			put.onsuccess = () => {
				db.close();
				resolve();
			};
			put.onerror = () => {
				db.close();
				reject(put.error);
			};
		};
		open.onerror = () => reject(open.error);
	});
}

beforeEach(() => {
	indexedDB = new IDBFactory();
	globalThis.localStorage = new MemoryStorage();
});

describe('encrypted message storage', () => {
	test('round-trips messages sorted by timestamp', async () => {
		const roomId = uniqueRoom();
		await seedKeys(roomId);
		const m1 = makeMessage({ timestamp: 200, room_id: roomId });
		const m2 = makeMessage({ timestamp: 100, room_id: roomId });
		await saveRoomMessages(roomId, [m1, m2]);
		const loaded = await loadRoomMessages(roomId);
		expect(loaded.map((m) => m.id)).toEqual([m2.id, m1.id]);
	});

	test('returns empty for unknown room', async () => {
		expect(await loadRoomMessages(uniqueRoom())).toEqual([]);
	});

	test('persists nothing without room keys (no plaintext fallback)', async () => {
		const roomId = uniqueRoom();
		await saveRoomMessages(roomId, [makeMessage({ room_id: roomId })]);
		expect(await rawPage(roomId)).toBeUndefined();
		expect(localStorage.getItem(`chatHistory_${roomId}`)).toBeNull();
	});

	test('stored record is ciphertext: content never appears in IDB or localStorage', async () => {
		const roomId = uniqueRoom();
		await seedKeys(roomId);
		const secret = 'the-launch-code-is-7777';
		await saveRoomMessages(roomId, [makeMessage({ content: secret, room_id: roomId })]);
		const record = await rawPage(roomId);
		expect(record).toBeDefined();
		const rawBytes = new TextDecoder('utf-8', { fatal: false }).decode(record!.data);
		expect(rawBytes).not.toContain(secret);
		expect(localStorage.getItem(`chatHistory_${roomId}`)).toBeNull();
	});

	test('AAD binds the page to its room: relocated ciphertext fails closed', async () => {
		const roomA = uniqueRoom();
		const roomB = uniqueRoom();
		const keys = await seedKeys(roomA);
		await saveRoomKeys(roomB, keys); // same key material, different room slot
		await saveRoomMessages(roomA, [makeMessage({ room_id: roomA })]);
		const record = await rawPage(roomA);
		await putRawPage(roomB, record!);
		expect(await loadRoomMessages(roomB)).toEqual([]);
	});

	test('merge-on-save: messages from another tab survive', async () => {
		const roomId = uniqueRoom();
		await seedKeys(roomId);
		const mine = makeMessage({ id: 'mine', timestamp: 100, room_id: roomId });
		const theirs = makeMessage({ id: 'theirs', timestamp: 50, room_id: roomId });
		await saveRoomMessages(roomId, [theirs]); // "other tab" wrote first
		await saveRoomMessages(roomId, [mine]); // this tab saves without theirs in memory
		const loaded = await loadRoomMessages(roomId);
		expect(loaded.map((m) => m.id)).toEqual(['theirs', 'mine']);
	});

	test('merge-on-save: in-memory edits and deletes take precedence', async () => {
		const roomId = uniqueRoom();
		await seedKeys(roomId);
		const original = makeMessage({ id: 'm1', content: 'original', room_id: roomId });
		await saveRoomMessages(roomId, [original]);
		const deleted = {
			...original,
			content: '[Message deleted]',
			message_type: 'Deleted' as const
		};
		await saveRoomMessages(roomId, [deleted]);
		const loaded = await loadRoomMessages(roomId);
		expect(loaded).toHaveLength(1);
		expect(loaded[0].message_type).toBe('Deleted');
	});

	test('caps stored history at 500 messages, dropping oldest', async () => {
		const roomId = uniqueRoom();
		await seedKeys(roomId);
		const many = Array.from({ length: 520 }, (_, i) =>
			makeMessage({ id: `m${i}`, timestamp: i, room_id: roomId })
		);
		await saveRoomMessages(roomId, many);
		const loaded = await loadRoomMessages(roomId);
		expect(loaded).toHaveLength(500);
		expect(loaded[0].id).toBe('m20');
	});

	test('clearRoomMessages removes the page and any legacy plaintext', async () => {
		const roomId = uniqueRoom();
		await seedKeys(roomId);
		await saveRoomMessages(roomId, [makeMessage({ room_id: roomId })]);
		localStorage.setItem(`chatHistory_${roomId}`, '{"messages":[]}');
		await clearRoomMessages(roomId);
		expect(await rawPage(roomId)).toBeUndefined();
		expect(localStorage.getItem(`chatHistory_${roomId}`)).toBeNull();
	});

	test('a late empty save after clearRoomMessages does not resurrect the page', async () => {
		const roomId = uniqueRoom();
		await seedKeys(roomId);
		await saveRoomMessages(roomId, [makeMessage({ room_id: roomId })]);
		await clearRoomMessages(roomId);
		await seedKeys(roomId); // burn drops the key cache; a late save reloads keys
		await saveRoomMessages(roomId, []); // fire-and-forget save racing the burn
		expect(await rawPage(roomId)).toBeUndefined();
	});
});

describe('plaintext migration', () => {
	test('load migrates v2 plaintext then deletes it', async () => {
		const roomId = uniqueRoom();
		await seedKeys(roomId);
		const legacy = makeMessage({ id: 'legacy-1', room_id: roomId });
		localStorage.setItem(
			`chatHistory_${roomId}`,
			JSON.stringify({ version: 2, room_id: roomId, messages: [legacy] })
		);
		const loaded = await loadRoomMessages(roomId);
		expect(loaded.map((m) => m.id)).toEqual(['legacy-1']);
		expect(localStorage.getItem(`chatHistory_${roomId}`)).toBeNull();
		// second load reads the encrypted copy
		expect((await loadRoomMessages(roomId)).map((m) => m.id)).toEqual(['legacy-1']);
	});

	test('reads legacy Rust RoomMessageState shape during migration', async () => {
		const roomId = uniqueRoom();
		await seedKeys(roomId);
		const legacy = {
			room_id: roomId,
			messages: [makeMessage({ id: 'rust-1', room_id: roomId })],
			message_ids: ['rust-1'],
			last_sync: 0,
			unread_count: 0,
			total_messages: 1
		};
		localStorage.setItem(`chatHistory_${roomId}`, JSON.stringify(legacy));
		expect((await loadRoomMessages(roomId)).map((m) => m.id)).toEqual(['rust-1']);
		expect(localStorage.getItem(`chatHistory_${roomId}`)).toBeNull();
	});

	test('encrypted copy wins over stale plaintext for the same message id', async () => {
		const roomId = uniqueRoom();
		await seedKeys(roomId);
		const current = makeMessage({ id: 'm1', content: 'edited', room_id: roomId });
		await saveRoomMessages(roomId, [current]);
		localStorage.setItem(
			`chatHistory_${roomId}`,
			JSON.stringify({
				version: 2,
				room_id: roomId,
				messages: [{ ...current, content: 'stale original' }]
			})
		);
		const loaded = await loadRoomMessages(roomId);
		expect(loaded).toHaveLength(1);
		expect(loaded[0].content).toBe('edited');
	});

	test('corrupted plaintext is deleted, not thrown on', async () => {
		const roomId = uniqueRoom();
		await seedKeys(roomId);
		localStorage.setItem(`chatHistory_${roomId}`, '{not json');
		expect(await loadRoomMessages(roomId)).toEqual([]);
		expect(localStorage.getItem(`chatHistory_${roomId}`)).toBeNull();
	});

	test('sweep migrates rooms with keys and deletes plaintext for rooms without', async () => {
		const keyedRoom = uniqueRoom();
		const keylessRoom = uniqueRoom();
		await seedKeys(keyedRoom);
		localStorage.setItem(
			`chatHistory_${keyedRoom}`,
			JSON.stringify({
				version: 2,
				room_id: keyedRoom,
				messages: [makeMessage({ id: 'k1', room_id: keyedRoom })]
			})
		);
		localStorage.setItem(
			`chatHistory_${keylessRoom}`,
			JSON.stringify({
				version: 2,
				room_id: keylessRoom,
				messages: [makeMessage({ id: 'k2', room_id: keylessRoom })]
			})
		);
		await migrateLegacyPlaintext();
		expect(localStorage.getItem(`chatHistory_${keyedRoom}`)).toBeNull();
		expect(localStorage.getItem(`chatHistory_${keylessRoom}`)).toBeNull();
		expect((await loadRoomMessages(keyedRoom)).map((m) => m.id)).toEqual(['k1']);
	});

	test('sweep leaves unrelated localStorage keys alone', async () => {
		localStorage.setItem('mindline_currentRoomId', 'room-x');
		localStorage.setItem('theme', 'dark');
		await migrateLegacyPlaintext();
		expect(localStorage.getItem('mindline_currentRoomId')).toBe('room-x');
		expect(localStorage.getItem('theme')).toBe('dark');
	});
});
