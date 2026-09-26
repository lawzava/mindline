import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
	createDraftAnnouncer,
	readyLength,
	resumeFrom,
	MIN_GAP_MS,
	PAUSE_MS
} from '$lib/reading-aloud';

describe('readyLength', () => {
	test('a sentence or clause is ready once whitespace follows it', () => {
		expect(readyLength('Hello there. How')).toBe('Hello there. '.length);
		expect(readyLength('Well, I')).toBe('Well, '.length);
		expect(readyLength('"Really?" she')).toBe('"Really?" '.length);
		expect(readyLength('line one\nline')).toBe('line one\n'.length);
	});

	test('a half-typed word or a decimal point is not a boundary', () => {
		expect(readyLength('Hello')).toBe(0);
		expect(readyLength('It costs 3.5')).toBe(0);
		expect(readyLength('Hello there.')).toBe(0);
	});

	test('an unpunctuated run is spoken in groups of whole words', () => {
		expect(readyLength('one two three four five')).toBe(0);
		expect(readyLength('one two three four five six')).toBe(0);
		expect(readyLength('one two three four five six se')).toBe(
			'one two three four five six '.length
		);
	});
});

describe('resumeFrom', () => {
	test('growing text keeps what was spoken', () => {
		expect(resumeFrom('Hello there, ', 'Hello there, friend')).toBe('Hello there, ');
	});

	test('a correction rewinds to the start of the changed word', () => {
		expect(resumeFrom('Hello thete, ', 'Hello there')).toBe('Hello ');
		expect(resumeFrom('Hi, ', 'Yo')).toBe('');
	});

	test('a word spoken at a pause is re-read whole when it grows', () => {
		expect(resumeFrom('I think so', 'I think sooo')).toBe('I think ');
		expect(resumeFrom('I think so', 'I think so ok')).toBe('I think so');
	});
});

describe('createDraftAnnouncer', () => {
	let spoken: string[];
	let announcer: ReturnType<typeof createDraftAnnouncer>;

	beforeEach(() => {
		vi.useFakeTimers();
		spoken = [];
		announcer = createDraftAnnouncer((text) => spoken.push(text));
	});

	afterEach(() => {
		announcer.dispose();
		vi.useRealTimers();
	});

	function type(peerId: string, name: string, text: string, msPerKey = 80): void {
		for (let i = 1; i <= text.length; i++) {
			announcer.update(peerId, name, text.slice(0, i));
			vi.advanceTimersByTime(msPerKey);
		}
	}

	test('steady typing is never announced per keystroke', () => {
		type('p1', 'Ana', 'hello how are');
		expect(spoken).toEqual([]);
		vi.advanceTimersByTime(PAUSE_MS);
		expect(spoken).toEqual(['Ana: hello how are']);
	});

	test('sentence ends are spoken as they complete, then the rest at the pause', () => {
		type('p1', 'Ana', 'I am here. Are you coming');
		expect(spoken).toEqual(['Ana: I am here.']);
		vi.advanceTimersByTime(PAUSE_MS);
		expect(spoken).toEqual(['Ana: I am here.', 'Are you coming']);
	});

	test('boundaries closer than the minimum gap wait for the pause', () => {
		type('p1', 'Ana', 'a, b, c', 10);
		expect(spoken).toEqual(['Ana: a,']);
		vi.advanceTimersByTime(PAUSE_MS);
		expect(spoken).toEqual(['Ana: a,', 'b, c']);
		expect(MIN_GAP_MS).toBeGreaterThanOrEqual(PAUSE_MS);
	});

	test('a repeated identical update does not restart or repeat anything', () => {
		announcer.update('p1', 'Ana', 'ok');
		vi.advanceTimersByTime(PAUSE_MS - 10);
		announcer.update('p1', 'Ana', 'ok');
		vi.advanceTimersByTime(10);
		expect(spoken).toEqual(['Ana: ok']);
		announcer.update('p1', 'Ana', 'ok');
		vi.advanceTimersByTime(PAUSE_MS * 3);
		expect(spoken).toEqual(['Ana: ok']);
	});

	test('the speaker is named again when the voice changes', () => {
		type('p1', 'Ana', 'hi');
		vi.advanceTimersByTime(PAUSE_MS);
		type('p2', 'Ben', 'hey');
		vi.advanceTimersByTime(PAUSE_MS);
		announcer.update('p1', 'Ana', 'hi there');
		vi.advanceTimersByTime(PAUSE_MS);
		expect(spoken).toEqual(['Ana: hi', 'Ben: hey', 'Ana: there']);
	});

	test('a sent or cleared draft drops its pending words (the message is read instead)', () => {
		type('p1', 'Ana', 'see you');
		announcer.retain(new Set());
		vi.advanceTimersByTime(PAUSE_MS * 2);
		expect(spoken).toEqual([]);
		type('p1', 'Ana', 'next');
		vi.advanceTimersByTime(PAUSE_MS);
		expect(spoken).toEqual(['Ana: next']);
	});
});
