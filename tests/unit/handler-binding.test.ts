import { beforeEach, describe, expect, test, vi } from 'vitest';
import { routeP2PMessage, setSelfDeviceFn, setSendToPeerFn } from '$lib/p2p/handlers';
import { messages } from '$lib/stores/messages';
import { currentRoomId } from '$lib/stores/room';
import { user } from '$lib/stores/user';
import type { Message } from '$lib/types/message';
import type { TypedP2PMessage } from '$lib/p2p/types';

vi.mock('$app/environment', () => ({ browser: false }));
vi.mock('svelte-sonner', () => ({ toast: vi.fn() }));
vi.mock('$lib/storage/messages', () => ({ saveRoomMessages: vi.fn(async () => {}) }));

const SESSION_ROOM = 'room-a';
const OTHER_ROOM = 'room-b';
const PEER = 'peer-device';

function stored(id: string, roomId: string): Message {
	return {
		id,
		sender_id: 'me',
		sender_name: 'Me',
		message_type: 'Text',
		content: `secret in ${roomId}`,
		timestamp: 1,
		room_id: roomId,
		status: 'Sent',
		edited: false,
		edit_timestamp: null,
		original_content: null,
		reply_to: null,
		reactions: {},
		mentions: [],
		local_timestamp: 1,
		delivery_attempts: 0,
		size_bytes: 1,
		sender_device: PEER
	};
}

beforeEach(() => {
	messages.clearRoom(SESSION_ROOM);
	messages.clearRoom(OTHER_ROOM);
	messages.setRoomMessages(OTHER_ROOM, [stored('b-1', OTHER_ROOM)]);
	currentRoomId.set(SESSION_ROOM);
	setSendToPeerFn(vi.fn());
});

describe('incoming messages are bound to the session room', () => {
	test('a chat naming another room is dropped', () => {
		routeP2PMessage(
			{
				type: 'chat',
				roomId: OTHER_ROOM,
				content: 'injected',
				messageId: 'x-1',
				senderId: 'someone',
				senderName: 'Someone',
				timestamp: 2
			} as TypedP2PMessage,
			PEER
		);
		expect(messages.getRoomMessages(OTHER_ROOM).map((m) => m.id)).toEqual(['b-1']);
		expect(messages.getRoomMessages(SESSION_ROOM)).toEqual([]);
	});

	test('a sync request naming another room serves nothing', async () => {
		const send = vi.fn();
		setSendToPeerFn(send);
		routeP2PMessage({ type: 'sync-request', roomId: OTHER_ROOM, timestamp: 0 }, PEER);
		await Promise.resolve();
		expect(send).not.toHaveBeenCalled();
	});

	test('edits, deletes, and reactions naming another room are dropped', () => {
		for (const body of [
			{ type: 'edit', roomId: OTHER_ROOM, messageId: 'b-1', newContent: 'x', timestamp: 3 },
			{ type: 'delete', roomId: OTHER_ROOM, messageId: 'b-1', timestamp: 3 },
			{ type: 'reaction', roomId: OTHER_ROOM, messageId: 'b-1', reaction: '👍', action: 'add' }
		]) {
			routeP2PMessage(body as TypedP2PMessage, PEER);
		}
		expect(messages.getRoomMessages(OTHER_ROOM)).toEqual([stored('b-1', OTHER_ROOM)]);
	});

	test('a sync response naming another room is dropped', () => {
		routeP2PMessage(
			{
				type: 'sync-response',
				roomId: OTHER_ROOM,
				messages: [stored('x-2', OTHER_ROOM)],
				timestamp: 0
			} as TypedP2PMessage,
			PEER
		);
		expect(messages.getRoomMessages(OTHER_ROOM).map((m) => m.id)).toEqual(['b-1']);
	});
});

describe('peer messages carry the verified device, not the body identity', () => {
	test('a chat claiming my user id is attributed to the sending device', () => {
		routeP2PMessage(
			{
				type: 'chat',
				roomId: SESSION_ROOM,
				content: 'I am you',
				messageId: 'x-3',
				senderId: 'my-user-id',
				senderName: 'Me',
				timestamp: 4
			} as TypedP2PMessage,
			PEER
		);
		const [msg] = messages.getRoomMessages(SESSION_ROOM);
		expect(msg.sender_id).toBe(PEER);
		expect(msg.sender_device).toBe(PEER);
	});
});

