import { describe, expect, test } from 'vitest';
import {
	KEM_CIPHERTEXT_BYTES,
	KEM_PUBLIC_KEY_BYTES,
	generateKemSeed,
	kemKeypair,
	unwrapSecret,
	wrapSecret
} from '$lib/crypto/kem';

const ctx = { roomId: 'room-a', g: 3, gid: 'gid-aaaaaaaaaaaa', recipientDeviceId: 'device-bbbb' };

function secret(): Uint8Array {
	return crypto.getRandomValues(new Uint8Array(32));
}

describe('X-Wing hybrid KEM wrap (PROTOCOL.md §1.4)', () => {
	test('keypair is deterministic from the seed with spec sizes', () => {
		const seed = generateKemSeed();
		expect(seed.length).toBe(32);
		const a = kemKeypair(seed);
		const b = kemKeypair(seed);
		expect(a.publicKey.length).toBe(KEM_PUBLIC_KEY_BYTES);
		expect(Buffer.from(a.publicKey).equals(Buffer.from(b.publicKey))).toBe(true);
	});

	test('wrap → unwrap round-trips a generation secret', async () => {
		const seed = generateKemSeed();
		const { publicKey } = kemKeypair(seed);
		const rk = secret();
		const wrap = await wrapSecret(publicKey, rk, ctx);
		expect(wrap.ct.length).toBe(KEM_CIPHERTEXT_BYTES);
		const out = await unwrapSecret(seed, wrap, ctx);
		expect(out).not.toBeNull();
		expect(Buffer.from(out!).equals(Buffer.from(rk))).toBe(true);
	});

	test('two wraps of the same secret share no nonce or ciphertext', async () => {
		const { publicKey } = kemKeypair(generateKemSeed());
		const rk = secret();
		const a = await wrapSecret(publicKey, rk, ctx);
		const b = await wrapSecret(publicKey, rk, ctx);
		expect(Buffer.from(a.n).equals(Buffer.from(b.n))).toBe(false);
		expect(Buffer.from(a.ct).equals(Buffer.from(b.ct))).toBe(false);
	});

	test('a tampered KEM ciphertext fails closed', async () => {
		const seed = generateKemSeed();
		const { publicKey } = kemKeypair(seed);
		const wrap = await wrapSecret(publicKey, secret(), ctx);
		wrap.ct[100] ^= 0xff;
		expect(await unwrapSecret(seed, wrap, ctx)).toBeNull();
	});

	test('the wrong recipient cannot unwrap', async () => {
		const { publicKey } = kemKeypair(generateKemSeed());
		const otherSeed = generateKemSeed();
		const wrap = await wrapSecret(publicKey, secret(), ctx);
		expect(await unwrapSecret(otherSeed, wrap, ctx)).toBeNull();
	});

	test.each([
		['roomId', { ...ctx, roomId: 'room-b' }],
		['g', { ...ctx, g: 4 }],
		['gid', { ...ctx, gid: 'gid-cccccccccccc' }],
		['recipientDeviceId', { ...ctx, recipientDeviceId: 'device-dddd' }]
	])('a wrap is bound to its context: swapped %s fails', async (_field, swapped) => {
		const seed = generateKemSeed();
		const { publicKey } = kemKeypair(seed);
		const wrap = await wrapSecret(publicKey, secret(), ctx);
		expect(await unwrapSecret(seed, wrap, swapped)).toBeNull();
	});

	test('the wrapped bytes never contain the plaintext secret', async () => {
		const { publicKey } = kemKeypair(generateKemSeed());
		const rk = secret();
		const wrap = await wrapSecret(publicKey, rk, ctx);
		expect(Buffer.from(wrap.wrapped).includes(Buffer.from(rk))).toBe(false);
	});
});
