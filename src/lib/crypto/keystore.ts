/**
 * Key persistence (PROTOCOL.md §1.2, §4).
 *
 * Non-extractable CryptoKeys are structured-cloned into IndexedDB so a
 * device can reopen /{roomId} without the fragment. The raw fragment key
 * is persisted only AES-GCM-wrapped inside its room's record (for copying
 * the invite after a fragment-less rejoin), never in plain form.
 *
 * Passkey lock (§4): once on, a room record holds only its link key,
 * encrypted under the lock key (./lock), and nothing that opens the room
 * without it. The room keys are derived again after each unlock.
 */

import type { DeviceIdentity, KemIdentity } from './identity';
import { createDeviceIdentity, createKemIdentity, deviceIdFromSpki } from './identity';
import { kemKeypair } from './kem';
import { deriveRoomKeys, importRoomKeyMaterial, type RoomKeys } from './keys';
import { LockedError, activeLockKey, lockNow, setActiveLockKey } from './lock';
import { lp } from './lp';
// Type-only: the runtime dependency goes the other way (p2p → keystore).
import type { PersistedRatchet } from '$lib/p2p/ratchet';

const DB_NAME = 'mindline-keys';
const DB_VERSION = 4;
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
		request.onupgradeneeded = (event) => {
			const db = request.result;
			if (!db.objectStoreNames.contains(ROOMS)) db.createObjectStore(ROOMS);
			if (!db.objectStoreNames.contains(DEVICE)) db.createObjectStore(DEVICE);
			if (!db.objectStoreNames.contains(REPLAY)) db.createObjectStore(REPLAY);
			if (!db.objectStoreNames.contains(GENERATIONS)) db.createObjectStore(GENERATIONS);
			// v→4 hygiene: strip the dead v2-era link-static msg/eph CryptoKeys
			// from ROOMS records (residual decrypt capability at rest beyond
			// what §1.2/§4 document), and drop pre-v3 flat-shape REPLAY sender
			// entries (they hydrate empty — replay.ts cloneSlots — but persist
			// forever). DEVICE is deliberately untouched: wiping it would reset
			// the epoch high-water and rotate identities, breaking TOFU pins.
			// Best-effort per record: leaving one stale record is harmless,
			// aborting the upgrade bricks the keystore.
			if (event.oldVersion > 0 && event.oldVersion < 4 && request.transaction) {
				const tx = request.transaction;
				tx.objectStore(ROOMS).openCursor().onsuccess = (e) => {
					const cursor = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
					if (!cursor) return;
					try {
						const rec = cursor.value as Record<string, unknown>;
						if ('msg' in rec || 'eph' in rec) {
							const { msg: _msg, eph: _eph, ...rest } = rec;
							void _msg;
							void _eph;
							cursor.update(rest);
						}
					} catch {
						/* best-effort */
					}
					cursor.continue();
				};
				tx.objectStore(REPLAY).openCursor().onsuccess = (e) => {
					const cursor = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
					if (!cursor) return;
					try {
						const state = cursor.value as Record<string, { msg?: unknown }>;
						const live = Object.fromEntries(
							Object.entries(state).filter(([, s]) => Array.isArray(s?.msg))
						);
						if (Object.keys(live).length === 0) cursor.delete();
						else if (Object.keys(live).length !== Object.keys(state).length) cursor.update(live);
					} catch {
						/* best-effort */
					}
					cursor.continue();
				};
			}
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

/** Bytes wrapped under a non-extractable AES-GCM key stored beside them. */
interface SealedBytes {
	wrapKey: CryptoKey;
	wrapped: Uint8Array;
	nonce: Uint8Array;
}

async function sealBytes(bytes: Uint8Array, aad: Uint8Array): Promise<SealedBytes> {
	const wrapKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
		'encrypt',
		'decrypt'
	]);
	const nonce = crypto.getRandomValues(new Uint8Array(12));
	const wrapped = new Uint8Array(
		await crypto.subtle.encrypt(
			{ name: 'AES-GCM', iv: nonce, additionalData: aad as BufferSource },
			wrapKey,
			bytes as BufferSource
		)
	);
	return { wrapKey, wrapped, nonce };
}

