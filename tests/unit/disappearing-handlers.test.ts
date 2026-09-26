import { beforeEach, describe, expect, test, vi } from 'vitest';
import { routeP2PMessage, setSendToPeerFn } from '$lib/p2p/handlers';
import { messages } from '$lib/stores/messages';
import { currentRoomId } from '$lib/stores/room';
import type { Message } from '$lib/types/message';
import type { SyncResponseMessage, TypedP2PMessage } from '$lib/p2p/types';
import { createDeviceIdentity } from '$lib/crypto/identity';
import { signOrigin } from '$lib/crypto/origin';

vi.mock('$app/environment', () => ({ browser: false }));
vi.mock('svelte-sonner', () => ({ toast: vi.fn() }));
vi.mock('$lib/storage/messages', () => ({ saveRoomMessages: vi.fn(async () => {}) }));

const ROOM = 'room-d';
const PEER = 'peer-device';
const HOUR = 3_600_000;

function chat(id: string, extra: Record<string, unknown> = {}): TypedP2PMessage {
	return {
		type: 'chat',
		roomId: ROOM,
		content: 'hello',
		messageId: id,
		senderId: 'peer-user',
		senderName: 'Peer',
		timestamp: Date.now(),
		...extra
	} as TypedP2PMessage;
}

function held(id: string, extra: Partial<Message> = {}): Message {
	return {
		id,
		sender_id: 'peer-user',
		sender_name: 'Peer',
		message_type: 'Text',
		content: 'hello',
		timestamp: Date.now(),
		room_id: ROOM,
		status: 'Sent',
		edited: false,
		edit_timestamp: null,
		original_content: null,
		reply_to: null,
		reactions: {},
		mentions: [],
		local_timestamp: Date.now(),
		delivery_attempts: 0,
		size_bytes: 5,
		sender_device: PEER,
		...extra
	};
}

const ids = () => messages.getRoomMessages(ROOM).map((m) => m.id);

beforeEach(() => {
	messages.clearRoom(ROOM);
	currentRoomId.set(ROOM);
	setSendToPeerFn(vi.fn());
});

describe('live messages with a lifetime', () => {
	test('the lifetime is stored with the message', () => {
		routeP2PMessage(chat('a', { ttl: HOUR }), PEER);
		expect(messages.getMessage(ROOM, 'a')?.ttl).toBe(HOUR);
	});

	test('a message already past its lifetime is not stored', () => {
		routeP2PMessage(chat('b', { ttl: HOUR, timestamp: Date.now() - 2 * HOUR }), PEER);
		expect(ids()).toEqual([]);
	});

	test('a malformed lifetime is refused rather than kept forever', () => {
		routeP2PMessage(chat('c', { ttl: 5 }), PEER);
		routeP2PMessage(chat('d', { ttl: 'forever' }), PEER);
		expect(ids()).toEqual([]);
	});

	test('a timer change arrives as a timer event', () => {
		routeP2PMessage(chat('t', { timer: HOUR }), PEER);
		const t = messages.getMessage(ROOM, 't');
		expect(t?.timer).toBe(HOUR);
		expect(t?.message_type).toBe('Timer');
		routeP2PMessage(chat('u', { timer: -1 }), PEER);
		expect(messages.getMessage(ROOM, 'u')).toBeUndefined();
	});

	test('a timer event cannot itself expire', () => {
		routeP2PMessage(chat('tt', { timer: HOUR, ttl: HOUR }), PEER);
		expect(ids()).toEqual([]);
	});

	test('a live message dated far ahead is refused (it would pin the timer)', () => {
		routeP2PMessage(chat('f', { timer: 0, timestamp: Date.now() + 60 * 60_000 }), PEER);
		expect(ids()).toEqual([]);
	});

	test('a live timer event dated far back is refused', () => {
		routeP2PMessage(chat('back', { timer: HOUR, timestamp: Date.now() - 30 * 24 * HOUR }), PEER);
		expect(ids()).toEqual([]);
	});

	test('a live message whose time is not a number is refused', () => {
		routeP2PMessage(chat('s', { timer: 0, timestamp: '99999999999999' }), PEER);
		routeP2PMessage(chat('s2', { ttl: HOUR, timestamp: 1.5 }), PEER);
		expect(ids()).toEqual([]);
	});

	test('a media offer carries its lifetime onto the message', () => {
		routeP2PMessage(
			{
				type: 'media-offer',
				transferId: 'tr-1',
				messageId: 'media-1',
				kind: 'image',
				name: 'p.jpg',
				mime: 'image/jpeg',
				size: 10,
				sha256: 'h',
				nonceSalt: 'AAAAAAAAAAA',
				senderId: 'peer-user',
				senderName: 'Peer',
				roomId: ROOM,
				timestamp: Date.now(),
				ttl: HOUR
			} as TypedP2PMessage,
			PEER
		);
		expect(messages.getMessage(ROOM, 'media-1')?.ttl).toBe(HOUR);
	});
});

