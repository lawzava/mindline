import { describe, expect, test } from 'vitest';
import {
	createRoomKey,
	deriveRoomKeys,
	importRoomKeyMaterial,
	parseKeyFragment,
	toKeyFragment
} from '$lib/crypto/keys';

describe('room key lifecycle', () => {
	test('createRoomKey returns 32 random bytes', () => {
		const a = createRoomKey();
		const b = createRoomKey();
		expect(a).toBeInstanceOf(Uint8Array);
		expect(a.length).toBe(32);
		expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
	});

	test('key fragment round-trips through URL hash format', () => {
		const key = createRoomKey();
		const fragment = toKeyFragment(key);
		expect(fragment).toMatch(/^k=[A-Za-z0-9_-]{43}$/); // base64url, no padding
		const parsed = parseKeyFragment(`#${fragment}`);
		expect(parsed).not.toBeNull();
		expect(Buffer.from(parsed!).equals(Buffer.from(key))).toBe(true);
	});

	test('parseKeyFragment rejects garbage', () => {
		expect(parseKeyFragment('')).toBeNull();
		expect(parseKeyFragment('#')).toBeNull();
		expect(parseKeyFragment('#k=')).toBeNull();
		expect(parseKeyFragment('#k=tooshort')).toBeNull();
		expect(parseKeyFragment('#other=abc')).toBeNull();
	});

	test('derived subkeys are non-extractable and domain-separated', async () => {
		const material = await importRoomKeyMaterial(createRoomKey());
		const keys = await deriveRoomKeys(material);
		for (const k of [keys.msg, keys.eph, keys.storage]) {
			expect(k.extractable).toBe(false);
			expect(k.algorithm.name).toBe('AES-GCM');
		}
		expect(keys.auth.algorithm.name).toBe('HMAC');

		// Domain separation: same plaintext+nonce under msg vs eph keys must differ
		const nonce = new Uint8Array(12);
		const data = new TextEncoder().encode('same input');
		const c1 = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, keys.msg, data);
		const c2 = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, keys.eph, data);
		expect(Buffer.from(c1).equals(Buffer.from(c2))).toBe(false);
	});

	test('different room keys derive independent subkeys', async () => {
		const m1 = await importRoomKeyMaterial(createRoomKey());
		const m2 = await importRoomKeyMaterial(createRoomKey());
		const k1 = await deriveRoomKeys(m1);
		const k2 = await deriveRoomKeys(m2);
		const nonce = new Uint8Array(12);
		const data = new TextEncoder().encode('x');
		const c1 = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, k1.msg, data);
		const c2 = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, k2.msg, data);
		expect(Buffer.from(c1).equals(Buffer.from(c2))).toBe(false);
	});
});
