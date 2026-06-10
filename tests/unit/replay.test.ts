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