describe('history sync cannot speak for this device', () => {
	test('an unknown synced message claiming my user id is dropped', () => {
		user.initialize('Me', 'my-user-id');
		const forged = { ...stored('x-4', SESSION_ROOM), sender_id: 'my-user-id' };
		const theirs = { ...stored('x-5', SESSION_ROOM), sender_id: 'peer-user' };
		routeP2PMessage(
			{
				type: 'sync-response',
				roomId: SESSION_ROOM,
				messages: [forged, theirs],
				timestamp: 0
			} as TypedP2PMessage,
			PEER
		);
		expect(messages.getRoomMessages(SESSION_ROOM).map((m) => m.id)).toEqual(['x-5']);
	});

	test('an unknown synced message attributed to my device is dropped', () => {
		setSelfDeviceFn(() => 'my-device');
		const byDevice = { ...stored('x-7', SESSION_ROOM), sender_id: 'my-device' };
		const bySenderDevice = {
			...stored('x-8', SESSION_ROOM),
			sender_id: 'someone',
			sender_device: 'my-device'
		};
		routeP2PMessage(
			{
				type: 'sync-response',
				roomId: SESSION_ROOM,
				messages: [byDevice, bySenderDevice],
				timestamp: 0
			} as TypedP2PMessage,
			PEER
		);
		expect(messages.getRoomMessages(SESSION_ROOM)).toEqual([]);
		setSelfDeviceFn(() => null);
	});

	test('synced messages are marked so they never count as newly arrived', () => {
		routeP2PMessage(
			{
				type: 'sync-response',
				roomId: SESSION_ROOM,
				messages: [{ ...stored('x-9', SESSION_ROOM), local_timestamp: 9e15 }],
				timestamp: 0
			} as TypedP2PMessage,
			PEER
		);
		expect(messages.getRoomMessages(SESSION_ROOM)[0].synced).toBe(true);
	});

	test('synced messages are filed under the session room', () => {
		routeP2PMessage(
			{
				type: 'sync-response',
				roomId: SESSION_ROOM,
				messages: [stored('x-6', OTHER_ROOM)],
				timestamp: 0
			} as TypedP2PMessage,
			PEER
		);
		expect(messages.getRoomMessages(SESSION_ROOM)[0].room_id).toBe(SESSION_ROOM);
	});
});

describe('media offers cannot replace existing attachments', () => {
	const offer = (transferId: string, messageId: string) =>
		({
			type: 'media-offer',
			transferId,
			messageId,
			kind: 'image',
			name: 'swap.jpg',
			mime: 'image/jpeg',
			size: 10,
			sha256: 'h',
			nonceSalt: 'AAAAAAAAAAA',
			senderId: 'mallory',
			senderName: 'Mallory',
			roomId: SESSION_ROOM,
			timestamp: 5
		}) as TypedP2PMessage;

	test('an offer reusing a stored message id or transfer id is dropped', () => {
		const photo = {
			...stored('photo-msg', SESSION_ROOM),
			message_type: 'Media' as const,
			attachment: {
				transferId: 'photo-transfer',
				kind: 'image' as const,
				name: 'a.jpg',
				mime: 'image/jpeg',
				size: 10,
				state: 'done' as const
			}
		};
		messages.setRoomMessages(SESSION_ROOM, [photo]);
		routeP2PMessage(offer('photo-transfer', 'fresh-msg'), 'mallory-device');
		routeP2PMessage(offer('fresh-transfer', 'photo-msg'), 'mallory-device');
		expect(messages.getRoomMessages(SESSION_ROOM)).toEqual([photo]);
	});
});

describe('replies', () => {
	test('a chat that answers another message keeps the pointer; junk is ignored', () => {
		const chat = (messageId: string, replyTo: unknown) =>
			({
				type: 'chat',
				roomId: SESSION_ROOM,
				content: 'answer',
				messageId,
				senderId: 'x',
				senderName: 'X',
				timestamp: 7,
				replyTo
			}) as TypedP2PMessage;
		routeP2PMessage(chat('r1', 'question-id'), PEER);
		routeP2PMessage(chat('r2', { evil: true }), PEER);
		routeP2PMessage(chat('r3', 'x'.repeat(500)), PEER);
		expect(messages.getMessage(SESSION_ROOM, 'r1')?.reply_to).toBe('question-id');
		expect(messages.getMessage(SESSION_ROOM, 'r2')?.reply_to).toBeNull();
		expect(messages.getMessage(SESSION_ROOM, 'r3')?.reply_to).toBeNull();
	});
});
