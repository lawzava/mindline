import { describe, expect, test, vi } from 'vitest';
import { routeP2PMessage, setSendToPeerFn } from '$lib/p2p/handlers';
import { messages } from '$lib/stores/messages';
import { currentRoomId } from '$lib/stores/room';
import type { Message } from '$lib/types/message';
import type { TypedP2PMessage } from '$lib/p2p/types';

vi.mock('$app/environment', () => ({ browser: false }));
vi.mock('svelte-sonner', () => ({ toast: vi.fn() }));

function history(roomId: string, count: number): Message[] {
	return Array.from({ length: count }, (_, index) => ({
		id: `message-${index}`,
		sender_id: 'alice',
		sender_name: 'Alice',
		message_type: 'Text',
		content: 'x'.repeat(20 * 1024),
		timestamp: index,
		room_id: roomId,
		status: 'sent',
		edited: false,
		edit_timestamp: null,
		original_content: null,
		reply_to: null,
		reactions: {},
		mentions: [],
		local_timestamp: index,
		delivery_attempts: 0,
		size_bytes: 20 * 1024
	}));
}

describe('history response backpressure', () => {
	test('awaits each send and preserves all 129 large history pages', async () => {
		const roomId = 'paged-history';
		currentRoomId.set(roomId);
		messages.setRoomMessages(roomId, history(roomId, 129));
		let finish!: () => void;
		const blocked = new Promise<void>((resolve) => (finish = resolve));
		const send = vi.fn(async (_peer: string, _message: TypedP2PMessage) => {});
		send.mockReturnValueOnce(blocked);
		setSendToPeerFn(send);
		routeP2PMessage({ type: 'sync-request', roomId, timestamp: 0 }, 'peer');
		await Promise.resolve();
		expect(send).toHaveBeenCalledTimes(1);
		finish();
		await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(129));
		expect(send.mock.calls.map(([, body]) => body.type)).toEqual(Array(129).fill('sync-response'));
	});

	test('a room switch cannot redirect a pending history response to its new connection', async () => {
		const roomId = 'old-room';
		currentRoomId.set(roomId);
		messages.setRoomMessages(roomId, history(roomId, 3));
		let finish!: () => void;
		const blocked = new Promise<void>((resolve) => (finish = resolve));
		const oldSend = vi.fn(async () => {});
		oldSend.mockReturnValueOnce(blocked);
		setSendToPeerFn(oldSend);
		routeP2PMessage({ type: 'sync-request', roomId, timestamp: 0 }, 'peer');
		const newSend = vi.fn(async () => {});
		setSendToPeerFn(newSend);
		finish();
		await vi.waitFor(() => expect(oldSend).toHaveBeenCalledTimes(3));
		expect(newSend).not.toHaveBeenCalled();
	});
});
