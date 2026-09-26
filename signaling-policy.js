/**
 * Admission and trust policy for the signaling server (signaling-server.js).
 *
 * Pure helpers with no sockets or timers, so client IP resolution and the
 * connection/room caps are unit tested without starting the server.
 */

import net from 'node:net';

// Today's behavior when TRUSTED_PROXY_HEADER is unset: Cloudflare's header,
// then the first X-Forwarded-For entry, then the TCP peer address.
export const DEFAULT_TRUSTED_PROXY_HEADERS = ['cf-connecting-ip', 'x-forwarded-for'];

/**
 * Canonical form of an IP address, or null when it is not one. Unwraps
 * IPv4-mapped IPv6 (`::ffff:1.2.3.4`) so the same client gets one key.
 *
 * @param {unknown} value
 * @returns {string|null}
 */
export function normalizeIp(value) {
	if (typeof value !== 'string') return null;
	let ip = value.trim();
	if (ip.startsWith('[') && ip.endsWith(']')) ip = ip.slice(1, -1);
	if (ip.toLowerCase().startsWith('::ffff:') && net.isIPv4(ip.slice(7))) ip = ip.slice(7);
	return net.isIP(ip) ? ip : null;
}

/**
 * Parse TRUSTED_PROXY_HEADER / TRUSTED_PROXY_CIDRS.
 *
 * - header unset: legacy chain (DEFAULT_TRUSTED_PROXY_HEADERS).
 * - header `none`: never trust a header; always use the TCP peer address.
 * - otherwise: comma-separated header names, tried in order.
 * - cidrs unset: headers are honored from any peer (spoofable if the server is
 *   reachable without the proxy). Set: headers are honored only from peers
 *   inside the ranges. Set but with no valid entry: no peer is trusted
 *   (fail closed).
 *
 * @param {string|undefined} headerEnv
 * @param {string|undefined} cidrEnv
 */
export function parseTrustedProxyConfig(headerEnv, cidrEnv) {
	let headers;
	if (typeof headerEnv !== 'string' || headerEnv.trim() === '') {
		headers = [...DEFAULT_TRUSTED_PROXY_HEADERS];
	} else if (headerEnv.trim().toLowerCase() === 'none') {
		headers = [];
	} else {
		headers = headerEnv
			.split(',')
			.map((name) => name.trim().toLowerCase())
			.filter(Boolean);
	}

	const trustAnyPeer = typeof cidrEnv !== 'string' || cidrEnv.trim() === '';
	const trustedPeers = new net.BlockList();
	const cidrs = [];
	const invalidCidrs = [];
	if (!trustAnyPeer) {
		for (const entry of cidrEnv.split(',').map((s) => s.trim())) {
			if (!entry) continue;
			const [rawAddress, rawPrefix] = entry.split('/');
			const address = normalizeIp(rawAddress);
			const family = address && net.isIPv6(address) ? 'ipv6' : 'ipv4';
			const prefix = rawPrefix === undefined ? (family === 'ipv6' ? 128 : 32) : Number(rawPrefix);
			try {
				if (!address || !Number.isInteger(prefix)) throw new Error('invalid');
				trustedPeers.addSubnet(address, prefix, family);
				cidrs.push(entry);
			} catch {
				invalidCidrs.push(entry);
			}
		}
	}

	return { headers, trustAnyPeer, trustedPeers, cidrs, invalidCidrs };
}

/**
 * @param {string} ip normalized address
 * @param {ReturnType<typeof parseTrustedProxyConfig>} config
 */
function isTrustedPeer(ip, config) {
	return config.trustedPeers.check(ip, net.isIPv6(ip) ? 'ipv6' : 'ipv4');
}

/**
 * Pick the client from an X-Forwarded-For chain. Without trusted CIDRs this is
 * the first entry (legacy behavior). With them, walk from the right past our
 * own proxies: the first untrusted hop is the client, since every hop to its
 * right was appended by infrastructure we trust.
 *
 * @param {string} value
 * @param {ReturnType<typeof parseTrustedProxyConfig>} config
 */
