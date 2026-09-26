import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, test } from 'vitest';
import { createRoomKey, deriveRoomKeys, importRoomKeyMaterial } from '$lib/crypto/keys';
import {
	disableLock,
	enableLock,
	loadInviteKey,
	loadLockRecord,
	loadRoomKeys,
	lockPlan,
	saveRoomKeys,
	unlock
} from '$lib/crypto/keystore';
import {
	LockedError,
	deriveLockKey,
	isUnlocked,
	lockNow,
	setActiveLockKey
} from '$lib/crypto/lock';

const SALT = new Uint8Array(32).fill(7);
const CREDENTIAL = new Uint8Array([1, 2, 3]);

beforeEach(() => {
	indexedDB = new IDBFactory();
	lockNow();
});

async function room(id: string, withInvite = true) {
	const raw = createRoomKey();
	const keys = await deriveRoomKeys(await importRoomKeyMaterial(raw));
	await saveRoomKeys(id, keys, withInvite ? raw : undefined);
	return { raw, keys };
}

async function seal(key: CryptoKey, text: string) {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const data = await crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv },
		key,
		new TextEncoder().encode(text)
	);
	return { iv, data };
}

async function open(key: CryptoKey, sealed: { iv: Uint8Array; data: ArrayBuffer }) {
	const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: sealed.iv }, key, sealed.data);
	return new TextDecoder().decode(plain);
}

/** The raw stored record, bypassing the keystore. */
function rawRoomRecord(id: string): Promise<Record<string, unknown> | undefined> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open('mindline-keys');
		req.onsuccess = () => {
			const db = req.result;
			const get = db.transaction('rooms').objectStore('rooms').get(id);
			get.onsuccess = () => {
				db.close();
				resolve(get.result);
			};
			get.onerror = () => reject(get.error);
		};
		req.onerror = () => reject(req.error);
	});
}

function putRawRoomRecord(id: string, record: unknown): Promise<void> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open('mindline-keys');
		req.onsuccess = () => {
			const db = req.result;
			const tx = db.transaction('rooms', 'readwrite');
			tx.objectStore('rooms').put(record, id);
			tx.oncomplete = () => {
				db.close();
				resolve();
			};
			tx.onerror = () => reject(tx.error);
		};
		req.onerror = () => reject(req.error);
	});
}

const lockKey = (prf = new Uint8Array(32).fill(1)) => deriveLockKey(prf, SALT);

