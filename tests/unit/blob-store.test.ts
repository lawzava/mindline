import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, test } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createRoomKey, deriveRoomKeys, importRoomKeyMaterial, type RoomKeys } from '$lib/crypto/keys';
import { burnRoomBlobs, deleteBlob, getBlob, putBlob } from '$lib/media/blob-store';

let keys: RoomKeys;

beforeEach(async () => {
	indexedDB = new IDBFactory();
	keys = await deriveRoomKeys(await importRoomKeyMaterial(createRoomKey()));
});

const bytes = (n: number) => crypto.getRandomValues(new Uint8Array(n));

describe('encrypted blob store (PROTOCOL.md §4)', () => {
	test('round-trips a blob with its mime type', async () => {
		const data = bytes(1024 * 64);
		await putBlob(keys, 'room-1', 't-1', data, 'image/jpeg');
		const out = await getBlob(keys, 'room-1', 't-1');
		expect(out).not.toBeNull();
		expect(out!.mime).toBe('image/jpeg');
		expect(Buffer.from(out!.data).equals(Buffer.from(data))).toBe(true);
	});

	test('returns null for unknown transfer', async () => {
		expect(await getBlob(keys, 'room-1', 'missing')).toBeNull();
	});

	test('blob ciphertext cannot be opened under another room/transfer slot', async () => {
		const data = bytes(128);
		await putBlob(keys, 'room-1', 't-1', data, 'application/pdf');
		// relocate the stored record to a different key slot, then read
		const db = await new Promise<IDBDatabase>((resolve, reject) => {
			const req = indexedDB.open('mindline-blobs');
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => reject(req.error);
		});
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction('blobs', 'readwrite');
			const store = tx.objectStore('blobs');
			const get = store.get('room-1/t-1');
			get.onsuccess = () => {
				const put = store.put(get.result, 'room-1/t-2');
				put.onsuccess = () => resolve();
				put.onerror = () => reject(put.error);
			};
			get.onerror = () => reject(get.error);
		});
		db.close();
		await expect(getBlob(keys, 'room-1', 't-2')).rejects.toThrow();
	});

	test('stored bytes are not the plaintext (encrypted at rest)', async () => {
		const marker = new TextEncoder().encode('PLAINTEXT_MARKER_9000');
		await putBlob(keys, 'room-1', 't-1', marker, 'text/plain');
		const db = await new Promise<IDBDatabase>((resolve, reject) => {
			const req = indexedDB.open('mindline-blobs');
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => reject(req.error);
		});
		const raw = await new Promise<{ data: ArrayBuffer }>((resolve, reject) => {
			const tx = db.transaction('blobs', 'readonly');
			const get = tx.objectStore('blobs').get('room-1/t-1');
			get.onsuccess = () => resolve(get.result);
			get.onerror = () => reject(get.error);
		});
		db.close();
		const stored = new TextDecoder('latin1').decode(new Uint8Array(raw.data));
		expect(stored.includes('PLAINTEXT_MARKER_9000')).toBe(false);
	});

	test('deleteBlob removes one transfer; burnRoomBlobs removes the room', async () => {
		await putBlob(keys, 'room-1', 't-1', bytes(16), 'a/b');
		await putBlob(keys, 'room-1', 't-2', bytes(16), 'a/b');
		await putBlob(keys, 'room-2', 't-3', bytes(16), 'a/b');
		await deleteBlob('room-1', 't-1');
		expect(await getBlob(keys, 'room-1', 't-1')).toBeNull();
		expect(await getBlob(keys, 'room-1', 't-2')).not.toBeNull();
		await burnRoomBlobs('room-1');
		expect(await getBlob(keys, 'room-1', 't-2')).toBeNull();
		expect(await getBlob(keys, 'room-2', 't-3')).not.toBeNull();
	});
});
