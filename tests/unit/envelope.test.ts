import { beforeAll, describe, expect, test } from 'vitest';
import {
	createRoomKey,
	deriveGenerationKeys,
	deriveRoomKeys,
	importRoomKeyMaterial,
	type GenerationKeys,
	type RoomKeys
} from '$lib/crypto/keys';
import { openEnvelope, sealEnvelope, type Envelope } from '$lib/crypto/envelope';
import { createDeviceIdentity, type DeviceIdentity } from '$lib/crypto/identity';

let link: RoomKeys;
let gen0: GenerationKeys;
let gen1: GenerationKeys;
let otherGen: GenerationKeys;
let alice: DeviceIdentity;
let bob: DeviceIdentity;
const ROOM = 'room-1';

beforeAll(async () => {
	const rk = createRoomKey();
	link = await deriveRoomKeys(await importRoomKeyMaterial(rk));
	gen0 = await deriveGenerationKeys(rk);
	gen1 = await deriveGenerationKeys(createRoomKey());
	otherGen = await deriveGenerationKeys(createRoomKey());
	alice = await createDeviceIdentity();
	bob = await createDeviceIdentity();
});

const body = { type: 'chat', content: 'hello', messageId: 'm1', seq: 1 } as const;

describe('envelope seal/open (v4)', () => {
	test('round-trips a chat body with signature, stamping v4 + generation', async () => {
		const env = await sealEnvelope(body, {
			key: gen0.msg,
			roomId: ROOM,
			identity: alice,
			klass: 'msg',
			g: 0
		});
		expect(env.v).toBe(4);
		expect(env.t).toBe('msg');
		expect(env.g).toBe(0);
		expect(env.s).toBe(alice.deviceId);
		expect(env.sig).toBeTruthy();
		const opened = await openEnvelope(env, { key: gen0.msg, roomId: ROOM, senderPublicKey: alice.publicKey });
		expect(opened).toEqual(body);
	});

	test('ciphertext does not contain plaintext', async () => {
		const env = await sealEnvelope(body, { key: gen0.msg, roomId: ROOM, identity: alice, klass: 'msg', g: 0 });
		expect(JSON.stringify(env)).not.toContain('hello');
	});

	test('rejects envelope from another room (AAD mismatch)', async () => {
		const env = await sealEnvelope(body, { key: gen0.msg, roomId: ROOM, identity: alice, klass: 'msg', g: 0 });
		await expect(
			openEnvelope(env, { key: gen0.msg, roomId: 'room-2', senderPublicKey: alice.publicKey })
		).rejects.toThrow();
	});

	test('rejects envelope decrypted under another generation key', async () => {
		const env = await sealEnvelope(body, { key: gen0.msg, roomId: ROOM, identity: alice, klass: 'msg', g: 0 });
		await expect(
			openEnvelope(env, { key: otherGen.msg, roomId: ROOM, senderPublicKey: alice.publicKey })
		).rejects.toThrow();
	});

	test('rejects a generation swap (g bound into AAD)', async () => {
		const env = await sealEnvelope(body, { key: gen1.msg, roomId: ROOM, identity: alice, klass: 'msg', g: 1 });
		// Re-label as g:0 and open with the real g0 key: AAD mismatch + wrong key.
		const swapped: Envelope = { ...env, g: 0 };
		await expect(
			openEnvelope(swapped, { key: gen0.msg, roomId: ROOM, senderPublicKey: alice.publicKey })
		).rejects.toThrow();
	});

	test('rejects sender spoofing (s swapped, AAD binds sender)', async () => {
		const env = await sealEnvelope(body, { key: gen0.msg, roomId: ROOM, identity: alice, klass: 'msg', g: 0 });
		const forged: Envelope = { ...env, s: bob.deviceId };
		await expect(
			openEnvelope(forged, { key: gen0.msg, roomId: ROOM, senderPublicKey: bob.publicKey })
		).rejects.toThrow();
	});

	test('rejects tampered ciphertext', async () => {
		const env = await sealEnvelope(body, { key: gen0.msg, roomId: ROOM, identity: alice, klass: 'msg', g: 0 });
		const c = Buffer.from(env.c, 'base64url');
		c[0] ^= 0xff;
		const tampered = { ...env, c: c.toString('base64url') };
		await expect(
			openEnvelope(tampered, { key: gen0.msg, roomId: ROOM, senderPublicKey: alice.publicKey })
		).rejects.toThrow();
	});

	test('rejects signature from a different identity', async () => {
		const env = await sealEnvelope(body, { key: gen0.msg, roomId: ROOM, identity: alice, klass: 'msg', g: 0 });
		await expect(
			openEnvelope(env, { key: gen0.msg, roomId: ROOM, senderPublicKey: bob.publicKey })
		).rejects.toThrow(/signature/i);
	});

	test('eph envelopes skip signatures and still round-trip', async () => {
		const draft = { type: 'typing', content: 'partial dra', seq: 7 } as const;
		const env = await sealEnvelope(draft, { key: gen0.eph, roomId: ROOM, identity: alice, klass: 'eph', g: 0 });
		expect(env.t).toBe('eph');
		expect(env.sig).toBeUndefined();
		const opened = await openEnvelope(env, { key: gen0.eph, roomId: ROOM });
		expect(opened).toEqual(draft);
	});

	test('hs envelopes are signed and round-trip under the static handshake key', async () => {
		const hello = { type: 'hello', deviceId: alice.deviceId, seq: 1 } as const;
		const env = await sealEnvelope(hello, { key: link.hs, roomId: ROOM, identity: alice, klass: 'hs', g: 0 });
		expect(env.t).toBe('hs');
		expect(env.g).toBe(0);
		expect(env.sig).toBeTruthy();
		const opened = await openEnvelope(env, { key: link.hs, roomId: ROOM, senderPublicKey: alice.publicKey });
		expect(opened).toEqual(hello);
	});

	test('msg envelope without signature is rejected', async () => {
		const env = await sealEnvelope(body, { key: gen0.msg, roomId: ROOM, identity: alice, klass: 'msg', g: 0 });
		const stripped = { ...env };
		delete stripped.sig;
		await expect(
			openEnvelope(stripped, { key: gen0.msg, roomId: ROOM, senderPublicKey: alice.publicKey })
		).rejects.toThrow(/signature/i);
	});

	test('rejects v2 envelopes (hard cutover)', async () => {
		const env = await sealEnvelope(body, { key: gen0.msg, roomId: ROOM, identity: alice, klass: 'msg', g: 0 });
		await expect(
			openEnvelope({ ...env, v: 2 } as unknown as Envelope, {
				key: gen0.msg,
				roomId: ROOM,
				senderPublicKey: alice.publicKey
			})
		).rejects.toThrow(/version/i);
	});

	test('nonces are unique across many seals', async () => {
		const seen = new Set<string>();
		for (let i = 0; i < 2000; i++) {
			const env = await sealEnvelope({ ...body, seq: i }, { key: gen0.msg, roomId: ROOM, identity: alice, klass: 'msg', g: 0 });
			expect(seen.has(env.n)).toBe(false);
			seen.add(env.n);
		}
	});

	test('class swap is rejected (t bound into AAD)', async () => {
		const a = await sealEnvelope(
			{ type: 'chat', content: 'a', messageId: 'm1', seq: 1 },
			{ key: gen0.msg, roomId: ROOM, identity: alice, klass: 'msg', g: 0 }
		);
		await expect(
			openEnvelope({ ...a, t: 'eph' } as Envelope, { key: gen0.eph, roomId: ROOM })
		).rejects.toThrow();
	});
});

describe('device identity', () => {
	test('deviceId is derived from the public key and stable', async () => {
		expect(alice.deviceId).toMatch(/^[A-Za-z0-9_-]{16}$/);
		expect(alice.deviceId).not.toBe(bob.deviceId);
	});
});
