/**
 * Encrypted media blob store (PROTOCOL.md §4).
 *
 * IndexedDB `mindline-blobs`, keyed `{roomId}/{transferId}`. Every blob is
 * AES-256-GCM under k_storage with AAD lp(roomId, 'blob', transferId), so
 * a stored ciphertext cannot be relocated to another slot, and nothing at
 * rest is plaintext.
 */

import type { RoomKeys } from '$lib/crypto/keys';
import { lp } from '$lib/crypto/lp';

const DB_NAME = 'mindline-blobs';
const DB_VERSION = 1;
const STORE = 'blobs';

interface StoredBlob {
	nonce: ArrayBuffer;
	data: ArrayBuffer;
	mime: string;
	size: number;
	storedAt: number;
}

function slotKey(roomId: string, transferId: string): string {
	return `${roomId}/${transferId}`;
}

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
			let result: T;
			request.onsuccess = () => {
				result = request.result;
			};
			request.onerror = () => reject(request.error);
			// Resolve only on durable commit: burn must not report blob
			// deletion that a late transaction abort then rolls back.
			tx.oncomplete = () => resolve(result);
			tx.onabort = () => reject(tx.error ?? request.error);
			tx.onerror = () => reject(tx.error ?? request.error);
		});
	} finally {
		db.close();
	}
}

export async function putBlob(
	keys: RoomKeys,
	roomId: string,
	transferId: string,
	data: Uint8Array,
	mime: string
): Promise<void> {
	const nonce = crypto.getRandomValues(new Uint8Array(12));
	const ciphertext = await crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv: nonce, additionalData: lp(roomId, 'blob', transferId) },
		keys.storage,
		data as BufferSource
	);
	const record: StoredBlob = {
		nonce: nonce.slice().buffer as ArrayBuffer,
		data: ciphertext,
		mime,
		size: data.byteLength,
		storedAt: Date.now()
	};
	await withStore('readwrite', (s) => s.put(record, slotKey(roomId, transferId)));
}

export interface LoadedBlob {
	data: Uint8Array;
	mime: string;
}

/** null when absent; throws when present but failing authentication. */
export async function getBlob(
	keys: RoomKeys,
	roomId: string,
	transferId: string
): Promise<LoadedBlob | null> {
	const record = await withStore<StoredBlob | undefined>('readonly', (s) =>
		s.get(slotKey(roomId, transferId))
	);
	if (!record) return null;

	let plaintext: ArrayBuffer;
	try {
		plaintext = await crypto.subtle.decrypt(
			{
				name: 'AES-GCM',
				iv: record.nonce,
				additionalData: lp(roomId, 'blob', transferId)
			},
			keys.storage,
			record.data
		);
	} catch {
		throw new Error('blob authentication failed (wrong slot or tampered)');
	}
	return { data: new Uint8Array(plaintext), mime: record.mime };
}

export async function deleteBlob(roomId: string, transferId: string): Promise<void> {
	await withStore('readwrite', (s) => s.delete(slotKey(roomId, transferId)));
}

export async function burnRoomBlobs(roomId: string): Promise<void> {
	await withStore('readwrite', (s) => s.delete(IDBKeyRange.bound(`${roomId}/`, `${roomId}/￿`)));
}

/** Refuse media when quota headroom is below 2x the incoming size (§4). */
export async function hasQuotaFor(size: number): Promise<boolean> {
	try {
		const { usage = 0, quota = 0 } = (await navigator.storage?.estimate?.()) ?? {};
		if (!quota) return true; // no estimate available: accept
		return quota - usage >= size * 2;
	} catch {
		return true;
	}
}
