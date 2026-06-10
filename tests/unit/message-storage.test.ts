import { beforeEach, describe, expect, test } from 'vitest';
import { loadRoomMessages, saveRoomMessages } from '$lib/storage/messages';
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

class MemoryStorage implements Storage {
	private map = new Map<string, string>();
	get length() {
		return this.map.size;
	}
	clear() {
		this.map.clear();
	}
	getItem(k: string) {
		return this.map.get(k) ?? null;
	}
	key(i: number) {
		return [...this.map.keys()][i] ?? null;
	}
	removeItem(k: string) {
		this.map.delete(k);
	}
	setItem(k: string, v: string) {
		this.map.set(k, v);
	}
}

beforeEach(() => {
	globalThis.localStorage = new MemoryStorage();
});

describe('message storage', () => {
	test('round-trips messages sorted by timestamp', () => {
		const m1 = makeMessage({ timestamp: 200 });
		const m2 = makeMessage({ timestamp: 100 });
		saveRoomMessages('room-1', [m1, m2]);
		const loaded = loadRoomMessages('room-1');
		expect(loaded.map((m) => m.id)).toEqual([m2.id, m1.id]);
	});

	test('returns empty array for unknown room', () => {
		expect(loadRoomMessages('nope')).toEqual([]);
	});

	test('merge-on-save: messages from another tab survive', () => {
		const mine = makeMessage({ id: 'mine', timestamp: 100 });
		const theirs = makeMessage({ id: 'theirs', timestamp: 50 });
		saveRoomMessages('room-1', [theirs]); // "other tab" wrote first
		saveRoomMessages('room-1', [mine]); // this tab saves without theirs in memory
		const loaded = loadRoomMessages('room-1');
		expect(loaded.map((m) => m.id)).toEqual(['theirs', 'mine']);
	});

	test('merge-on-save: in-memory edits and deletes take precedence', () => {
		const original = makeMessage({ id: 'm1', content: 'original' });
		saveRoomMessages('room-1', [original]);
		const deleted = { ...original, content: '[Message deleted]', message_type: 'Deleted' };
		saveRoomMessages('room-1', [deleted]);
		const loaded = loadRoomMessages('room-1');
		expect(loaded).toHaveLength(1);
		expect(loaded[0].message_type).toBe('Deleted');
	});

	test('reads legacy Rust RoomMessageState format', () => {
		const legacy = {
			room_id: 'room-1',
			messages: [makeMessage({ id: 'legacy-1' })],
			message_ids: ['legacy-1'],
			last_sync: 0,
			unread_count: 0,
			last_read_timestamp: 0,
			draft_messages: {},
			typing_users: [],
			pending_messages: [],
			total_messages: 1,
			message_cache_size: 100
		};
		localStorage.setItem('chatHistory_room-1', JSON.stringify(legacy));
		const loaded = loadRoomMessages('room-1');
		expect(loaded).toHaveLength(1);
		expect(loaded[0].id).toBe('legacy-1');
	});

	test('clears corrupted data instead of throwing', () => {
		localStorage.setItem('chatHistory_room-1', '{not json');
		expect(loadRoomMessages('room-1')).toEqual([]);
		expect(localStorage.getItem('chatHistory_room-1')).toBeNull();
	});

	test('caps stored history at 500 messages, dropping oldest', () => {
		const many = Array.from({ length: 520 }, (_, i) =>
			makeMessage({ id: `m${i}`, timestamp: i })
		);
		saveRoomMessages('room-1', many);
		const loaded = loadRoomMessages('room-1');
		expect(loaded).toHaveLength(500);
		expect(loaded[0].id).toBe('m20');
	});
});
