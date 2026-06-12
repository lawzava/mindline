import { describe, expect, it } from 'vitest';
import { shouldMint } from '$lib/p2p/rekey-policy';

describe('shouldMint (PROTOCOL.md §1.4 — minter selection)', () => {
	it('the lowest deviceId among direct peers and self mints', () => {
		expect(shouldMint('aaa', ['bbb', 'ccc'])).toBe(true);
		expect(shouldMint('bbb', ['aaa', 'ccc'])).toBe(false);
	});

	it('a member alone in the room mints', () => {
		expect(shouldMint('anything', [])).toBe(true);
	});

	it('comparison is plain lexicographic, matching the gid tie-break', () => {
		expect(shouldMint('B', ['a'])).toBe(true); // 'B' < 'a' in code units
	});
});
