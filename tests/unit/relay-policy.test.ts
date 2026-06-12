import { describe, expect, test } from 'vitest';
import { MAX_RELAY_WIRE_BYTES, relayEligible } from '$lib/p2p/connection';

describe('relayEligible (PROTOCOL.md §3.6)', () => {
	const allowed = ['chat', 'edit', 'delete', 'reaction', 'delivery-ack', 'user-connected'];
	const forbidden = [
		'typing',
		'sync-request',
		'sync-response',
		'media-offer',
		'media-accept',
		'media-abort',
		// §1.4/§3.6: a relayed grant would hand the operator ciphertext a
		// leaked link decrypts — carrier restriction is the security boundary.
		'rekey-grant',
		'rekey-request'
	];

	test.each(allowed)('%s may relay', (type) => {
		expect(relayEligible(type, 1024)).toBe(true);
	});

	test.each(forbidden)('%s never relays', (type) => {
		expect(relayEligible(type, 16)).toBe(false);
	});

	test('oversized frames never relay (server maxPayload kills the socket)', () => {
		expect(relayEligible('chat', MAX_RELAY_WIRE_BYTES + 1)).toBe(false);
		expect(relayEligible('chat', MAX_RELAY_WIRE_BYTES)).toBe(true);
	});

	test('the guard leaves headroom under the server 16 KB frame cap', () => {
		// Relay frames are wrapped as {type:'relay',targetId,data:{envelope}}
		// before hitting the server's 16 KiB maxPayload.
		expect(MAX_RELAY_WIRE_BYTES).toBeLessThanOrEqual(15 * 1024);
	});
});
