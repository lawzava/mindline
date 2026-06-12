/**
 * Key persistence (PROTOCOL.md §1.2, §4).
 *
 * Non-extractable CryptoKeys are structured-cloned into IndexedDB so a
 * device can reopen /{roomId} without the fragment. The raw fragment key
 * is never persisted.
 */

import type { DeviceIdentity, KemIdentity } from './identity';
import { deviceIdFromSpki } from './identity';
import { kemKeypair } from './kem';
import type { RoomKeys } from './keys';
import { lp } from './lp';
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
 *
 * Fails closed when the room's keys are gone (§4): a mint/adopt landing
 * after a burn — same tab in flight, or a sibling tab that has not yet
 * processed the burn broadcast — must not resurrect decrypt-capable key
 * material into a store the burn just cleared. The existence check and
 * the put share one transaction; burnRoom deletes ROOMS before
 * GENERATIONS, so both race directions end with the record absent.
 */
export async function saveRatchetState(roomId: string, state: PersistedRatchet): Promise<void> {
	const db = await openDb();
	try {
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction([ROOMS, GENERATIONS], 'readwrite');
			const probe = tx.objectStore(ROOMS).get(roomId);
			probe.onsuccess = () => {
				if (probe.result !== undefined) tx.objectStore(GENERATIONS).put(state, roomId);
			};
			probe.onerror = () => reject(probe.error);
			tx.oncomplete = () => resolve();
			tx.onabort = () => reject(tx.error ?? probe.error);
			tx.onerror = () => reject(tx.error ?? probe.error);
		});
	} finally {
		db.close();
	}
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

interface StoredKemIdentity {
	/** Non-extractable AES-GCM key that wraps the seed. */
	wrapKey: CryptoKey;
	wrappedSeed: Uint8Array;
	nonce: Uint8Array;
}

const KEM_SEED_AAD = lp('kem-seed');

/**
 * Persist the device KEM identity (PROTOCOL.md §1.3). The X-Wing seed
 * cannot be a WebCrypto key (the implementation is JS), so it is stored
 * only AES-256-GCM-wrapped under a non-extractable key persisted beside
 * it — the same at-rest protection class as the WebCrypto keys, no raw
 * key bytes in any record. The public key is re-derived from the seed on
 * load (deterministic), so the record carries no redundant state.
 */
export async function saveKemIdentity(kem: KemIdentity): Promise<void> {
	const wrapKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
		'encrypt',
		'decrypt'
	]);
	const nonce = crypto.getRandomValues(new Uint8Array(12));
	const wrappedSeed = new Uint8Array(
		await crypto.subtle.encrypt(
			{ name: 'AES-GCM', iv: nonce, additionalData: KEM_SEED_AAD as BufferSource },
			wrapKey,
			kem.seed as BufferSource
		)
	);
	const record: StoredKemIdentity = { wrapKey, wrappedSeed, nonce };
	await withStore(DEVICE, 'readwrite', (s) => s.put(record, 'kem-identity'));
}

export async function loadKemIdentity(): Promise<KemIdentity | null> {
	const stored = await withStore<StoredKemIdentity | undefined>(DEVICE, 'readonly', (s) =>
		s.get('kem-identity')
	);
	if (!stored) return null;
	const seed = new Uint8Array(
		await crypto.subtle.decrypt(
			{ name: 'AES-GCM', iv: stored.nonce as BufferSource, additionalData: KEM_SEED_AAD as BufferSource },
			stored.wrapKey,
			stored.wrappedSeed as BufferSource
		)
	);
	return { publicKey: kemKeypair(seed).publicKey, seed };
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