describe('passkey lock at rest', () => {
	test('a locked room keeps no usable key on the device', async () => {
		const { keys } = await room('r1');
		const secret = await seal(keys.storage, 'history');
		await enableLock(await lockKey(), { credentialId: CREDENTIAL, salt: SALT });
		lockNow();

		const record = await rawRoomRecord('r1');
		expect(Object.keys(record!)).toEqual(['locked']);
		await expect(loadRoomKeys('r1')).rejects.toBeInstanceOf(LockedError);
		expect(await loadInviteKey('r1')).toBeNull();

		// The same passkey output opens it again, with the same history key.
		expect(await unlock(await lockKey())).toBe(true);
		expect(isUnlocked()).toBe(true);
		const reopened = await loadRoomKeys('r1');
		expect(await open(reopened!.storage, secret)).toBe('history');
	});

	test('a different passkey output does not unlock', async () => {
		await room('r1');
		await enableLock(await lockKey(), { credentialId: CREDENTIAL, salt: SALT });
		lockNow();
		expect(await unlock(await lockKey(new Uint8Array(32).fill(2)))).toBe(false);
		expect(isUnlocked()).toBe(false);
		await expect(loadRoomKeys('r1')).rejects.toBeInstanceOf(LockedError);
	});

	test('while locked, no room can be saved in the clear; once unlocked, new rooms are locked', async () => {
		await enableLock(await lockKey(), { credentialId: CREDENTIAL, salt: SALT });
		lockNow();
		await expect(room('r2')).rejects.toBeInstanceOf(LockedError);
		await unlock(await lockKey());
		const { raw } = await room('r3');
		expect(Object.keys((await rawRoomRecord('r3'))!)).toEqual(['locked']);
		expect(await loadInviteKey('r3')).toEqual(raw);
	});

	test('rooms without a saved link cannot be locked and are named first', async () => {
		await room('keeps', true);
		await room('orphan', false);
		expect(await lockPlan()).toEqual({ lockable: ['keeps'], unlockable: ['orphan'] });
		await expect(
			enableLock(await lockKey(), { credentialId: CREDENTIAL, salt: SALT })
		).rejects.toThrow();
		expect(await loadLockRecord()).toBeNull();
	});

	test('a room written in the clear by an older tab is locked on the next unlock', async () => {
		const { keys, raw } = await room('r1');
		await enableLock(await lockKey(), { credentialId: CREDENTIAL, salt: SALT });
		// An open tab from before the lock re-saves its keys the old way.
		lockNow();
		await putRawRoomRecord('late', {
			storage: keys.storage,
			auth: keys.auth,
			hs: keys.hs,
			mediaBase: keys.mediaBase
		});
		await unlock(await lockKey());
		// No link to lock it with: it cannot stay readable, so it is removed.
		expect(await rawRoomRecord('late')).toBeUndefined();
		expect(await loadInviteKey('r1')).toEqual(raw);
	});

	test('turning the lock off restores ordinary storage', async () => {
		const { keys } = await room('r1');
		const secret = await seal(keys.storage, 'kept');
		await enableLock(await lockKey(), { credentialId: CREDENTIAL, salt: SALT });
		await disableLock();
		lockNow();
		expect(await loadLockRecord()).toBeNull();
		const plain = await loadRoomKeys('r1');
		expect(await open(plain!.storage, secret)).toBe('kept');
	});

	test('turning the lock off needs it unlocked', async () => {
		await room('r1');
		await enableLock(await lockKey(), { credentialId: CREDENTIAL, salt: SALT });
		lockNow();
		await expect(disableLock()).rejects.toBeInstanceOf(LockedError);
	});

	test('a second lock over an existing one is refused, so no room is sealed away', async () => {
		const { raw } = await room('r1');
		await enableLock(await lockKey(), { credentialId: CREDENTIAL, salt: SALT });
		// Another tab still thinks the lock is off and turns it on again.
		lockNow();
		const other = await deriveLockKey(new Uint8Array(32).fill(9), new Uint8Array(32).fill(3));
		await expect(
			enableLock(other, { credentialId: CREDENTIAL, salt: new Uint8Array(32).fill(3) })
		).rejects.toThrow();
		expect(await unlock(await lockKey())).toBe(true);
		expect(await loadInviteKey('r1')).toEqual(raw);
	});

	test('a key from an older lock is caught before it writes anything', async () => {
		await enableLock(await lockKey(), { credentialId: CREDENTIAL, salt: SALT });
		// This tab kept a key while another tab replaced the lock.
		setActiveLockKey(await deriveLockKey(new Uint8Array(32).fill(5), SALT));
		await expect(room('r9')).rejects.toBeInstanceOf(LockedError);
		expect(isUnlocked()).toBe(false);
		expect(await rawRoomRecord('r9')).toBeUndefined();
	});

	test('a room sealed under a lock that is gone is offered for removal, not a dead end', async () => {
		await room('r1');
		await enableLock(await lockKey(), { credentialId: CREDENTIAL, salt: SALT });
		const sealed = await rawRoomRecord('r1');
		await disableLock();
		// Another tab wrote this sealed record just as the lock went off.
		await putRawRoomRecord('stranded', sealed);
		expect(await loadRoomKeys('stranded')).toBeNull();
		expect((await lockPlan()).unlockable).toContain('stranded');
	});
});