async function openBytes(sealed: SealedBytes, aad: Uint8Array): Promise<Uint8Array> {
	return new Uint8Array(
		await crypto.subtle.decrypt(
			{ name: 'AES-GCM', iv: sealed.nonce as BufferSource, additionalData: aad as BufferSource },
			sealed.wrapKey,
			sealed.wrapped as BufferSource
		)
	);
}

interface StoredRoom extends Partial<RoomKeys> {
	/** The link key, wrapped: lets a fragment-less rejoin still copy the invite. */
	invite?: SealedBytes;
	/** Passkey lock: the link key under the lock key, and nothing else. */
	locked?: Sealed;
}

const inviteAad = (roomId: string) => lp('invite-key', roomId);

/** Bytes under a key that is not stored with them (the lock key). */
interface Sealed {
	nonce: Uint8Array;
	data: Uint8Array;
}

export interface LockRecord {
	credentialId: Uint8Array;
	/** PRF input, and the HKDF salt for the lock key. */
	salt: Uint8Array;
	/** A known text under the lock key: tells a wrong passkey from a right one. */
	check: Sealed;
}

const LOCK = 'lock';
const lockedAad = (roomId: string) => lp('mindline/v1/locked-room', roomId);
const CHECK_AAD = lp('mindline/v1/lock-check');
const CHECK_TEXT = new TextEncoder().encode('mindline lock check');

async function encryptWith(key: CryptoKey, bytes: Uint8Array, aad: Uint8Array): Promise<Sealed> {
	const nonce = crypto.getRandomValues(new Uint8Array(12));
	const data = await crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv: nonce, additionalData: aad as BufferSource },
		key,
		bytes as BufferSource
	);
	return { nonce, data: new Uint8Array(data) };
}

async function decryptWith(key: CryptoKey, sealed: Sealed, aad: Uint8Array): Promise<Uint8Array> {
	return new Uint8Array(
		await crypto.subtle.decrypt(
			{ name: 'AES-GCM', iv: sealed.nonce as BufferSource, additionalData: aad as BufferSource },
			key,
			sealed.data as BufferSource
		)
	);
}

async function lockedRecord(roomId: string, raw: Uint8Array, key: CryptoKey): Promise<StoredRoom> {
	return { locked: await encryptWith(key, raw, lockedAad(roomId)) };
}

async function plainRecord(roomId: string, raw: Uint8Array): Promise<StoredRoom> {
	const keys = await deriveRoomKeys(await importRoomKeyMaterial(raw));
	return { ...keys, invite: await sealBytes(raw, inviteAad(roomId)) };
}

/** Changes whenever a room record is rewritten (every seal draws a fresh nonce). */
function roomTag(record: StoredRoom | undefined): string {
	if (!record) return '-';
	if (record.locked) return `L${Array.from(record.locked.nonce).join(',')}`;
	if (record.invite) return `I${Array.from(record.invite.nonce).join(',')}`;
	return 'P';
}

function lockTag(lock: LockRecord | undefined | null): string {
	return lock ? Array.from(lock.check.nonce).join(',') : '-';
}

/**
 * This tab's lock key, checked against the lock record now on disk. A key
 * kept from a lock another tab has since replaced is dropped, never used to
 * write records nobody could open again.
 */
async function currentLockKey(lock: LockRecord): Promise<CryptoKey> {
	const key = activeLockKey();
	if (!key) throw new LockedError();
	try {
		await decryptWith(key, lock.check, CHECK_AAD);
	} catch {
		lockNow();
		throw new LockedError();
	}
	return key;
}

/**
 * Put one room record, but only if the lock state is still the one it was
 * prepared for: a lock turned on (or off) by another tab in between must
 * not leave a record in the clear (or sealed under a lost key).
 */
async function putRoomUnderLock(
	roomId: string,
	record: StoredRoom,
	expectLock: string
): Promise<boolean> {
	const db = await openDb();
	try {
		return await new Promise<boolean>((resolve, reject) => {
			const tx = db.transaction([ROOMS, DEVICE], 'readwrite');
			let wrote = false;
			const probe = tx.objectStore(DEVICE).get(LOCK);
			probe.onsuccess = () => {
				if (lockTag(probe.result as LockRecord | undefined) !== expectLock) return;
				tx.objectStore(ROOMS).put(record, roomId);
				wrote = true;
			};
			tx.oncomplete = () => resolve(wrote);
			tx.onabort = () => reject(tx.error);
			tx.onerror = () => reject(tx.error);
		});
	} finally {
		db.close();
	}
}

