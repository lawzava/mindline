import { describe, expect, it } from 'vitest';
import { rotationDue, shouldMint } from '$lib/p2p/rekey-policy';

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

describe('rotationDue (PROTOCOL.md §1.4 — bounded exposure)', () => {
	const policy = { maxAgeMs: 15 * 60_000, maxMessages: 200 };

	it('rotates an active generation after its time window', () => {
		expect(rotationDue({ startedAt: 0, now: 15 * 60_000, messages: 1 }, policy)).toBe(true);
		expect(rotationDue({ startedAt: 0, now: 15 * 60_000 - 1, messages: 1 }, policy)).toBe(false);
	});

	it('rotates after a burst of messages regardless of time', () => {
		expect(rotationDue({ startedAt: 0, now: 1000, messages: 200 }, policy)).toBe(true);
		expect(rotationDue({ startedAt: 0, now: 1000, messages: 199 }, policy)).toBe(false);
	});

	it('leaves an idle room alone: no traffic, nothing to protect', () => {
		expect(rotationDue({ startedAt: 0, now: 10 * 60 * 60_000, messages: 0 }, policy)).toBe(false);
	});
});
