import { describe, expect, test } from 'vitest';
import { unseenSince } from '$lib/attention';

const msg = (sender_id: string, local_timestamp: number, message_type = 'Text') => ({
	sender_id,
	sender_name: sender_id,
	local_timestamp,
	message_type
});

describe('unseenSince', () => {
	test('counts peer messages that arrived after the tab was hidden', () => {
		const list = [msg('bob', 5), msg('me', 20), msg('bob', 21), msg('carol', 30, 'Media')];
		const result = unseenSince(list, 'me', 10);
		expect(result.count).toBe(2);
		expect(result.latestSender).toBe('carol');
	});

	test('ignores synced history whatever timestamp its server claims', () => {
		const list = [{ ...msg('bob', 9e15), synced: true }];
		expect(unseenSince(list, 'me', 10).count).toBe(0);
	});

	test('ignores deleted messages and history that predates hiding', () => {
		const list = [msg('bob', 5), msg('bob', 25, 'Deleted')];
		expect(unseenSince(list, 'me', 10)).toEqual({ count: 0, latestSender: null });
	});
});
