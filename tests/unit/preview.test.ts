import { describe, expect, test } from 'vitest';
import { previewOf } from '$lib/preview';

const m = (sender_id: string, extra: Record<string, unknown> = {}) => ({
	sender_id,
	sender_name: sender_id === 'me' ? 'Me' : 'Bob',
	content: 'see you at 9',
	message_type: 'Text',
	...extra
});

describe('previewOf', () => {
	test('names the sender of the latest message, or says it was you', () => {
		expect(previewOf([m('bob', { content: 'first' }), m('bob')], 'me')).toBe('Bob: see you at 9');
		expect(previewOf([m('bob'), m('me', { content: 'ok' })], 'me')).toBe('You: ok');
	});

	test('skips deleted messages and describes attachments without their bytes', () => {
		expect(
			previewOf(
				[m('bob'), m('bob', { message_type: 'Deleted', content: '[Message deleted]' })],
				'me'
			)
		).toBe('Bob: see you at 9');
		expect(
			previewOf(
				[m('bob', { message_type: 'Media', attachment: { kind: 'image', name: 'x.jpg' } })],
				'me'
			)
		).toBe('Bob sent a photo');
	});

	test('collapses whitespace and is empty for a room with nothing said', () => {
		expect(previewOf([m('bob', { content: 'a\n\n  b' })], 'me')).toBe('Bob: a b');
		expect(previewOf([], 'me')).toBeNull();
	});
});
