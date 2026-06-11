import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, test } from 'vitest';
import { burnRoomData } from '$lib/storage/burn';
import { loadRoomMessages, saveRoomMessages } from '$lib/storage/messages';
import { getBlob, putBlob } from '$lib/media/blob-store';
import {
	loadReplayState,
	loadRoomKeys,
	saveReplayState,
	saveRoomKeys
} from '$lib/crypto/keystore';
import { createRoomKey, deriveRoomKeys, importRoomKeyMaterial } from '$lib/crypto/keys';
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

beforeEach(() => {
	indexedDB = new IDBFactory();
	globalThis.localStorage = new MemoryStorage();
});

describe('burnRoomData (PROTOCOL.md §4, PRIVACY.md)', () => {
	test('removes keys, replay state, history, blobs, and local markers', async () => {
		const roomId = `room-${crypto.randomUUID()}`;
		const deviceId = 'device-1';
		const keys = await deriveRoomKeys(await importRoomKeyMaterial(createRoomKey()));
		await saveRoomKeys(roomId, keys);
		await saveReplayState(roomId, { entries: [1, 2, 3] });
		await saveRoomMessages(roomId, [makeMessage({ room_id: roomId })]);
		await putBlob(keys, roomId, 'transfer-1', new TextEncoder().encode('img'), 'image/webp');
		localStorage.setItem(`chatHistory_${roomId}`, '{"messages":[]}');
		localStorage.setItem(`mindline_epoch_${deviceId}`, '7');

		await burnRoomData(roomId, deviceId);

		expect(await loadRoomKeys(roomId)).toBeNull();
		expect(await loadReplayState(roomId)).toBeNull();
		expect(await getBlob(keys, roomId, 'transfer-1')).toBeNull();
		// Re-seed keys to prove the encrypted page itself is gone, not just
		// unreadable.
		await saveRoomKeys(roomId, keys);
		expect(await loadRoomMessages(roomId)).toEqual([]);
		expect(localStorage.getItem(`chatHistory_${roomId}`)).toBeNull();
		expect(localStorage.getItem(`mindline_epoch_${deviceId}`)).toBeNull();
	});

	test('does not touch other rooms', async () => {
		const burned = `room-${crypto.randomUUID()}`;
		const kept = `room-${crypto.randomUUID()}`;
		const keysBurned = await deriveRoomKeys(await importRoomKeyMaterial(createRoomKey()));
		const keysKept = await deriveRoomKeys(await importRoomKeyMaterial(createRoomKey()));
		await saveRoomKeys(burned, keysBurned);
		await saveRoomKeys(kept, keysKept);
		const keptMessage = makeMessage({ room_id: kept });
		await saveRoomMessages(kept, [keptMessage]);
		await putBlob(keysKept, kept, 't-kept', new TextEncoder().encode('img'), 'image/webp');

		await burnRoomData(burned, null);

		expect(await loadRoomKeys(kept)).not.toBeNull();
		expect((await loadRoomMessages(kept)).map((m) => m.id)).toEqual([keptMessage.id]);
		expect(await getBlob(keysKept, kept, 't-kept')).not.toBeNull();
	});

	test('announces the burn on BroadcastChannel so other tabs evacuate', async () => {
		const roomId = `room-${crypto.randomUUID()}`;
		const keys = await deriveRoomKeys(await importRoomKeyMaterial(createRoomKey()));
		await saveRoomKeys(roomId, keys);

		const received = new Promise<unknown>((resolve, reject) => {
			const channel = new BroadcastChannel('mindline_burn');
			const timer = setTimeout(() => {
				channel.close();
				reject(new Error('no burn broadcast received'));
			}, 2000);
			channel.onmessage = (event) => {
				clearTimeout(timer);
				channel.close();
				resolve(event.data);
			};
		});

		await burnRoomData(roomId, null);
		expect(await received).toEqual({ roomId });
	});

	test('throws when deletion fails, so the UI can report an incomplete burn', async () => {
		const roomId = `room-${crypto.randomUUID()}`;
		const keys = await deriveRoomKeys(await importRoomKeyMaterial(createRoomKey()));
		await saveRoomKeys(roomId, keys);
		await saveRoomMessages(roomId, [makeMessage({ room_id: roomId })]);

		const broken = {
			open: () => {
				throw new Error('idb unavailable');
			}
		} as unknown as IDBFactory;
		const real = indexedDB;
		indexedDB = broken;
		try {
			await expect(burnRoomData(roomId, null)).rejects.toThrow(/burn incomplete/i);
		} finally {
			indexedDB = real;
		}
	});
});
