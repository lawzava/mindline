import { describe, expect, test, vi } from 'vitest';
// Plain ESM module shared with the signaling server (signaling-server.js), which
// holds the Cloudflare TURN secret and mints credentials server-side.
import { generateTurnIceServers } from '../../turn-credentials.js';

const CF_ICE_SERVERS = [
	{ urls: ['stun:stun.cloudflare.com:3478'] },
	{
		urls: ['turns:turn.cloudflare.com:5349?transport=tcp'],
		username: 'u',
		credential: 'c'
	}
];

function jsonResponse(body: unknown, status = 201): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

describe('generateTurnIceServers', () => {
	test('returns [] when the token id or api token is missing (unconfigured deploy)', async () => {
		const fetchFn = vi.fn();
		expect(await generateTurnIceServers(undefined, 'token', { fetchFn })).toEqual([]);
		expect(await generateTurnIceServers('id', undefined, { fetchFn })).toEqual([]);
		expect(await generateTurnIceServers('', '', { fetchFn })).toEqual([]);
		expect(fetchFn).not.toHaveBeenCalled();
	});

	test('returns the iceServers array from a 201 response', async () => {
		const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ iceServers: CF_ICE_SERVERS }));
		const result = await generateTurnIceServers('key-id', 'api-token', { fetchFn });
		expect(result).toEqual(CF_ICE_SERVERS);
	});

	test('calls the Cloudflare generate-ice-servers endpoint with bearer auth and ttl', async () => {
		const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ iceServers: CF_ICE_SERVERS }));
		await generateTurnIceServers('key-id', 'api-token', { fetchFn, ttl: 3600 });

		expect(fetchFn).toHaveBeenCalledTimes(1);
		const [url, init] = fetchFn.mock.calls[0];
		expect(url).toBe(
			'https://rtc.live.cloudflare.com/v1/turn/keys/key-id/credentials/generate-ice-servers'
		);
		expect(init.method).toBe('POST');
		expect(init.headers['Authorization']).toBe('Bearer api-token');
		expect(init.headers['Content-Type']).toBe('application/json');
		expect(JSON.parse(init.body)).toEqual({ ttl: 3600 });
	});

	test('returns [] on a non-ok response (bad creds) instead of throwing', async () => {
		const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ error: 'unauthorized' }, 401));
		expect(await generateTurnIceServers('key-id', 'bad-token', { fetchFn })).toEqual([]);
	});

	test('returns [] when the fetch throws (network error) instead of propagating', async () => {
		const fetchFn = vi.fn().mockRejectedValue(new Error('network down'));
		expect(await generateTurnIceServers('key-id', 'api-token', { fetchFn })).toEqual([]);
	});

	test('returns [] when the response has no iceServers field', async () => {
		const fetchFn = vi.fn().mockResolvedValue(jsonResponse({}, 201));
		expect(await generateTurnIceServers('key-id', 'api-token', { fetchFn })).toEqual([]);
	});
});