/** Prepare a room record for the lock state now on disk, then write it under that state. */
async function writeRoom(
	roomId: string,
	prepare: (lock: LockRecord | null, key: CryptoKey | null) => Promise<StoredRoom>
): Promise<void> {
	for (let attempt = 0; attempt < 3; attempt++) {
		const lock = await loadLockRecord();
		const key = lock ? await currentLockKey(lock) : null;
		if (await putRoomUnderLock(roomId, await prepare(lock, key), lockTag(lock))) return;
	}
	throw new Error('the lock kept changing; room keys not saved');
}

/**
 * inviteKey: the raw link key to keep (wrapped) for re-sharing. Burn deletes
 * the whole record, invite included. On a locked device the record holds
 * only the link key under the lock key, and never opens without it.
 */
export async function saveRoomKeys(
	roomId: string,
	keys: RoomKeys,
	inviteKey?: Uint8Array
): Promise<void> {
	await writeRoom(roomId, async (lock, key) => {
		if (lock && key) {
			if (!inviteKey) throw new Error('a room can only be locked with its link key');
			return lockedRecord(roomId, inviteKey, key);
		}
		const record: StoredRoom = {
			storage: keys.storage,
			auth: keys.auth,
			hs: keys.hs,
			mediaBase: keys.mediaBase
		};
		if (inviteKey) record.invite = await sealBytes(inviteKey, inviteAad(roomId));
		return record;
	});
}

/** The room's link key, if this device kept it (see saveRoomKeys). */
export async function loadInviteKey(roomId: string): Promise<Uint8Array | null> {
	const stored = await withStore<StoredRoom | undefined>(ROOMS, 'readonly', (s) => s.get(roomId));
	if (stored?.locked) {
		const key = activeLockKey();
		if (!key) return null;
		try {
			return await decryptWith(key, stored.locked, lockedAad(roomId));
		} catch {
			return null;
		}
	}
	if (!stored?.invite) return null;
	try {
		return await openBytes(stored.invite, inviteAad(roomId));
	} catch {
		return null;
	}
}

/**
 * Attach a link key to a room this device already holds (legacy migration
 * from plaintext storage). Returns false when there is no such room, or
 * when the device is locked (retried after the next unlock).
 */
export async function saveInviteKey(roomId: string, inviteKey: Uint8Array): Promise<boolean> {
	const stored = await withStore<StoredRoom | undefined>(ROOMS, 'readonly', (s) => s.get(roomId));
	if (!stored) return false;
	if (stored.locked) return true; // a locked record already holds its link
	try {
		await writeRoom(roomId, async (lock, key) =>
			lock && key
				? lockedRecord(roomId, inviteKey, key)
				: { ...stored, invite: await sealBytes(inviteKey, inviteAad(roomId)) }
		);
	} catch (error) {
		if (error instanceof LockedError) return false;
		throw error;
	}
	return true;
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
	const stored = await withStore<StoredRoom | undefined>(ROOMS, 'readonly', (s) => s.get(roomId));
	if (!stored) return null;
	if (stored.locked) {
		// Sealed under a lock that no longer exists: nothing opens it (§4).
		if (!(await loadLockRecord())) return null;
		const key = activeLockKey();
		if (!key) throw new LockedError();
		let raw: Uint8Array;
		try {
			raw = await decryptWith(key, stored.locked, lockedAad(roomId));
		} catch {
			return null; // not this lock's record: treat as absent
		}
		return deriveRoomKeys(await importRoomKeyMaterial(raw));
	}
	const { storage, auth, hs, mediaBase } = stored;
	if (!storage || !auth || !hs || !mediaBase) return null;
	return { storage, auth, hs, mediaBase };
}

export async function loadLockRecord(): Promise<LockRecord | null> {
	return (await withStore<LockRecord | undefined>(DEVICE, 'readonly', (s) => s.get(LOCK))) ?? null;
}

