/**
 * Key persistence (PROTOCOL.md §1.2, §4).
 *
 * Non-extractable CryptoKeys are structured-cloned into IndexedDB so a
 * device can reopen /{roomId} without the fragment. The raw fragment key
 * is never persisted.
 */

import type { DeviceIdentity } from './identity';
import { deviceIdFromSpki } from './identity';
import type { RoomKeys } from './keys';

const DB_NAME = 'mindline-keys';
const DB_VERSION = 2;
const ROOMS = 'rooms';
const DEVICE = 'device';
const REPLAY = 'replay';

interface StoredIdentity {
	publicKey: CryptoKey;
	privateKey: CryptoKey;
	spki: Uint8Array;
}

function openDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);
		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(ROOMS)) db.createObjectStore(ROOMS);
			if (!db.objectStoreNames.contains(DEVICE)) db.createObjectStore(DEVICE);
			if (!db.objectStoreNames.contains(REPLAY)) db.createObjectStore(REPLAY);
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

async function withStore<T>(
	store: string,
	mode: IDBTransactionMode,
	fn: (s: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
	const db = await openDb();
	try {
		return await new Promise<T>((resolve, reject) => {
			const tx = db.transaction(store, mode);
			const request = fn(tx.objectStore(store));
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
	} finally {
		db.close();
	}
}

export async function saveRoomKeys(roomId: string, keys: RoomKeys): Promise<void> {
	await withStore(ROOMS, 'readwrite', (s) =>
		s.put(
			{
				msg: keys.msg,
				eph: keys.eph,
				storage: keys.storage,
				auth: keys.auth,
				mediaBase: keys.mediaBase
			},
			roomId
		)
	);
}

export async function loadRoomKeys(roomId: string): Promise<RoomKeys | null> {
	const stored = await withStore<RoomKeys | undefined>(ROOMS, 'readonly', (s) => s.get(roomId));
	return stored ?? null;
}

export async function saveIdentity(identity: DeviceIdentity): Promise<void> {
	const record: StoredIdentity = {
		publicKey: identity.publicKey,
		privateKey: identity.privateKey,
		// structured clone stores Uint8Array directly; slice() copies exactly
		spki: identity.spki.slice()
	};
	await withStore(DEVICE, 'readwrite', (s) => s.put(record, 'identity'));
}

export async function loadIdentity(): Promise<DeviceIdentity | null> {
	const stored = await withStore<StoredIdentity | undefined>(DEVICE, 'readonly', (s) =>
		s.get('identity')
	);
	if (!stored) return null;
	const spki = new Uint8Array(stored.spki);
	return {
		deviceId: await deviceIdFromSpki(spki),
		publicKey: stored.publicKey,
		privateKey: stored.privateKey,
		spki
	};
}

export async function saveReplayState(roomId: string, state: unknown): Promise<void> {
	await withStore(REPLAY, 'readwrite', (s) => s.put(state, roomId));
}

export async function loadReplayState<T>(roomId: string): Promise<T | null> {
	const stored = await withStore<T | undefined>(REPLAY, 'readonly', (s) => s.get(roomId));
	return stored ?? null;
}

/** Delete a room's keys. Message/blob stores handle their own burn. */
export async function burnRoom(roomId: string): Promise<void> {
	await withStore(ROOMS, 'readwrite', (s) => s.delete(roomId));
	await withStore(REPLAY, 'readwrite', (s) => s.delete(roomId));
}
