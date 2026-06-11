import { describe, expect, it } from 'vitest';
import { applyReaction } from '$lib/p2p/reactions';

describe('applyReaction (PROTOCOL.md §3.5 — membership keyed by verified deviceId)', () => {
	it('add inserts the acting deviceId once', () => {
		const out = applyReaction({}, '👍', 'dev-a', 'add');
		expect(out['👍']).toEqual({ users: ['dev-a'], count: 1 });
		expect(applyReaction(out, '👍', 'dev-a', 'add')['👍'].users).toEqual(['dev-a']);
	});

	it('remove deletes only the acting device, never others', () => {
		const start = { '👍': { users: ['dev-a', 'dev-b'], count: 2 } };
		const out = applyReaction(start, '👍', 'dev-a', 'remove');
		expect(out['👍']).toEqual({ users: ['dev-b'], count: 1 });
	});

	it('removing the last member deletes the emoji entry', () => {
		const out = applyReaction({ '👍': { users: ['dev-a'], count: 1 } }, '👍', 'dev-a', 'remove');
		expect(out['👍']).toBeUndefined();
	});

	it('remove by a non-member is a no-op', () => {
		const start = { '👍': { users: ['dev-a'], count: 1 } };
		expect(applyReaction(start, '👍', 'dev-x', 'remove')).toEqual(start);
	});

	it('does not mutate the input map', () => {
		const start = { '👍': { users: ['dev-a'], count: 1 } };
		applyReaction(start, '👍', 'dev-b', 'add');
		expect(start['👍'].users).toEqual(['dev-a']);
	});

	it('leaves legacy entries under other ids untouched', () => {
		const legacyUuid = '550e8400-e29b-41d4-a716-446655440000';
		const start = { '🔥': { users: [legacyUuid], count: 1 } };
		const out = applyReaction(start, '👍', 'dev-a', 'add');
		expect(out['🔥'].users).toEqual([legacyUuid]);
	});
});
