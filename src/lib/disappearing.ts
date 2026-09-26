/**
 * Disappearing messages (PROTOCOL.md §4). A room's timer is set by any
 * member through a timer event: a signed message whose `timer` field is the
 * new lifetime (0 = off). Every message sent while it is on carries that
 * lifetime as `ttl`, covered by the author's signature, and every device
 * deletes it at `timestamp + ttl` by its own clock, media included.
 *
 * An unsigned copy without its own lifetime takes the timer that was on
 * when it was sent: a member serving history can strip `ttl` and the
 * signature with it, and the timeline still dates the copy. A signed or
 * live message without `ttl` is its author's word and is never shortened,
 * so a backdated timer event cannot delete what others said.
 *
 * Timer events never expire: they are how a newcomer learns the setting.
 * Trimming keeps the one in force where the kept history starts.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/** Accepted lifetimes: wider than the menu, so a future choice still works. */
const MIN_TTL = 30_000;
const MAX_TTL = 90 * DAY;

export const TIMER_CHOICES: readonly { ms: number; label: string }[] = [
	{ ms: 0, label: 'Off' },
	{ ms: 5 * MINUTE, label: '5 minutes' },
	{ ms: HOUR, label: '1 hour' },
	{ ms: DAY, label: '1 day' },
	{ ms: WEEK, label: '1 week' }
];

interface Expiring {
	id: string;
	timestamp: number;
	ttl?: number;
	timer?: number;
	unsigned?: boolean;
}

type TimerCarrier = Expiring;

export function validTtl(value: unknown): number | undefined {
	return Number.isSafeInteger(value) && (value as number) >= MIN_TTL && (value as number) <= MAX_TTL
		? (value as number)
		: undefined;
}

export function validTimer(value: unknown): number | undefined {
	return value === 0 ? 0 : validTtl(value);
}

/** A timer event that counts: the signed `timer` field, not an unsigned copy. */
function isTrustedTimerEvent(msg: TimerCarrier): boolean {
	return typeof msg.timer === 'number' && !msg.unsigned;
}

const later = (a: TimerCarrier, b: TimerCarrier) =>
	a.timestamp > b.timestamp || (a.timestamp === b.timestamp && a.id > b.id);

/** The trusted timer events in a list, oldest first. */
function timeline<T extends TimerCarrier>(list: readonly T[]): T[] {
	return list.filter(isTrustedTimerEvent).sort((a, b) => (later(a, b) ? 1 : later(b, a) ? -1 : 0));
}

/** The timer in force at a moment: the last event at or before it. */
function timerAt(events: readonly TimerCarrier[], timestamp: number): number {
	let timer = 0;
	for (const event of events) {
		if (event.timestamp > timestamp) break;
		timer = event.timer!;
	}
	return timer;
}

function expiryIn(msg: Expiring, events: readonly TimerCarrier[]): number | null {
	// Trusted timer events stay; an unsigned copy is dated like any other.
	if (isTrustedTimerEvent(msg)) return null;
	const ttl = msg.ttl || (msg.unsigned ? timerAt(events, msg.timestamp) : 0);
	return ttl ? msg.timestamp + ttl : null;
}

/** When a message goes, given the timer events it may be dated by. */
export function expiresAt(msg: Expiring, context: readonly TimerCarrier[] = []): number | null {
	return expiryIn(msg, timeline(context));
}

export function isExpired(
	msg: Expiring,
	now = Date.now(),
	context: readonly TimerCarrier[] = []
): boolean {
	const at = expiresAt(msg, context);
	return at !== null && at <= now;
}

/** Split a room's list, each message dated by the list's own timer events. */
export function withoutExpired<T extends Expiring>(
	list: readonly T[],
	now = Date.now()
): { kept: T[]; expired: T[] } {
	const events = timeline(list);
	const kept: T[] = [];
	const expired: T[] = [];
	for (const msg of list) {
		const at = expiryIn(msg, events);
		(at !== null && at <= now ? expired : kept).push(msg);
	}
	return { kept, expired };
}

/** When the next message in the list is due to go, or null for never. */
export function nextExpiry(list: readonly Expiring[], now = Date.now()): number | null {
	const events = timeline(list);
	let next: number | null = null;
	for (const msg of list) {
		const at = expiryIn(msg, events);
		if (at !== null && at > now && (next === null || at < next)) next = at;
	}
	return next;
}

/** The room's current lifetime for new messages, 0 when off. */
export function roomTimer(list: readonly TimerCarrier[]): number {
	return timeline(list).at(-1)?.timer ?? 0;
}

/**
 * The time for a new timer event: now, or just after the current one when
 * this clock runs behind the clock that set it, so the change still wins.
 */
export function nextTimerTimestamp(list: readonly TimerCarrier[], now = Date.now()): number {
	const latest = timeline(list).at(-1);
	return latest && latest.timestamp >= now ? latest.timestamp + 1 : now;
}

/**
 * The last `max` messages (sorted by time), plus the timer event in force
 * where they start, so the setting and the dating survive the trim.
 */
export function trimKeepingTimer<T extends TimerCarrier>(list: readonly T[], max: number): T[] {
	if (list.length <= max) return [...list];
	const inForce = timeline(list.slice(0, -max)).at(-1);
	const tail = list.slice(-max);
	return inForce ? [inForce, ...tail] : tail;
}

export function timerLabel(ms: number): string {
	const choice = TIMER_CHOICES.find((c) => c.ms === ms);
	if (choice) return choice.label;
	for (const [unit, size] of [
		['week', WEEK],
		['day', DAY],
		['hour', HOUR],
		['minute', MINUTE]
	] as const) {
		if (ms >= size) {
			const n = Math.round(ms / size);
			return `${n} ${unit}${n === 1 ? '' : 's'}`;
		}
	}
	return `${Math.round(ms / 1000)} seconds`;
}

/**
 * The text a timer event carries. Clients that predate timer events show
 * it as an ordinary message, so it has to read well on its own.
 */
export function timerNotice(ms: number): string {
	return ms === 0
		? 'Turned off disappearing messages.'
		: `Messages now disappear after ${timerLabel(ms)}.`;
}

/** The line a timer event shows in the stream. */
export function timerEventText(who: string, ms: number): string {
	return ms === 0
		? `${who} turned off disappearing messages`
		: `${who} set messages to disappear after ${timerLabel(ms)}`;
}