/** Every room record, read in one transaction. */
async function allRooms(): Promise<Array<[string, StoredRoom]>> {
	const db = await openDb();
	try {
		return await new Promise((resolve, reject) => {
			const out: Array<[string, StoredRoom]> = [];
			const tx = db.transaction(ROOMS, 'readonly');
			tx.objectStore(ROOMS).openCursor().onsuccess = (e) => {
				const cursor = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
				if (!cursor) return;
				out.push([String(cursor.key), cursor.value as StoredRoom]);
				cursor.continue();
			};
			tx.oncomplete = () => resolve(out);
			tx.onabort = () => reject(tx.error);
			tx.onerror = () => reject(tx.error);
		});
	} finally {
		db.close();
	}
}

interface RoomWrite {
	id: string;
	/** roomTag of the record the write was prepared from. */
	expect: string;
	/** The new record, or null to delete it. */
	record: StoredRoom | null;
}

class LockChangedError extends Error {
	constructor() {
		super('the lock changed in another tab');
		this.name = 'LockChangedError';
	}
}

/**
 * Write room records and the lock record in one transaction. Aborts when
 * the lock record is not the one expected; skips any room another tab
 * rewrote or burned since it was read, so a sweep never brings one back.
 */
async function commitLock(
	rooms: RoomWrite[],
	lock: { expect: string | null; next: LockRecord | null | 'keep' },
	/**
	 * Strict mode (turning the lock on or off): every room is checked in this
	 * transaction. A changed room, or one outside the list that this rule
	 * does not allow, aborts the whole commit, so the caller starts over
	 * rather than leave a room in the clear or sealed under no lock.
	 */
	othersAllowed?: (record: StoredRoom) => boolean
): Promise<void> {
	const db = await openDb();
	try {
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction([ROOMS, DEVICE], 'readwrite');
			let changed = false;
			const probe = tx.objectStore(DEVICE).get(LOCK);
			probe.onsuccess = () => {
				if (
					lock.expect !== null &&
					lockTag(probe.result as LockRecord | undefined) !== lock.expect
				) {
					changed = true;
					tx.abort();
					return;
				}
				if (lock.next === null) tx.objectStore(DEVICE).delete(LOCK);
				else if (lock.next !== 'keep') tx.objectStore(DEVICE).put(lock.next, LOCK);
				if (othersAllowed) {
					const writes = new Map(rooms.map((write) => [write.id, write]));
					tx.objectStore(ROOMS).openCursor().onsuccess = (e) => {
						const cursor = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
						if (!cursor) return;
						const record = cursor.value as StoredRoom;
						const write = writes.get(String(cursor.key));
						const ok = write ? roomTag(record) === write.expect : othersAllowed(record);
						if (!ok) {
							changed = true;
							tx.abort();
							return;
						}
						if (write?.record) cursor.update(write.record);
						else if (write) cursor.delete();
						cursor.continue();
					};
					return;
				}
				for (const write of rooms) {
					const current = tx.objectStore(ROOMS).get(write.id);
					current.onsuccess = () => {
						if (roomTag(current.result as StoredRoom | undefined) !== write.expect) return;
						if (write.record) tx.objectStore(ROOMS).put(write.record, write.id);
						else tx.objectStore(ROOMS).delete(write.id);
					};
				}
			};
			tx.oncomplete = () => resolve();
			tx.onabort = () => reject(changed ? new LockChangedError() : tx.error);
			tx.onerror = () => reject(tx.error);
		});
	} finally {
		db.close();
	}
}

export async function allRoomIds(): Promise<string[]> {
	return (await allRooms()).map(([id]) => id);
}

/**
 * Which rooms the lock can cover. A room whose link key this device never
 * kept cannot be locked: it has to be removed before the lock goes on.
 */
export async function lockPlan(): Promise<{ lockable: string[]; unlockable: string[] }> {
	const lockable: string[] = [];
	const unlockable: string[] = [];
	const lock = await loadLockRecord();
	for (const [id, record] of await allRooms()) {
		// Sealed under a lock that no longer exists: nothing opens it.
		if (record.locked) {
			if (!lock) unlockable.push(id);
			continue;
		}
		(record.invite ? lockable : unlockable).push(id);
	}
	return { lockable, unlockable };
}

