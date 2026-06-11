import { describe, expect, test } from 'vitest';
import { paginateSyncMessages } from '$lib/p2p/sync';
import type { Message } from '$lib/types/message';

function makeMessage(overrides: Partial<Message> = {}): Message {
	return {
		id: crypto.randomUUID(),
		sender_id: 'alice',
		sender_name: 'Alice',
		message_type: 'Text',
		content: 'hello',
		timestamp: Date.now(),
		room_id: 'room-1',
		status: 'sent',
		edited: false,
		edit_timestamp: null,
		original_content: null,
		reply_to: null,
		reactions: {},
		mentions: [],
		local_timestamp: Date.now(),
		delivery_attempts: 0,
		size_bytes: 5,
		...overrides
	};
}

describe('paginateSyncMessages (PROTOCOL.md §3.5)', () => {
	test('empty history yields no pages', () => {
		expect(paginateSyncMessages([])).toEqual([]);
	});

	test('caps pages at 40 messages', () => {
		const msgs = Array.from({ length: 95 }, (_, i) => makeMessage({ id: `m${i}` }));
		const pages = paginateSyncMessages(msgs);
		expect(pages.map((p) => p.length)).toEqual([40, 40, 15]);
	});

	test('caps pages at 32KB serialized plaintext without dropping messages', () => {
		const big = 'x'.repeat(10 * 1024);
		const msgs = Array.from({ length: 8 }, (_, i) => makeMessage({ id: `m${i}`, content: big }));
		const pages = paginateSyncMessages(msgs);
		expect(pages.length).toBeGreaterThan(2);
		for (const page of pages) {
			const bytes = new TextEncoder().encode(JSON.stringify(page)).length;
			expect(bytes).toBeLessThanOrEqual(33 * 1024); // page + JSON overhead
		}
		expect(pages.flat().map((m) => m.id)).toEqual(msgs.map((m) => m.id));
	});

	test('preserves message order across page boundaries', () => {
		const msgs = Array.from({ length: 85 }, (_, i) => makeMessage({ id: `m${i}` }));
		expect(
			paginateSyncMessages(msgs)
				.flat()
				.map((m) => m.id)
		).toEqual(msgs.map((m) => m.id));
	});

	test('an oversized message is excluded so no page can break the cap', () => {
		// A single >32KB item would otherwise ship alone and blow past the
		// DataChannel floor after envelope overhead (§3.5).
		const huge = makeMessage({ id: 'huge', content: 'y'.repeat(40 * 1024) });
		const normal = makeMessage({ id: 'normal' });
		const pages = paginateSyncMessages([huge, normal]);
		expect(pages).toEqual([[normal]]);
	});
});
