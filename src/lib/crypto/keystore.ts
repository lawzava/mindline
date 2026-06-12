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
// Type-only: the runtime dependency goes the other way (p2p → keystore).
import type { PersistedRatchet } from '$lib/p2p/ratchet';

const DB_NAME = 'mindline-keys';
const DB_VERSION = 3;
const ROOMS = 'rooms';
const DEVICE = 'device';
const REPLAY = 'replay';
const GENERATIONS = 'generations';

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
			if (!db.objectStoreNames.contains(GENERATIONS)) db.createObjectStore(GENERATIONS);
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
			let result: T;
			request.onsuccess = () => {
				result = request.result;
			};
			request.onerror = () => reject(request.error);
			// Resolve only on durable commit: burn must not report key
			// deletion that a late transaction abort then rolls back.
			tx.oncomplete = () => resolve(result);
			tx.onabort = () => reject(tx.error ?? request.error);
			tx.onerror = () => reject(tx.error ?? request.error);
		});
	} finally {
		db.close();
	}
}

export async function saveRoomKeys(roomId: string, keys: RoomKeys): Promise<void> {
	await withStore(ROOMS, 'readwrite', (s) =>
		s.put(
			{
				storage: keys.storage,
				auth: keys.auth,
				hs: keys.hs,
				mediaBase: keys.mediaBase
			},
			roomId
		)
	);
}

/**
 * Persist the ratchet's generation state (PROTOCOL.md §1.4): derived
 * non-extractable CryptoKeys plus the public cert log — never a raw
 * generation secret, so a reloaded member reads/writes but cannot grant.
 */
export async function saveRatchetState(roomId: string, state: PersistedRatchet): Promise<void> {
	await withStore(GENERATIONS, 'readwrite', (s) => s.put(state, roomId));
}

export async function loadRatchetState(roomId: string): Promise<PersistedRatchet | null> {
	const stored = await withStore<PersistedRatchet | undefined>(GENERATIONS, 'readonly', (s) =>
		s.get(roomId)
	);
	return stored ?? null;
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

/**
 * Allocate the next device epoch (PROTOCOL.md §2). The high-water is
 * scoped to the device identity and stored in the DEVICE object store, so
 * a room burn (which clears ROOMS/REPLAY only) cannot reset it — the epoch
 * line is monotonic across reload, clock correction, and burn, and a
 * device is never censored by peers' persisted high-water.
 *
 * Read-increment-write runs in a single IndexedDB readwrite transaction.
 * IDB serializes readwrite transactions on the same store, so concurrent
 * tabs draw distinct, strictly increasing epochs without a separate lock.
 */
export async function allocateEpoch(deviceId: string): Promise<number> {
	const db = await openDb();
	try {
		return await new Promise<number>((resolve, reject) => {
			const tx = db.transaction(DEVICE, 'readwrite');
			const store = tx.objectStore(DEVICE);
			const recordKey = `epoch:${deviceId}`;
			let epoch = 0;
			const getReq = store.get(recordKey);
			getReq.onsuccess = () => {
				const highWater = Number(getReq.result) || 0;
				epoch = Math.max(Date.now(), highWater + 1);
				store.put(epoch, recordKey);
			};
			getReq.onerror = () => reject(getReq.error);
			tx.oncomplete = () => resolve(epoch);
			tx.onabort = () => reject(tx.error ?? getReq.error);
			tx.onerror = () => reject(tx.error ?? getReq.error);
		});
	} finally {
		db.close();
	}
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
	await withStore(GENERATIONS, 'readwrite', (s) => s.delete(roomId));
}
