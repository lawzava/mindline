import { beforeEach, describe, expect, test, vi } from 'vitest';
import { routeP2PMessage, setSendToPeerFn } from '$lib/p2p/handlers';
import { messages } from '$lib/stores/messages';
import { currentRoomId } from '$lib/stores/room';
import { delivery } from '$lib/stores/delivery';
import { user } from '$lib/stores/user';
import type { Message } from '$lib/types/message';
import type { TypedP2PMessage } from '$lib/p2p/types';

vi.mock('$app/environment', () => ({ browser: false }));
vi.mock('svelte-sonner', () => ({ toast: vi.fn() }));
vi.mock('$lib/storage/messages', () => ({ saveRoomMessages: vi.fn(async () => {}) }));

const ROOM = 'room-d';

function mine(id: string, status: string): Message {
	return {
		id,
		sender_id: 'me',
		sender_name: 'Me',
		message_type: 'Text',
		content: 'hi',
		timestamp: 1,
		room_id: ROOM,
		status,
		edited: false,
		edit_timestamp: null,
		original_content: null,
		reply_to: null,
		reactions: {},
		mentions: [],
		local_timestamp: 1,
		delivery_attempts: 0,
		size_bytes: 2,
		sender_device: 'my-device'
	};
}

const ack = (messageId: string) =>
	({
		type: 'delivery-ack',
		messageId,
		roomId: ROOM,
		peerId: 'x',
		timestamp: 2
	}) as TypedP2PMessage;

beforeEach(() => {
	delivery.clear();
	messages.clearRoom(ROOM);
	currentRoomId.set(ROOM);
	user.initialize('Me', 'me');
	setSendToPeerFn(vi.fn());
});

describe('delivery status survives reloads', () => {
	test('a message acknowledged by every intended peer is stored as Delivered', () => {
		messages.setRoomMessages(ROOM, [mine('m1', 'Sent')]);
		delivery.trackMessage('m1', ROOM, ['bob', 'carol']);
		routeP2PMessage(ack('m1'), 'bob');
		expect(messages.getMessage(ROOM, 'm1')?.status).toBe('Sent');
		routeP2PMessage(ack('m1'), 'carol');
		expect(messages.getMessage(ROOM, 'm1')?.status).toBe('Delivered');
	});

	test('a local message becomes Delivered when a member acknowledges it later', () => {
		messages.setRoomMessages(ROOM, [mine('m2', 'Local')]);
		routeP2PMessage(ack('m2'), 'bob');
		expect(messages.getMessage(ROOM, 'm2')?.status).toBe('Delivered');
	});

	test("acks never change other people's messages", () => {
		messages.setRoomMessages(ROOM, [{ ...mine('m3', 'Sent'), sender_id: 'bob' }]);
		routeP2PMessage(ack('m3'), 'carol');
		expect(messages.getMessage(ROOM, 'm3')?.status).toBe('Sent');
	});

	test("history synced from a member acknowledges that member's own messages", () => {
		const send = vi.fn();
		setSendToPeerFn(send);
		const theirs = { ...mine('m4', 'Local'), sender_id: 'bob', sender_device: 'bob-device' };
		const relayed = { ...mine('m5', 'Sent'), sender_id: 'carol', sender_device: 'carol-device' };
		routeP2PMessage(
			{
				type: 'sync-response',
				roomId: ROOM,
				messages: [theirs, relayed],
				timestamp: 0
			} as TypedP2PMessage,
			'bob-device'
		);
		const acked = send.mock.calls.map(([, body]) => body.messageId);
		expect(acked).toEqual(['m4']);
	});
});
