import { describe, expect, test } from 'vitest';
import { createDeviceIdentity } from '$lib/crypto/identity';
import { originOf, signOrigin, verifyOrigin } from '$lib/crypto/origin';
import type { Message } from '$lib/types/message';

const ROOM = 'room-o';

function msg(device: string, extra: Partial<Message> = {}): Message {
	return {
		id: 'm1',
		sender_id: device,
		sender_name: 'A',
		message_type: 'Text',
		content: 'hello',
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
		size_bytes: 5,
		sender_device: device,
		...extra
	};
}

describe('message origin signatures', () => {
	test('the author signature verifies for the exact stored state', async () => {
		const me = await createDeviceIdentity();
		const m = msg(me.deviceId);
		const origin = await signOrigin(me, ROOM, m);
		expect(await verifyOrigin(ROOM, { ...m, origin })).toBe(true);
	});

	test('any change to content, time, id, device, or room breaks it', async () => {
		const me = await createDeviceIdentity();
		const m = msg(me.deviceId);
		const origin = await signOrigin(me, ROOM, m);
		for (const changed of [
			{ ...m, content: 'hullo' },
			{ ...m, timestamp: 999 },
			{ ...m, id: 'm2' },
			{ ...m, edited: true, edit_timestamp: 5 }
		]) {
			expect(await verifyOrigin(ROOM, { ...changed, origin })).toBe(false);
		}
		expect(await verifyOrigin('other-room', { ...m, origin })).toBe(false);
	});

	test("a signature cannot be moved to another member's device", async () => {
		const me = await createDeviceIdentity();
		const other = await createDeviceIdentity();
		const origin = await signOrigin(me, ROOM, msg(me.deviceId));
		expect(await verifyOrigin(ROOM, { ...msg(other.deviceId), origin })).toBe(false);
	});

	test('deletion is its own signed state', async () => {
		const me = await createDeviceIdentity();
		const live = msg(me.deviceId);
		const deleted = { ...live, message_type: 'Deleted', content: '[Message deleted]' };
		const origin = await signOrigin(me, ROOM, deleted);
		expect(await verifyOrigin(ROOM, { ...deleted, origin })).toBe(true);
		expect(await verifyOrigin(ROOM, { ...live, origin })).toBe(false);
		expect(originOf(ROOM, deleted).kind).toBe('deleted');
	});

	test('messages without a signature do not verify', async () => {
		expect(await verifyOrigin(ROOM, msg('x'))).toBe(false);
	});
});
