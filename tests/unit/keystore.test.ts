import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, test } from 'vitest';
import { createRoomKey, deriveMediaKey, deriveRoomKeys, importRoomKeyMaterial } from '$lib/crypto/keys';
import { burnRoom, loadIdentity, loadRoomKeys, saveIdentity, saveRoomKeys } from '$lib/crypto/keystore';
import { createDeviceIdentity } from '$lib/crypto/identity';

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
		const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, keys.msg, data);
		const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, loaded!.msg, ct);
		expect(new TextDecoder().decode(pt)).toBe('hi');
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
});
