import { describe, expect, test } from 'vitest';
import { lp } from '$lib/crypto/lp';

describe('lp (PROTOCOL.md §0 canonical encoding)', () => {
	test('length-prefixes each field as u32be(len) || utf8(field)', () => {
		const out = lp('ab', 'c');
		expect([...out]).toEqual([0, 0, 0, 2, 97, 98, 0, 0, 0, 1, 99]);
	});

	test('attacker-influenced values cannot play delimiter games', () => {
		expect([...lp('a|b', 'c')]).not.toEqual([...lp('a', 'b|c')]);
	});

	test('empty fields are preserved positionally', () => {
		expect([...lp('', 'x')]).toEqual([0, 0, 0, 0, 0, 0, 0, 1, 120]);
	});

	test('matches the per-module copies byte for byte', () => {
		// blob-store.ts and crypto-session.ts carry private copies of this
		// encoder; their AADs and proofs must keep verifying against data
		// written through this shared one.
		const reference = (...fields: string[]): Uint8Array => {
			const enc = new TextEncoder();
			const encoded = fields.map((f) => enc.encode(f));
			const out = new Uint8Array(encoded.reduce((sum, f) => sum + 4 + f.length, 0));
			const view = new DataView(out.buffer);
			let offset = 0;
			for (const f of encoded) {
				view.setUint32(offset, f.length);
				out.set(f, offset + 4);
				offset += 4 + f.length;
			}
			return out;
		};
		expect([...lp('room-1', 'storage', '0')]).toEqual([...reference('room-1', 'storage', '0')]);
	});
});