function clientFromForwardedFor(value, config) {
	const hops = value.split(',').map(normalizeIp);
	if (config.trustAnyPeer) return hops[0];
	for (let i = hops.length - 1; i >= 0; i--) {
		const hop = hops[i];
		if (!hop) return null;
		if (!isTrustedPeer(hop, config)) return hop;
	}
	return hops[0];
}

/**
 * Client IP for rate limiting and caps. Headers are only honored per config;
 * anything malformed falls back to the TCP peer address.
 *
 * @param {Record<string, string|string[]|undefined>} headers Node request headers (lowercase keys)
 * @param {string|undefined} remoteAddress req.socket.remoteAddress
 * @param {ReturnType<typeof parseTrustedProxyConfig>} config
 * @returns {string}
 */
export function resolveClientIp(headers, remoteAddress, config) {
	const peer = normalizeIp(remoteAddress);
	const fallback = peer ?? remoteAddress ?? 'unknown';
	if (config.headers.length === 0) return fallback;
	if (!config.trustAnyPeer && (!peer || !isTrustedPeer(peer, config))) return fallback;

	for (const name of config.headers) {
		const raw = headers[name];
		const value = Array.isArray(raw) ? raw.join(',') : raw;
		if (typeof value !== 'string' || value.trim() === '') continue;
		const ip =
			name === 'x-forwarded-for' ? clientFromForwardedFor(value, config) : normalizeIp(value);
		if (ip) return ip;
	}
	return fallback;
}

/**
 * Key for per-client limits. IPv6 is grouped by /64: one subscriber usually
 * holds a whole /64, so per-address keys would let a single host mint
 * unlimited identities. IPv4 and non-IP fallbacks are used as-is.
 *
 * @param {string} ip
 * @returns {string}
 */
export function clientLimitKey(ip) {
	const address = ip.split('%')[0];
	if (!net.isIPv6(address)) return ip;
	const gap = address.includes('::');
	const [headPart, tailPart] = gap ? address.split('::') : [address, ''];
	const head = headPart ? headPart.split(':') : [];
	const tail = tailPart ? tailPart.split(':') : [];
	// A trailing dotted quad (::a.b.c.d) occupies two 16-bit groups.
	const tailGroups = tail.reduce((n, group) => n + (group.includes('.') ? 2 : 1), 0);
	const groups = [...head, ...Array(8 - head.length - tailGroups).fill('0'), ...tail];
	return `${groups
		.slice(0, 4)
		.map((group) => Number.parseInt(group, 16).toString(16))
		.join(':')}::/64`;
}

/**
 * Concurrent-connection counter per key. Entries exist only while the key has
 * a live socket, so the map is bounded by the server's connection cap.
 *
 * @param {number} maxPerKey
 */
export function createConnectionCounter(maxPerKey) {
	/** @type {Map<string, number>} */
	const counts = new Map();
	return {
		/**
		 * Reserve a slot; false (and no change) when the key is at the cap.
		 * @param {string} key
		 */
		tryAcquire(key) {
			const current = counts.get(key) ?? 0;
			if (current >= maxPerKey) return false;
			counts.set(key, current + 1);
			return true;
		},
		/** @param {string} key */
		release(key) {
			const current = counts.get(key) ?? 0;
			if (current <= 1) counts.delete(key);
			else counts.set(key, current - 1);
		},
		/** @param {string} key */
		count(key) {
			return counts.get(key) ?? 0;
		},
		get size() {
			return counts.size;
		}
	};
}

/**
 * Whether `member` may join `room` under the per-room cap. Re-joining a room
 * the socket is already in never counts against it.
 *
 * @template T
 * @param {Set<T>|undefined} room
 * @param {T} member
 * @param {number} maxMembers
 */
export function roomHasSpace(room, member, maxMembers) {
	return !room || room.has(member) || room.size < maxMembers;
}

/**
 * Sockets that should (re)receive TURN credentials after a join: every member,
 * but only once the room holds at least two, so a lone socket (which has
 * nobody to relay to) never gets a credential.
 *
 * @template T
 * @param {Set<T>|undefined} room
 * @returns {T[]}
 */
export function turnCredentialRecipients(room) {
	return room && room.size >= 2 ? [...room] : [];
}
