import { beforeEach, describe, expect, test, vi } from 'vitest';
import { routeP2PMessage, setSendToPeerFn, setSelfDeviceFn } from '$lib/p2p/handlers';
import { messages } from '$lib/stores/messages';
import { currentRoomId } from '$lib/stores/room';
import { user } from '$lib/stores/user';
import { createDeviceIdentity, type DeviceIdentity } from '$lib/crypto/identity';
import { signOrigin } from '$lib/crypto/origin';
import type { Message } from '$lib/types/message';
import type { TypedP2PMessage } from '$lib/p2p/types';

vi.mock('$app/environment', () => ({ browser: false }));
vi.mock('svelte-sonner', () => ({ toast: vi.fn() }));
vi.mock('$lib/storage/messages', () => ({ saveRoomMessages: vi.fn(async () => {}) }));

const ROOM = 'room-signed';
let alice: DeviceIdentity;

function base(id: string, device: string, extra: Partial<Message> = {}): Message {
	return {
		id,
		sender_id: device,
		sender_name: 'Alice',
		message_type: 'Text',
		content: `text ${id}`,
		timestamp: 1000,
		room_id: ROOM,
		status: 'Sent',
		edited: false,
		edit_timestamp: null,
		original_content: null,
		reply_to: null,
		reactions: {},
		mentions: [],
		local_timestamp: 1000,
		delivery_attempts: 0,
		size_bytes: 1,
		sender_device: device,
		...extra
	};
}

async function signed(m: Message): Promise<Message> {
	return { ...m, origin: await signOrigin(alice, ROOM, m) };
}

const sync = (list: Message[], from = 'bob-device') =>
	routeP2PMessage(
		{ type: 'sync-response', roomId: ROOM, messages: list, timestamp: 0 } as TypedP2PMessage,
		from
	);

beforeEach(async () => {
	alice ??= await createDeviceIdentity();
	messages.clearRoom(ROOM);
	currentRoomId.set(ROOM);
	user.initialize('Me', 'me');
	setSelfDeviceFn(() => 'my-device');
	setSendToPeerFn(vi.fn());
});

const settle = () => new Promise((r) => setTimeout(r, 50));

describe('history sync verifies author signatures', () => {
	test('a signed message served by another member is accepted as verified', async () => {
		sync([await signed(base('s1', alice.deviceId))]);
		await settle();
		const got = messages.getMessage(ROOM, 's1');
		expect(got?.unsigned).toBeFalsy();
		expect(got?.origin).toBeTruthy();
	});

	test('a forged or altered signed message is dropped', async () => {
		const good = await signed(base('s2', alice.deviceId));
		sync([{ ...good, content: 'words Alice never wrote' }]);
		await settle();
		expect(messages.getMessage(ROOM, 's2')).toBeUndefined();
	});

	test('an unsigned message is kept but marked as an unverified copy', async () => {
		sync([base('s3', alice.deviceId)]);
		await settle();
		expect(messages.getMessage(ROOM, 's3')?.unsigned).toBe(true);
	});

	test('a message dated far in the future is refused', async () => {
		sync([await signed(base('s4', alice.deviceId, { timestamp: Date.now() + 3_600_000 }))]);
		await settle();
		expect(messages.getMessage(ROOM, 's4')).toBeUndefined();
	});

	test('a deletion only applies through sync when the author signed it', async () => {
		const live = await signed(base('s5', alice.deviceId));
		messages.setRoomMessages(ROOM, [live]);
		const deletedState = base('s5', alice.deviceId, {
			message_type: 'Deleted',
			content: '[Message deleted]'
		});
		sync([deletedState]);
		await settle();
		expect(messages.getMessage(ROOM, 's5')?.message_type).toBe('Text');

		sync([await signed(deletedState)]);
		await settle();
		expect(messages.getMessage(ROOM, 's5')?.message_type).toBe('Deleted');
	});

	test('a newer signed edit arriving through sync is applied', async () => {
		messages.setRoomMessages(ROOM, [await signed(base('s6', alice.deviceId))]);
		const edited = base('s6', alice.deviceId, {
			content: 'fixed typo',
			edited: true,
			edit_timestamp: 2000
		});
		sync([await signed(edited)]);
		await settle();
		expect(messages.getMessage(ROOM, 's6')?.content).toBe('fixed typo');
	});
});

describe('live chat keeps the author signature', () => {
	test('a chat body with a valid origin stores it; an invalid one is not stored', async () => {
		const m = base('c1', alice.deviceId, { content: 'hi' });
		const origin = await signOrigin(alice, ROOM, m);
		routeP2PMessage(
			{
				type: 'chat',
				roomId: ROOM,
				content: 'hi',
				messageId: 'c1',
				senderId: 'x',
				senderName: 'Alice',
				timestamp: 1000,
				origin
			} as TypedP2PMessage,
			alice.deviceId
		);
		await settle();
		expect(messages.getMessage(ROOM, 'c1')?.origin).toEqual(origin);

		routeP2PMessage(
			{
				type: 'chat',
				roomId: ROOM,
				content: 'changed',
				messageId: 'c2',
				senderId: 'x',
				senderName: 'Alice',
				timestamp: 1000,
				origin
			} as TypedP2PMessage,
			alice.deviceId
		);
		await settle();
		expect(messages.getMessage(ROOM, 'c2')?.content).toBe('changed');
		expect(messages.getMessage(ROOM, 'c2')?.origin).toBeUndefined();
	});
});