/**
 * Turn the lock on: every room record and the lock record in one commit.
 * Refused when a lock already exists (another tab turned it on first).
 */
export async function enableLock(
	key: CryptoKey,
	meta: { credentialId: Uint8Array; salt: Uint8Array }
): Promise<void> {
	const check = await encryptWith(key, CHECK_TEXT, CHECK_AAD);
	for (let attempt = 0; ; attempt++) {
		if (await loadLockRecord()) throw new LockChangedError();
		const rooms: RoomWrite[] = [];
		for (const [id, record] of await allRooms()) {
			if (!record.invite) throw new Error('remove the rooms without a saved link first');
			const raw = await openBytes(record.invite, inviteAad(id));
			rooms.push({ id, expect: roomTag(record), record: await lockedRecord(id, raw, key) });
		}
		try {
			// Every room must be in this commit: none may stay in the clear.
			await commitLock(
				rooms,
				{ expect: '-', next: { credentialId: meta.credentialId, salt: meta.salt, check } },
				() => false
			);
			break;
		} catch (error) {
			if (!(error instanceof LockChangedError) || attempt >= 2) throw error;
		}
	}
	setActiveLockKey(key);
}

/**
 * Open the lock with a key from the passkey. On success, rooms another tab
 * wrote in the clear meanwhile are locked too, or removed when they have
 * no link to lock them with.
 */
export async function unlock(key: CryptoKey): Promise<boolean> {
	const lock = await loadLockRecord();
	if (!lock) return false;
	try {
		await decryptWith(key, lock.check, CHECK_AAD);
	} catch {
		return false;
	}
	setActiveLockKey(key);
	const strays: RoomWrite[] = [];
	for (const [id, record] of await allRooms()) {
		if (record.locked) continue;
		const raw = record.invite
			? await openBytes(record.invite, inviteAad(id)).catch(() => null)
			: null;
		strays.push({
			id,
			expect: roomTag(record),
			record: raw ? await lockedRecord(id, raw, key) : null
		});
	}
	if (strays.length > 0) {
		try {
			await commitLock(strays, { expect: lockTag(lock), next: 'keep' });
		} catch (error) {
			if (!(error instanceof LockChangedError)) throw error;
			lockNow(); // the lock was turned off or replaced meanwhile
			return false;
		}
	}
	return true;
}

/** Turn the lock off (needs it open): rooms go back to ordinary records. */
export async function disableLock(): Promise<void> {
	for (let attempt = 0; ; attempt++) {
		const lock = await loadLockRecord();
		if (!lock) break;
		const key = await currentLockKey(lock);
		const rooms: RoomWrite[] = [];
		for (const [id, record] of await allRooms()) {
			if (!record.locked) continue;
			const raw = await decryptWith(key, record.locked, lockedAad(id));
			rooms.push({ id, expect: roomTag(record), record: await plainRecord(id, raw) });
		}
		try {
			// No sealed room may outlive the lock record.
			await commitLock(rooms, { expect: lockTag(lock), next: null }, (record) => !record.locked);
			break;
		} catch (error) {
			if (!(error instanceof LockChangedError) || attempt >= 2) throw error;
		}
	}
	lockNow();
}

