import { beforeEach, describe, expect, test } from 'vitest';
import { get } from 'svelte/store';
import { delivery, fullyDeliveredMessages } from '$lib/stores/delivery';

beforeEach(() => delivery.clear());

describe('message delivery acknowledgments', () => {
	test('an unrelated peer disconnect does not change messages in any room', () => {
		delivery.trackMessage('first', 'room-a', ['alice', 'bob']);
		delivery.trackMessage('second', 'room-b', ['carol']);
		delivery.recordDelivery('first', 'alice');
		delivery.handlePeerDisconnect('unrelated');

		expect(delivery.getDeliveryStatus('first')).toEqual({ delivered: 1, total: 2 });
		expect(delivery.getDeliveryStatus('second')).toEqual({ delivered: 0, total: 1 });
		expect(get(fullyDeliveredMessages)).toEqual([]);
	});

	test('repeated disconnects retain the original recipients until they acknowledge', () => {
		delivery.trackMessage('message', 'room', ['alice', 'bob']);
		delivery.recordDelivery('message', 'alice');
		delivery.handlePeerDisconnect('bob');
		delivery.handlePeerDisconnect('bob');
		delivery.handlePeerDisconnect('bob');

		expect(delivery.getDeliveryStatus('message')).toEqual({ delivered: 1, total: 2 });
		expect(get(fullyDeliveredMessages)).toEqual([]);

		// A delayed acknowledgment after reconnection still proves delivery.
		delivery.recordDelivery('message', 'bob');
		expect(delivery.getDeliveryStatus('message')).toEqual({ delivered: 2, total: 2 });
		expect(get(fullyDeliveredMessages)).toEqual(['message']);
	});

	test('acknowledgments from unexpected peers cannot claim full delivery', () => {
		delivery.trackMessage('message', 'room', ['alice']);
		delivery.recordDelivery('message', 'unexpected');

		expect(delivery.getDeliveryStatus('message')).toEqual({ delivered: 0, total: 1 });
		expect(get(fullyDeliveredMessages)).toEqual([]);
		delivery.recordDelivery('message', 'alice');
		delivery.recordDelivery('message', 'alice');
		expect(delivery.getDeliveryStatus('message')).toEqual({ delivered: 1, total: 1 });
		expect(get(fullyDeliveredMessages)).toEqual(['message']);
	});

	test('recipient membership belongs to each message even within the same room', () => {
		delivery.trackMessage('first', 'room', ['alice']);
		delivery.trackMessage('second', 'room', ['bob']);
		delivery.recordDelivery('first', 'bob');
		delivery.recordDelivery('second', 'alice');

		expect(delivery.getDeliveryStatus('first')).toEqual({ delivered: 0, total: 1 });
		expect(delivery.getDeliveryStatus('second')).toEqual({ delivered: 0, total: 1 });
	});

	test('snapshots unique original recipients instead of a mutable connection list', () => {
		const connectedPeers = ['alice', 'alice'];
		delivery.trackMessage('message', 'room', connectedPeers);
		connectedPeers.push('bob');
		delivery.recordDelivery('message', 'bob');
		delivery.recordDelivery('message', 'alice');

		expect(delivery.getDeliveryStatus('message')).toEqual({ delivered: 1, total: 1 });
		expect(get(fullyDeliveredMessages)).toEqual(['message']);
	});

	test('a message with no recipients remains local after unrelated acknowledgments', () => {
		delivery.trackMessage('local', 'room', []);
		delivery.recordDelivery('local', 'later-peer');
		delivery.recordDelivery('unknown', 'later-peer');

		expect(delivery.getDeliveryStatus('local')).toEqual({ delivered: 0, total: 0 });
		expect(delivery.getDeliveryStatus('unknown')).toBeNull();
		expect(get(fullyDeliveredMessages)).toEqual([]);
	});
});
