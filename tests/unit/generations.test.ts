import { describe, expect, it } from 'vitest';
import {
	createRoomKey,
	deriveGenerationKeys,
	deriveRoomKeys,
	generationId,
	importRoomKeyMaterial
} from '$lib/crypto/keys';

describe('generation key schedule (PROTOCOL.md §1.2/§1.4)', () => {
	it('derives non-extractable AES-GCM msg/eph keys from a 32-byte generation secret', async () => {
		const rk = createRoomKey();
		const keys = await deriveGenerationKeys(rk);
		for (const k of [keys.msg, keys.eph]) {
			expect(k.extractable).toBe(false);
			expect(k.algorithm.name).toBe('AES-GCM');
		}
	});

	it('msg and eph within a generation are domain-separated', async () => {
		const keys = await deriveGenerationKeys(createRoomKey());
		const nonce = new Uint8Array(12);
		const data = new TextEncoder().encode('same input');
		const c1 = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, keys.msg, data);
		const c2 = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, keys.eph, data);
		expect(Buffer.from(c1).equals(Buffer.from(c2))).toBe(false);
	});

	it('different generation secrets derive cryptographically independent keys', async () => {
		const a = await deriveGenerationKeys(createRoomKey());
		const b = await deriveGenerationKeys(createRoomKey());
		const nonce = new Uint8Array(12);
		const data = new TextEncoder().encode('x');
		const ca = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, a.msg, data);
		const cb = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, b.msg, data);
		expect(Buffer.from(ca).equals(Buffer.from(cb))).toBe(false);
	});

	it('generation msg key differs from the v2 link-static msg key (distinct info strings)', async () => {
		// rk_0 == link key, but generation keys use v3 info strings, so the
		// g=0 generation key is independent of the legacy link-static msg key.
		const rk = createRoomKey();
		const linkKeys = await deriveRoomKeys(await importRoomKeyMaterial(rk));
		const genKeys = await deriveGenerationKeys(rk);
		const nonce = new Uint8Array(12);
		const data = new TextEncoder().encode('x');
		const cLink = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, linkKeys.msg, data);
		const cGen = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, genKeys.msg, data);
		expect(Buffer.from(cLink).equals(Buffer.from(cGen))).toBe(false);
	});

	it('generationId is a stable, deterministic, 16-char base64url tag of the secret', async () => {
		const rk = createRoomKey();
		const gid1 = await generationId(rk);
		const gid2 = await generationId(rk);
		expect(gid1).toBe(gid2);
		expect(gid1).toMatch(/^[A-Za-z0-9_-]{16}$/);
	});

	it('generationId differs for different secrets', async () => {
		expect(await generationId(createRoomKey())).not.toBe(await generationId(createRoomKey()));
	});

	it('exposes k_hs, a non-extractable AES-GCM handshake key on the link-static set', async () => {
		const keys = await deriveRoomKeys(await importRoomKeyMaterial(createRoomKey()));
		expect(keys.hs.extractable).toBe(false);
		expect(keys.hs.algorithm.name).toBe('AES-GCM');
		// distinct from storage (different info string)
		const nonce = new Uint8Array(12);
		const data = new TextEncoder().encode('x');
		const cHs = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, keys.hs, data);
		const cSt = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, keys.storage, data);
		expect(Buffer.from(cHs).equals(Buffer.from(cSt))).toBe(false);
	});
});
