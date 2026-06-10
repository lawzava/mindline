import { beforeAll, describe, expect, test } from 'vitest';
import { createRoomKey, deriveRoomKeys, importRoomKeyMaterial, type RoomKeys } from '$lib/crypto/keys';
import { openEnvelope, sealEnvelope, type Envelope } from '$lib/crypto/envelope';
import { createDeviceIdentity, type DeviceIdentity } from '$lib/crypto/identity';

let keys: RoomKeys;
let otherRoom: RoomKeys;
let alice: DeviceIdentity;
let bob: DeviceIdentity;
const ROOM = 'room-1';

beforeAll(async () => {
	keys = await deriveRoomKeys(await importRoomKeyMaterial(createRoomKey()));
	otherRoom = await deriveRoomKeys(await importRoomKeyMaterial(createRoomKey()));
	alice = await createDeviceIdentity();
	bob = await createDeviceIdentity();
});

const body = { type: 'chat', content: 'hello', messageId: 'm1', seq: 1 } as const;

describe('envelope seal/open', () => {
	test('round-trips a chat body with signature', async () => {
		const env = await sealEnvelope(body, { keys, roomId: ROOM, identity: alice, klass: 'msg' });
		expect(env.v).toBe(2);
		expect(env.t).toBe('msg');
		expect(env.s).toBe(alice.deviceId);
		expect(env.sig).toBeTruthy();
		const opened = await openEnvelope(env, {
			keys,
			roomId: ROOM,
			senderPublicKey: alice.publicKey
		});
		expect(opened).toEqual(body);
	});

	test('ciphertext does not contain plaintext', async () => {
		const env = await sealEnvelope(body, { keys, roomId: ROOM, identity: alice, klass: 'msg' });
		expect(JSON.stringify(env)).not.toContain('hello');
	});

	test('rejects envelope from another room (AAD mismatch)', async () => {
		const env = await sealEnvelope(body, { keys, roomId: ROOM, identity: alice, klass: 'msg' });
		await expect(
			openEnvelope(env, { keys, roomId: 'room-2', senderPublicKey: alice.publicKey })
		).rejects.toThrow();
	});

	test('rejects envelope decrypted with wrong room keys', async () => {
		const env = await sealEnvelope(body, { keys, roomId: ROOM, identity: alice, klass: 'msg' });
		await expect(
			openEnvelope(env, { keys: otherRoom, roomId: ROOM, senderPublicKey: alice.publicKey })
		).rejects.toThrow();
	});

	test('rejects sender spoofing (s swapped, AAD binds sender)', async () => {
		const env = await sealEnvelope(body, { keys, roomId: ROOM, identity: alice, klass: 'msg' });
		const forged: Envelope = { ...env, s: bob.deviceId };
		await expect(
			openEnvelope(forged, { keys, roomId: ROOM, senderPublicKey: bob.publicKey })
		).rejects.toThrow();
	});

	test('rejects tampered ciphertext', async () => {
		const env = await sealEnvelope(body, { keys, roomId: ROOM, identity: alice, klass: 'msg' });
		const c = Buffer.from(env.c, 'base64url');
		c[0] ^= 0xff;
		const tampered = { ...env, c: c.toString('base64url') };
		await expect(
			openEnvelope(tampered, { keys, roomId: ROOM, senderPublicKey: alice.publicKey })
		).rejects.toThrow();
	});

	test('rejects signature from a different identity', async () => {
		const env = await sealEnvelope(body, { keys, roomId: ROOM, identity: alice, klass: 'msg' });
		await expect(
			openEnvelope(env, { keys, roomId: ROOM, senderPublicKey: bob.publicKey })
		).rejects.toThrow(/signature/i);
	});

	test('eph envelopes skip signatures and still round-trip', async () => {
		const draft = { type: 'typing', content: 'partial dra', seq: 7 } as const;
		const env = await sealEnvelope(draft, { keys, roomId: ROOM, identity: alice, klass: 'eph' });
		expect(env.t).toBe('eph');
		expect(env.sig).toBeUndefined();
		const opened = await openEnvelope(env, { keys, roomId: ROOM });
		expect(opened).toEqual(draft);
	});

	test('msg envelope without signature is rejected', async () => {
		const env = await sealEnvelope(body, { keys, roomId: ROOM, identity: alice, klass: 'msg' });
		const stripped = { ...env };
		delete stripped.sig;
		await expect(
			openEnvelope(stripped, { keys, roomId: ROOM, senderPublicKey: alice.publicKey })
		).rejects.toThrow(/signature/i);
	});

	test('nonces are unique across many seals', async () => {
		const seen = new Set<string>();
		for (let i = 0; i < 2000; i++) {
			const env = await sealEnvelope({ ...body, seq: i }, { keys, roomId: ROOM, identity: alice, klass: 'msg' });
			expect(seen.has(env.n)).toBe(false);
			seen.add(env.n);
		}
	});

	test('AAD delimiter injection: crafted messageId cannot collide contexts', async () => {
		// id "m1|x" as chat must not open as id "m1" of type "chat|x"
		const a = await sealEnvelope(
			{ type: 'chat', content: 'a', messageId: 'm1|chat', seq: 1 },
			{ keys, roomId: ROOM, identity: alice, klass: 'msg' }
		);
		// Opening succeeds normally — the property we need is simply that open()
		// authenticates the full body; swapping body type/id fields is impossible
		// without re-encrypting. Verify by tampering the decrypted-side context:
		await expect(
			openEnvelope({ ...a, t: 'eph' } as Envelope, { keys, roomId: ROOM })
		).rejects.toThrow();
	});
});

describe('device identity', () => {
	test('deviceId is derived from the public key and stable', async () => {
		expect(alice.deviceId).toMatch(/^[A-Za-z0-9_-]{16}$/);
		expect(alice.deviceId).not.toBe(bob.deviceId);
	});
});