describe('history sync and expiry', () => {
	test('expired messages are not served', async () => {
		messages.setRoomMessages(ROOM, [
			held('old', { timestamp: Date.now() - 2 * HOUR, ttl: HOUR }),
			held('new', { ttl: HOUR })
		]);
		const send = vi.fn();
		setSendToPeerFn(send);
		routeP2PMessage({ type: 'sync-request', roomId: ROOM, timestamp: 0 }, PEER);
		await vi.waitFor(() => expect(send).toHaveBeenCalled());
		const served = send.mock.calls.flatMap(
			([, body]) => (body as SyncResponseMessage).messages
		) as Message[];
		expect(served.map((m) => m.id)).toEqual(['new']);
	});

	test('a copy with its lifetime stripped still expires under the timer in force', async () => {
		const author = await createDeviceIdentity();
		const t0 = Date.now() - 3 * HOUR;
		const timerEvent = held('t-on', {
			message_type: 'Timer',
			content: 'Messages now disappear after 1 hour.',
			timer: HOUR,
			timestamp: t0,
			sender_device: author.deviceId,
			sender_id: author.deviceId
		});
		timerEvent.origin = await signOrigin(author, ROOM, timerEvent);
		// Sent while the timer was on, two hours ago; served with ttl and origin gone.
		const stripped = held('stripped', { timestamp: t0 + HOUR });
		// Said before the timer was on: stays. Also marks the end of the page.
		const before = held('before', { timestamp: t0 - 1 });
		routeP2PMessage(
			{
				type: 'sync-response',
				roomId: ROOM,
				messages: [timerEvent, stripped, before],
				timestamp: 0
			} as TypedP2PMessage,
			PEER
		);
		await vi.waitFor(() => expect(ids()).toContain('before'));
		expect(ids()).toEqual(['t-on', 'before']);
		// Same when the timer event is already held and the copy arrives alone.
		const marker = held('marker', { timestamp: t0 - 2 });
		routeP2PMessage(
			{
				type: 'sync-response',
				roomId: ROOM,
				messages: [stripped, marker],
				timestamp: 0
			} as TypedP2PMessage,
			PEER
		);
		await vi.waitFor(() => expect(ids()).toContain('marker'));
		expect(ids()).toEqual(['t-on', 'before', 'marker']);
	});

	test('an unsigned timer event from history is not taken in', async () => {
		const marker = held('marker2', {});
		routeP2PMessage(
			{
				type: 'sync-response',
				roomId: ROOM,
				messages: [held('dressed', { timer: 0, message_type: 'Timer' }), marker],
				timestamp: 0
			} as TypedP2PMessage,
			PEER
		);
		await vi.waitFor(() => expect(ids()).toContain('marker2'));
		expect(ids()).toEqual(['marker2']);
	});

	test('expired or malformed copies from a member are not taken in', () => {
		routeP2PMessage(
			{
				type: 'sync-response',
				roomId: ROOM,
				messages: [
					held('old', { timestamp: Date.now() - 2 * HOUR, ttl: HOUR }),
					held('bad', { ttl: 1 }),
					held('ok', { ttl: HOUR })
				],
				timestamp: 0
			} as TypedP2PMessage,
			PEER
		);
		expect(ids()).toEqual(['ok']);
	});
});
