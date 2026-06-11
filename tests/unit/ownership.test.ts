import { describe, expect, it } from 'vitest';
import { remotePeerOwnsMessage } from '$lib/p2p/ownership';

describe('remotePeerOwnsMessage (PROTOCOL.md §3.7 — fail closed)', () => {
	it('authorizes the envelope-verified owner device', () => {
		expect(remotePeerOwnsMessage({ sender_device: 'dev-a' }, 'dev-a')).toBe(true);
	});

	it('rejects a different device', () => {
		expect(remotePeerOwnsMessage({ sender_device: 'dev-a' }, 'dev-b')).toBe(false);
	});

	it('rejects when sender_device is absent (legacy message, no senderId fallback)', () => {
		expect(remotePeerOwnsMessage({}, 'dev-a')).toBe(false);
		expect(remotePeerOwnsMessage({ sender_device: '' }, 'dev-a')).toBe(false);
	});
});
