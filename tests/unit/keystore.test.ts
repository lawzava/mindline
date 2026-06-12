import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, test } from 'vitest';
import {
	createRoomKey,
	deriveGenerationKeys,
	deriveMediaKey,
	deriveRoomKeys,
	importRoomKeyMaterial
} from '$lib/crypto/keys';
import {
	burnRoom,
	getOrCreateIdentity,
	getOrCreateKemIdentity,
	loadIdentity,
	loadKemIdentity,
	loadRatchetState,
	loadRoomKeys,
	saveIdentity,
	saveKemIdentity,
	saveRatchetState,
	saveRoomKeys
} from '$lib/crypto/keystore';
import { createDeviceIdentity, createKemIdentity } from '$lib/crypto/identity';
import { GenerationRatchet } from '$lib/p2p/ratchet';

beforeEach(() => {
	// fresh IDB per test
	indexedDB = new IDBFactory();
});

import { IDBFactory } from 'fake-indexeddb';

describe('keystore', () => {
	test('round-trips room keys and they still encrypt/decrypt', async () => {
		const keys = await deriveRoomKeys(await importRoomKeyMaterial(createRoomKey()));
		await saveRoomKeys('room-1', keys);
		const loaded = await loadRoomKeys('room-1');
		expect(loaded).not.toBeNull();
		const nonce = crypto.getRandomValues(new Uint8Array(12));
		const data = new TextEncoder().encode('hi');
		const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, keys.storage, data);
		const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, loaded!.storage, ct);
		expect(new TextDecoder().decode(pt)).toBe('hi');
	});

	test('ratchet state round-trips with usable keys and burnRoom clears it', async () => {
		// Generation state persists only for rooms whose keys exist (the
		// fail-closed §4 rule), matching CryptoSession.create's ordering.
		const roomKeys = await deriveRoomKeys(await importRoomKeyMaterial(createRoomKey()));
		await saveRoomKeys('room-1', roomKeys);
		const engine = GenerationRatchet.atLinkGeneration(
			'room-1',
			await deriveGenerationKeys(createRoomKey())
		);
		await engine.mintNext(await createDeviceIdentity());
		await saveRatchetState('room-1', engine.state());
		const loaded = await loadRatchetState('room-1');
		expect(loaded).not.toBeNull();
		const revived = GenerationRatchet.fromPersisted('room-1', loaded!);
		expect(revived.g).toBe(1);
		expect(revived.gid).toBe(engine.gid);
		// The revived keys still decrypt what the original encrypted.
		const nonce = crypto.getRandomValues(new Uint8Array(12));
		const ct = await crypto.subtle.encrypt(
			{ name: 'AES-GCM', iv: nonce },
			engine.currentKeys.msg,
			new TextEncoder().encode('post-ratchet')
		);
		await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, revived.keysFor(1)[0].msg, ct);
		// Raw secrets never persist: a revived engine cannot grant.
		expect(revived.canGrant()).toBe(false);
		await burnRoom('room-1');
		expect(await loadRatchetState('room-1')).toBeNull();
	});

	test('loadRatchetState returns null for unknown room', async () => {
		expect(await loadRatchetState('nope')).toBeNull();
	});

	test('saveRatchetState fails closed after burn (no key resurrection)', async () => {
		// An in-flight adopt or a sibling tab must not re-persist generation
		// decrypt keys into a store the burn just cleared (§4): the save is
		// conditional on the room's keys still existing.
		const keys = await deriveRoomKeys(await importRoomKeyMaterial(createRoomKey()));
		await saveRoomKeys('room-burned', keys);
		const engine = GenerationRatchet.atLinkGeneration(
			'room-burned',
			await deriveGenerationKeys(createRoomKey())
		);
		await engine.mintNext(await createDeviceIdentity());
		await saveRatchetState('room-burned', engine.state());
		await burnRoom('room-burned');
		// The race: a mint/adopt completing after the burn tries to persist.
		await saveRatchetState('room-burned', engine.state());
		expect(await loadRatchetState('room-burned')).toBeNull();
	});

	test('loadRoomKeys returns null for unknown room', async () => {
		expect(await loadRoomKeys('nope')).toBeNull();
	});

	test('media keys derived from persisted keys match pre-persistence derivation', async () => {
		const keys = await deriveRoomKeys(await importRoomKeyMaterial(createRoomKey()));
		await saveRoomKeys('room-1', keys);
		const loaded = await loadRoomKeys('room-1');
		const k1 = await deriveMediaKey(keys, 't-123');
		const k2 = await deriveMediaKey(loaded!, 't-123');
		const nonce = new Uint8Array(12);
		const data = new TextEncoder().encode('chunk');
		const c1 = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, k1, data);
		const c2 = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, k2, data);
		expect(Buffer.from(c1).equals(Buffer.from(c2))).toBe(true);
	});

	test('identity persists across loads with same deviceId', async () => {
		const identity = await createDeviceIdentity();
		await saveIdentity(identity);
		const loaded = await loadIdentity();
		expect(loaded).not.toBeNull();
		expect(loaded!.deviceId).toBe(identity.deviceId);
		// the loaded private key can still sign
		const sig = await crypto.subtle.sign(
			{ name: 'ECDSA', hash: 'SHA-256' },
			loaded!.privateKey,
			new Uint8Array([1, 2, 3])
		);
		expect(sig.byteLength).toBeGreaterThan(0);
	});

	test('loadIdentity returns null when none saved', async () => {
		expect(await loadIdentity()).toBeNull();
	});

	test('burnRoom removes that room only', async () => {
		const k1 = await deriveRoomKeys(await importRoomKeyMaterial(createRoomKey()));
		const k2 = await deriveRoomKeys(await importRoomKeyMaterial(createRoomKey()));
		await saveRoomKeys('room-1', k1);
		await saveRoomKeys('room-2', k2);
		await burnRoom('room-1');
		expect(await loadRoomKeys('room-1')).toBeNull();
		expect(await loadRoomKeys('room-2')).not.toBeNull();
	});

	test('KEM identity round-trips: reload yields the same public key and seed', async () => {
		const kem = await createKemIdentity();
		await saveKemIdentity(kem);
		const loaded = await loadKemIdentity();
		expect(loaded).not.toBeNull();
		expect(Buffer.from(loaded!.publicKey).equals(Buffer.from(kem.publicKey))).toBe(true);
		expect(Buffer.from(loaded!.seed).equals(Buffer.from(kem.seed))).toBe(true);
	});

	test('loadKemIdentity returns null when none saved', async () => {
		expect(await loadKemIdentity()).toBeNull();
	});

	test('the stored KEM record never contains the raw seed (§1.3 wrapped-at-rest)', async () => {
		const kem = await createKemIdentity();
		await saveKemIdentity(kem);
		const record = await new Promise<Record<string, unknown>>((resolve, reject) => {
			const open = indexedDB.open('mindline-keys');
			open.onerror = () => reject(open.error);
			open.onsuccess = () => {
				const get = open.result.transaction('device').objectStore('device').get('kem-identity');
				get.onsuccess = () => {
					open.result.close();
					resolve(get.result);
				};
				get.onerror = () => reject(get.error);
			};
		});
		expect(record).toBeDefined();
		const seed = Buffer.from(kem.seed);
		for (const value of Object.values(record)) {
			if (value instanceof Uint8Array) {
				expect(Buffer.from(value).includes(seed)).toBe(false);
			}
		}
	});

	test('concurrent first-launch sessions converge on one KEM identity (atomic get-or-create)', async () => {
		// Two tabs racing the v4 upgrade (identity present, kem absent) must
		// not diverge to different seeds under the same deviceId (review F1).
		const [k1, k2] = await Promise.all([getOrCreateKemIdentity(), getOrCreateKemIdentity()]);
		expect(Buffer.from(k1.publicKey).equals(Buffer.from(k2.publicKey))).toBe(true);
		expect(Buffer.from(k1.seed).equals(Buffer.from(k2.seed))).toBe(true);
		const persisted = await loadKemIdentity();
		expect(Buffer.from(persisted!.publicKey).equals(Buffer.from(k1.publicKey))).toBe(true);
	});

	test('getOrCreateKemIdentity returns the already-persisted identity', async () => {
		const first = await getOrCreateKemIdentity();
		const second = await getOrCreateKemIdentity();
		expect(Buffer.from(second.publicKey).equals(Buffer.from(first.publicKey))).toBe(true);
	});

	test('concurrent first-launch sessions converge on one device identity (atomic get-or-create)', async () => {
		// Two first tabs on a fresh device must not diverge to two deviceIds:
		// the loser's hello would be TOFU-rejected by peers that pinned the
		// winner (same race class as the KEM identity above, pre-existing).
		const [a, b] = await Promise.all([getOrCreateIdentity(), getOrCreateIdentity()]);
		expect(a.deviceId).toBe(b.deviceId);
		expect(Buffer.from(a.spki).equals(Buffer.from(b.spki))).toBe(true);
		const persisted = await loadIdentity();
		expect(persisted!.deviceId).toBe(a.deviceId);
	});

	test('getOrCreateIdentity adopts the persisted identity on later calls', async () => {
		const first = await getOrCreateIdentity();
		const second = await getOrCreateIdentity();
		expect(second.deviceId).toBe(first.deviceId);
		expect(Buffer.from(second.spki).equals(Buffer.from(first.spki))).toBe(true);
	});

	test('an adopted identity signs envelopes the persisted public key verifies', async () => {
		const first = await getOrCreateIdentity();
		const again = await getOrCreateIdentity();
		const data = new TextEncoder().encode('probe');
		const sig = await crypto.subtle.sign(
			{ name: 'ECDSA', hash: 'SHA-256' },
			again.privateKey,
			data
		);
		expect(
			await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, first.publicKey, sig, data)
		).toBe(true);
	});

	test('a room burn leaves the device-scoped KEM identity intact', async () => {
		const kem = await createKemIdentity();
		await saveKemIdentity(kem);
		const keys = await deriveRoomKeys(await importRoomKeyMaterial(createRoomKey()));
		await saveRoomKeys('room-1', keys);
		await burnRoom('room-1');
		expect(await loadKemIdentity()).not.toBeNull();
	});
});

