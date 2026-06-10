import { describe, expect, test } from 'vitest';
import { ReplayGuard } from '$lib/crypto/replay';

describe('ReplayGuard', () => {
	test('accepts strictly increasing seq for msg class', () => {
		const guard = new ReplayGuard();
		expect(guard.check('alice', 'msg', 1)).toBe(true);
		expect(guard.check('alice', 'msg', 2)).toBe(true);
		expect(guard.check('alice', 'msg', 10)).toBe(true);
	});

	test('rejects replayed and stale msg seq', () => {
		const guard = new ReplayGuard();
		guard.check('alice', 'msg', 5);
		expect(guard.check('alice', 'msg', 5)).toBe(false);
		expect(guard.check('alice', 'msg', 3)).toBe(false);
	});

	test('tracks senders independently', () => {
		const guard = new ReplayGuard();
		guard.check('alice', 'msg', 5);
		expect(guard.check('bob', 'msg', 1)).toBe(true);
	});

	test('eph class tolerates reordering within window but rejects duplicates', () => {
		const guard = new ReplayGuard({ ephWindow: 8 });
		expect(guard.check('alice', 'eph', 10)).toBe(true);
		expect(guard.check('alice', 'eph', 8)).toBe(true); // late but in window
		expect(guard.check('alice', 'eph', 8)).toBe(false); // duplicate
		expect(guard.check('alice', 'eph', 1)).toBe(false); // outside window
	});

	test('reset clears a sender after reconnect/session change', () => {
		const guard = new ReplayGuard();
		guard.check('alice', 'msg', 100);
		guard.reset('alice');
		expect(guard.check('alice', 'msg', 1)).toBe(true);
	});
});