/** Lost passkey: drop the lock once the caller has removed every room. */
export async function forgetLock(): Promise<void> {
	await commitLock([], { expect: null, next: null });
	lockNow();
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
 * Atomic get-or-create of the device ECDSA identity (PROTOCOL.md §1.3) —
 * the same cure as getOrCreateKemIdentity below: a plain load-then-save
 * races two first-launch tabs onto divergent deviceIds, and the losing
 * tab keeps signing under an identity whose record no longer exists
 * (peers TOFU-pin the winner and reject it). The keygen runs fully
 * *before* the transaction (IDB transactions auto-commit when the event
 * loop turns on non-IDB work); the loser adopts the stored winner,
 * rebuilding the deviceId from the stored SPKI.
 */
export async function getOrCreateIdentity(): Promise<DeviceIdentity> {
	const candidate = await createDeviceIdentity();
	const candidateRecord: StoredIdentity = {
		publicKey: candidate.publicKey,
		privateKey: candidate.privateKey,
		spki: candidate.spki.slice()
	};
	const db = await openDb();
	let winner: StoredIdentity;
	try {
		winner = await new Promise<StoredIdentity>((resolve, reject) => {
			const tx = db.transaction(DEVICE, 'readwrite');
			const store = tx.objectStore(DEVICE);
			let result = candidateRecord;
			const getReq = store.get('identity');
			getReq.onsuccess = () => {
				if (getReq.result) result = getReq.result as StoredIdentity;
				else store.put(candidateRecord, 'identity');
			};
			getReq.onerror = () => reject(getReq.error);
			tx.oncomplete = () => resolve(result);
			tx.onabort = () => reject(tx.error ?? getReq.error);
			tx.onerror = () => reject(tx.error ?? getReq.error);
		});
	} finally {
		db.close();
	}
	if (winner === candidateRecord) return candidate;
	const spki = new Uint8Array(winner.spki);
	return {
		deviceId: await deviceIdFromSpki(spki),
		publicKey: winner.publicKey,
		privateKey: winner.privateKey,
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
 * Persistence shape for the device KEM identity (PROTOCOL.md §1.3). The
 * X-Wing seed cannot be a WebCrypto key (the implementation is JS), so it
 * is stored only AES-256-GCM-wrapped under a non-extractable key
 * persisted beside it — the same at-rest protection class as the
 * WebCrypto keys, no raw key bytes in any record. The public key is
 * re-derived from the seed on load (deterministic), so the record
 * carries no redundant state.
 */
async function sealKemRecord(kem: KemIdentity): Promise<StoredKemIdentity> {
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
	return { wrapKey, wrappedSeed, nonce };
}

async function openKemRecord(stored: StoredKemIdentity): Promise<KemIdentity> {
	const seed = new Uint8Array(
		await crypto.subtle.decrypt(
			{
				name: 'AES-GCM',
				iv: stored.nonce as BufferSource,
				additionalData: KEM_SEED_AAD as BufferSource
			},
			stored.wrapKey,
			stored.wrappedSeed as BufferSource
		)
	);
	return { publicKey: kemKeypair(seed).publicKey, seed };
}

export async function saveKemIdentity(kem: KemIdentity): Promise<void> {
	const record = await sealKemRecord(kem);
	await withStore(DEVICE, 'readwrite', (s) => s.put(record, 'kem-identity'));
}

export async function loadKemIdentity(): Promise<KemIdentity | null> {
	const stored = await withStore<StoredKemIdentity | undefined>(DEVICE, 'readonly', (s) =>
		s.get('kem-identity')
	);
	if (!stored) return null;
	return openKemRecord(stored);
}

/**
 * Atomic get-or-create of the device KEM identity: a plain
 * load-then-save races two first-launch tabs onto divergent seeds under
 * the same deviceId — the losing tab's hellos are then TOFU-rejected by
 * every peer that pinned the winner. Same cure as the §2 epoch
 * allocator: the get and the conditional put share one IndexedDB
 * readwrite transaction (the crypto runs *before* the transaction —
 * IDB transactions auto-commit when the event loop turns on non-IDB
 * work). The losing candidate is discarded and the winner's record
 * decrypted instead.
 */
export async function getOrCreateKemIdentity(): Promise<KemIdentity> {
	const candidate = createKemIdentity();
	const candidateRecord = await sealKemRecord(candidate);
	const db = await openDb();
	let winner: StoredKemIdentity;
	try {
		winner = await new Promise<StoredKemIdentity>((resolve, reject) => {
			const tx = db.transaction(DEVICE, 'readwrite');
			const store = tx.objectStore(DEVICE);
			let result = candidateRecord;
			const getReq = store.get('kem-identity');
			getReq.onsuccess = () => {
				if (getReq.result) result = getReq.result as StoredKemIdentity;
				else store.put(candidateRecord, 'kem-identity');
			};
			getReq.onerror = () => reject(getReq.error);
			tx.oncomplete = () => resolve(result);
			tx.onabort = () => reject(tx.error ?? getReq.error);
			tx.onerror = () => reject(tx.error ?? getReq.error);
		});
	} finally {
		db.close();
	}
	if (winner === candidateRecord) return candidate;
	return openKemRecord(winner);
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
