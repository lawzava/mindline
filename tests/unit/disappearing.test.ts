import { describe, expect, test } from 'vitest';
import {
	TIMER_CHOICES,
	isExpired,
	nextExpiry,
	nextTimerTimestamp,
	roomTimer,
	timerEventText,
	timerLabel,
	trimKeepingTimer,
	validTimer,
	validTtl,
	withoutExpired
} from '$lib/disappearing';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function m(id: string, timestamp: number, extra: Record<string, unknown> = {}) {
	return { id, timestamp, message_type: 'Text', ...extra };
}

describe('disappearing messages', () => {
	test('a lifetime is a whole number of milliseconds within bounds', () => {
		expect(validTtl(HOUR)).toBe(HOUR);
		for (const bad of [0, -1, 1.5, 1000, 400 * DAY, '3600000', null, undefined, NaN]) {
			expect(validTtl(bad)).toBeUndefined();
		}
		// A timer setting may also be 0: off.
		expect(validTimer(0)).toBe(0);
		expect(validTimer(DAY)).toBe(DAY);
		expect(validTimer(-5)).toBeUndefined();
	});

	test('a message expires at its signed time plus its lifetime', () => {
		const msg = m('a', 1000, { ttl: HOUR });
		expect(isExpired(msg, 1000 + HOUR - 1)).toBe(false);
		expect(isExpired(msg, 1000 + HOUR)).toBe(true);
		expect(isExpired(m('b', 1000), 1000 + 365 * DAY)).toBe(false);
	});

	test('expired messages are split out; the rest keep their order', () => {
		const list = [m('a', 0, { ttl: HOUR }), m('b', 10), m('c', 20, { ttl: DAY })];
		const { kept, expired } = withoutExpired(list, 2 * HOUR);
		expect(kept.map((x) => x.id)).toEqual(['b', 'c']);
		expect(expired.map((x) => x.id)).toEqual(['a']);
	});

	test('an unsigned copy without a lifetime takes the timer that was on when it was sent', () => {
		// A member serving history may strip the ttl and the signature with it.
		const list = [
			m('early', 50, { unsigned: true }),
			m('t-on', 100, { message_type: 'Timer', timer: HOUR }),
			m('stripped', 200, { unsigned: true }),
			m('t-off', 300, { message_type: 'Timer', timer: 0 }),
			m('late', 400, { unsigned: true })
		];
		const { kept, expired } = withoutExpired(list, 200 + HOUR);
		expect(expired.map((x) => x.id)).toEqual(['stripped']);
		expect(kept.map((x) => x.id)).toEqual(['early', 't-on', 't-off', 'late']);
		expect(isExpired(m('stripped', 200, { unsigned: true }), 200 + HOUR, list)).toBe(true);
		// An unsigned timer event is no evidence either way.
		const forged = [m('t', 100, { timer: HOUR, unsigned: true }), m('x', 200)];
		expect(withoutExpired(forged, 200 + 2 * HOUR).expired).toEqual([]);
	});

	test("a timer event cannot shorten an author's own message", () => {
		// Signed or live, a message without ttl is its author's word: a
		// backdated timer event must not delete it on everyone's device.
		const list = [m('t-on', 0, { message_type: 'Timer', timer: HOUR }), m('mine', 10)];
		expect(withoutExpired(list, 10 * DAY).expired).toEqual([]);
		expect(nextExpiry(list, 0)).toBeNull();
	});

	test('timer events never expire, whatever they carry', () => {
		const t = m('t', 0, { message_type: 'Timer', timer: HOUR, ttl: HOUR });
		expect(isExpired(t, 10 * DAY)).toBe(false);
		// A copy dressed up as a timer event is still just an unsigned copy.
		const list = [m('t-on', 0, { timer: HOUR }), m('dressed', 10, { timer: 0, unsigned: true })];
		expect(withoutExpired(list, 2 * HOUR).expired.map((x) => x.id)).toEqual(['dressed']);
	});

	test('a new timer event is dated after the one it replaces', () => {
		const list = [m('t', 5000, { timer: HOUR })];
		expect(nextTimerTimestamp(list, 1000)).toBe(5001);
		expect(nextTimerTimestamp(list, 9000)).toBe(9000);
		expect(nextTimerTimestamp([], 9000)).toBe(9000);
	});

	test('the next expiry is the earliest one still ahead', () => {
		expect(nextExpiry([m('a', 0), m('b', 100, { ttl: DAY }), m('c', 50, { ttl: HOUR })], 0)).toBe(
			50 + HOUR
		);
		expect(nextExpiry([m('a', 0)])).toBeNull();
	});

	test('the room timer is the latest trusted setting', () => {
		expect(roomTimer([])).toBe(0);
		const list = [
			m('t1', 100, { message_type: 'Timer', timer: HOUR }),
			m('x', 150),
			m('t2', 200, { message_type: 'Timer', timer: DAY })
		];
		expect(roomTimer(list)).toBe(DAY);
		// Turned off again.
		expect(roomTimer([...list, m('t3', 300, { message_type: 'Timer', timer: 0 })])).toBe(0);
		// An unsigned copy from history cannot set it.
		expect(roomTimer([...list, m('t4', 400, { timer: 0, unsigned: true })])).toBe(DAY);
		// The setting is the signed field, not the (unsigned) message type.
		expect(roomTimer([...list, m('t5', 500, { message_type: 'Timer' })])).toBe(DAY);
	});

	test('trimming history keeps the latest timer setting', () => {
		const list = [
			m('t', 0, { timer: HOUR }),
			...Array.from({ length: 5 }, (_, i) => m(`x${i}`, i + 1))
		];
		const trimmed = trimKeepingTimer(list, 3);
		expect(trimmed.map((x) => x.id)).toEqual(['t', 'x2', 'x3', 'x4']);
		expect(roomTimer(trimmed)).toBe(HOUR);
		expect(trimKeepingTimer(list, 10)).toEqual(list);
		// A flood of timer events does not get past the cap: only the one in
		// force at the start of what is kept survives the trim.
		const flood = [
			...Array.from({ length: 5 }, (_, i) => m(`t${i}`, i, { timer: HOUR })),
			...Array.from({ length: 3 }, (_, i) => m(`y${i}`, 10 + i))
		];
		expect(trimKeepingTimer(flood, 3).map((x) => x.id)).toEqual(['t4', 'y0', 'y1', 'y2']);
	});

	test('choices and labels read as people say them', () => {
		expect(TIMER_CHOICES.map((c) => c.label)).toEqual([
			'Off',
			'5 minutes',
			'1 hour',
			'1 day',
			'1 week'
		]);
		expect(timerLabel(DAY)).toBe('1 day');
		expect(timerLabel(2 * HOUR)).toBe('2 hours');
		expect(timerLabel(0)).toBe('Off');
		expect(timerEventText('You', DAY)).toBe('You set messages to disappear after 1 day');
		expect(timerEventText('Sam', 0)).toBe('Sam turned off disappearing messages');
	});
});