describe('DB v4 migration (stale v2 keys, dead replay shapes)', () => {
	function openAt(version: number): Promise<IDBDatabase> {
		return new Promise((resolve, reject) => {
			const req = indexedDB.open('mindline-keys', version);
			req.onupgradeneeded = () => {
				for (const name of ['rooms', 'device', 'replay', 'generations']) {
					if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name);
				}
			};
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => reject(req.error);
		});
	}

	function put(db: IDBDatabase, store: string, key: string, value: unknown): Promise<void> {
		return new Promise((resolve, reject) => {
			const tx = db.transaction(store, 'readwrite');
			tx.objectStore(store).put(value, key);
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
		});
	}

	function get(db: IDBDatabase, store: string, key: string): Promise<unknown> {
		return new Promise((resolve, reject) => {
			const req = db.transaction(store, 'readonly').objectStore(store).get(key);
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => reject(req.error);
		});
	}

	test('strips v2 msg/eph keys from ROOMS, drops legacy replay senders, leaves DEVICE alone', async () => {
		const keys = await deriveRoomKeys(await importRoomKeyMaterial(createRoomKey()));
		const gen = await deriveGenerationKeys(createRoomKey());
		const v3 = await openAt(3);
		await put(v3, 'rooms', 'room-legacy', { ...keys, msg: gen.msg, eph: gen.eph });
		await put(v3, 'replay', 'room-legacy', {
			'sender-legacy': { msgEpoch: 1, msgHigh: 2, ephEpoch: 1, ephHigh: 0, ephSeen: [] },
			'sender-live': { msg: [{ epoch: 1, high: 2, seen: [] }], eph: [] }
		});
		await put(v3, 'device', 'epoch:dev-x', 42);
		v3.close();

		const migrated = await loadRoomKeys('room-legacy'); // opens at v4 → runs the migration
		expect(migrated).not.toBeNull();
		expect('msg' in (migrated as object)).toBe(false);
		expect('eph' in (migrated as object)).toBe(false);

		// The surviving static keys still work after the record rewrite.
		const nonce = crypto.getRandomValues(new Uint8Array(12));
		const ct = await crypto.subtle.encrypt(
			{ name: 'AES-GCM', iv: nonce },
			migrated!.storage,
			new TextEncoder().encode('probe')
		);
		await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, migrated!.storage, ct);

		const v4 = await openAt(4);
		const replay = (await get(v4, 'replay', 'room-legacy')) as Record<string, unknown>;
		expect(replay['sender-legacy']).toBeUndefined();
		expect(Array.isArray((replay['sender-live'] as { msg: unknown[] }).msg)).toBe(true);
		expect(await get(v4, 'device', 'epoch:dev-x')).toBe(42);
		v4.close();
	});

	test('a replay record with only legacy senders is deleted outright', async () => {
		const v3 = await openAt(3);
		await put(v3, 'replay', 'room-dead', {
			'sender-legacy': { msgEpoch: 1, msgHigh: 2, ephEpoch: 1, ephHigh: 0, ephSeen: [] }
		});
		v3.close();
		await loadRoomKeys('room-any'); // any keystore call opens at v4
		const v4 = await openAt(4);
		expect(await get(v4, 'replay', 'room-dead')).toBeUndefined();
		v4.close();
	});

	test('a fresh database (oldVersion 0) gets stores and no migration side effects', async () => {
		expect(await loadRoomKeys('room-none')).toBeNull();
		const keys = await deriveRoomKeys(await importRoomKeyMaterial(createRoomKey()));
		await saveRoomKeys('room-new', keys);
		expect(await loadRoomKeys('room-new')).not.toBeNull();
	});
});
