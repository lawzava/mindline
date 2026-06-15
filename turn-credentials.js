/**
 * Cloudflare Realtime TURN credential minting, used by the signaling server.
 *
 * mindline's app is a static frontend with no server of its own, so the
 * Cloudflare TURN app secret lives on the signaling server (the one server the
 * deploy runs). It mints short-lived ICE credentials here and hands them to
 * clients over the existing signaling WebSocket. See:
 * https://developers.cloudflare.com/realtime/turn/generate-credentials/
 */

const CF_TURN_API = 'https://rtc.live.cloudflare.com/v1/turn/keys';
// 24h. Deliberately generous: a relayed TURN allocation re-authenticates with
// this same credential for the life of the connection, so a short TTL would drop
// long-lived "leave-it-open" chats mid-session. The server mints on a refresh
// timer (not per request), so credentials are never minted on demand by clients.
export const DEFAULT_TTL_SECONDS = 86400;

/**
 * Exchange the Cloudflare TURN app secret for an ephemeral array of RTCIceServer
 * objects. Returns `[]` (never throws) when unconfigured or Cloudflare is
 * unreachable, so the server simply omits TURN and clients fall back to
 * STUN-only instead of failing to connect.
 *
 * @param {string|undefined} tokenId   CF_TURN_TOKEN_ID
 * @param {string|undefined} apiToken  CF_TURN_API_TOKEN
 * @param {{ ttl?: number, fetchFn?: typeof fetch }} [options]
 * @returns {Promise<Array<object>>}
 */
export async function generateTurnIceServers(tokenId, apiToken, options = {}) {
	if (!tokenId || !apiToken) return [];

	const { ttl = DEFAULT_TTL_SECONDS, fetchFn = fetch } = options;

	try {
		const response = await fetchFn(`${CF_TURN_API}/${tokenId}/credentials/generate-ice-servers`, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${apiToken}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({ ttl })
		});

		if (!response.ok) {
			console.error(`[turn] Cloudflare credential request failed: ${response.status}`);
			return [];
		}

		const body = await response.json();
		return body.iceServers ?? [];
	} catch (error) {
		console.error('[turn] Cloudflare credential request errored:', error);
		return [];
	}
}
