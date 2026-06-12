import { describe, expect, test } from 'vitest';
import { ReplayGuard } from '$lib/crypto/replay';

describe('ReplayGuard', () => {
	test('accepts strictly increasing seq within an epoch for msg class', () => {
		const guard = new ReplayGuard();
		expect(guard.check('alice', 'msg', 1, 1)).toBe(true);
		expect(guard.check('alice', 'msg', 1, 2)).toBe(true);
		expect(guard.check('alice', 'msg', 1, 10)).toBe(true);
	});

	test('rejects replayed and stale msg seq', () => {
		const guard = new ReplayGuard();
		guard.check('alice', 'msg', 1, 5);
		expect(guard.check('alice', 'msg', 1, 5)).toBe(false);
		expect(guard.check('alice', 'msg', 1, 3)).toBe(false);
	});

	test('a newer epoch resets seq tracking (reload is not censored)', () => {
		const guard = new ReplayGuard();
		guard.check('alice', 'msg', 1, 500);
		expect(guard.check('alice', 'msg', 2, 0)).toBe(true);
		expect(guard.check('alice', 'msg', 2, 1)).toBe(true);
	});

	test('an older epoch is rejected outright (replayed old session)', () => {
		const guard = new ReplayGuard();
		guard.check('alice', 'msg', 3, 1);
		expect(guard.check('alice', 'msg', 2, 999)).toBe(false);
	});

	test('tracks senders independently', () => {
		const guard = new ReplayGuard();
		guard.check('alice', 'msg', 1, 5);
		expect(guard.check('bob', 'msg', 1, 1)).toBe(true);
	});

	test('eph class tolerates reordering within window but rejects duplicates', () => {
		const guard = new ReplayGuard({ ephWindow: 8 });
		expect(guard.check('alice', 'eph', 1, 10)).toBe(true);
		expect(guard.check('alice', 'eph', 1, 8)).toBe(true); // late but in window
		expect(guard.check('alice', 'eph', 1, 8)).toBe(false); // duplicate
		expect(guard.check('alice', 'eph', 1, 1)).toBe(false); // outside window
	});

	test('state survives serialize/hydrate round-trip', () => {
		const guard = new ReplayGuard();
		guard.check('alice', 'msg', 2, 7);
		const restored = ReplayGuard.hydrate(guard.serialize());
		expect(restored.check('alice', 'msg', 2, 7)).toBe(false);
		expect(restored.check('alice', 'msg', 1, 99)).toBe(false);
		expect(restored.check('alice', 'msg', 2, 8)).toBe(true);
	});

	test('reset clears a sender', () => {
		const guard = new ReplayGuard();
		guard.check('alice', 'msg', 5, 100);
		guard.reset('alice');
		expect(guard.check('alice', 'msg', 1, 1)).toBe(true);
	});
});

describe('ReplayGuard K-epoch window (PROTOCOL.md §2 — multi-tab)', () => {
	test('retains concurrent epochs so interleaved tabs are not censored', () => {
		const guard = new ReplayGuard();
		// Two tabs of one device: distinct epochs, interleaved sends.
		expect(guard.check('alice', 'msg', 100, 1)).toBe(true);
		expect(guard.check('alice', 'msg', 101, 1)).toBe(true);
		// The lower epoch keeps flowing after the higher one appeared.
		expect(guard.check('alice', 'msg', 100, 2)).toBe(true);
		expect(guard.check('alice', 'msg', 101, 2)).toBe(true);
		// Replays within each retained epoch are still rejected.
		expect(guard.check('alice', 'msg', 100, 2)).toBe(false);
		expect(guard.check('alice', 'msg', 101, 1)).toBe(false);
	});

	test('evicts the smallest epoch past K, and an evicted epoch cannot be replayed', () => {
		const guard = new ReplayGuard({ maxEpochs: 4 });
		for (const e of [10, 11, 12, 13]) expect(guard.check('alice', 'msg', e, 1)).toBe(true);
		// Admitting a 5th epoch evicts the smallest (10).
		expect(guard.check('alice', 'msg', 14, 1)).toBe(true);
		// A fresh, higher seq under the evicted epoch is now rejected (one-way).
		expect(guard.check('alice', 'msg', 10, 999)).toBe(false);
		// The four most-recent epochs still accept fresh seq.
		for (const e of [11, 12, 13, 14]) expect(guard.check('alice', 'msg', e, 2)).toBe(true);
	});

	test('an epoch below the smallest retained is rejected', () => {
		const guard = new ReplayGuard({ maxEpochs: 2 });
		guard.check('alice', 'msg', 50, 1);
		guard.check('alice', 'msg', 51, 1);
		expect(guard.check('alice', 'msg', 49, 1)).toBe(false);
	});

	test('eph epochs are tracked independently with their own reorder windows', () => {
		const guard = new ReplayGuard({ ephWindow: 8 });
		expect(guard.check('alice', 'eph', 200, 10)).toBe(true);
		expect(guard.check('alice', 'eph', 201, 10)).toBe(true);
		// Reorder within each epoch independently.
		expect(guard.check('alice', 'eph', 200, 9)).toBe(true);
		expect(guard.check('alice', 'eph', 201, 9)).toBe(true);
		// Duplicate within an epoch rejected.
		expect(guard.check('alice', 'eph', 200, 9)).toBe(false);
	});

	test('K-epoch state survives serialize/hydrate', () => {
		const guard = new ReplayGuard();
		guard.check('alice', 'msg', 100, 5);
		guard.check('alice', 'msg', 101, 3);
		const restored = ReplayGuard.hydrate(guard.serialize());
		expect(restored.check('alice', 'msg', 100, 5)).toBe(false); // replay
		expect(restored.check('alice', 'msg', 101, 3)).toBe(false); // replay
		expect(restored.check('alice', 'msg', 100, 6)).toBe(true); // fresh in retained epoch
		expect(restored.check('alice', 'msg', 101, 4)).toBe(true);
	});
});
