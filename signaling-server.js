import WebSocket, { WebSocketServer } from 'ws';
import http from 'http';
import crypto from 'crypto';
import { generateTurnIceServers, DEFAULT_TTL_SECONDS } from './turn-credentials.js';
import {
	clientLimitKey,
	createConnectionCounter,
	parseTrustedProxyConfig,
	resolveClientIp,
	roomHasSpace,
	turnCredentialRecipients
} from './signaling-policy.js';

const server = http.createServer();

function readPositiveIntEnv(name, fallback) {
	const raw = process.env[name];
	if (typeof raw !== 'string' || raw.trim() === '') {
		return fallback;
	}

	const parsed = Number.parseInt(raw, 10);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		console.warn(`Invalid ${name}=${raw}. Using default ${fallback}.`);
		return fallback;
	}

	return parsed;
}

// Production limits to prevent resource exhaustion
const SERVER_LIMITS = {
	maxConnections: 1000, // Maximum concurrent WebSocket connections
	maxRooms: 500, // Maximum concurrent rooms
	maxRateLimitEntries: 10000, // Maximum entries in rate limit maps (LRU-style cleanup)
	// Per-client (IPv4 address / IPv6 /64) concurrent sockets, so one host
	// cannot fill the global connection and room caps.
	maxConnectionsPerIp: readPositiveIntEnv('MAX_CONNECTIONS_PER_IP', 20),
	// Members per room; the product targets 2 to 8 people.
	maxRoomMembers: readPositiveIntEnv('MAX_ROOM_MEMBERS', 16),
	// Unsent bytes a socket may queue before further sends to it are dropped.
	// Honest browsers read promptly; this bounds memory for a peer that never
	// reads (it can still keep itself alive with unsolicited pongs).
	maxBufferedBytes: 256 * 1024
};

// Which request header carries the real client IP, and which TCP peers may set
// it (TRUSTED_PROXY_HEADER / TRUSTED_PROXY_CIDRS, see .env.example). Unset keeps
// the legacy cf-connecting-ip → x-forwarded-for chain from any peer.
const TRUSTED_PROXY = parseTrustedProxyConfig(
	process.env.TRUSTED_PROXY_HEADER,
	process.env.TRUSTED_PROXY_CIDRS
);
if (TRUSTED_PROXY.invalidCidrs.length > 0) {
	console.warn(
		`⚠️ Ignoring invalid TRUSTED_PROXY_CIDRS entries: ${TRUSTED_PROXY.invalidCidrs.join(', ')}`
	);
}
if (TRUSTED_PROXY.headers.length > 0 && TRUSTED_PROXY.trustAnyPeer) {
	console.warn(
		`⚠️ Trusting client IP header(s) ${TRUSTED_PROXY.headers.join(', ')} from any peer. ` +
			'Anyone who can reach this server directly can spoof their IP past per-IP limits. ' +
			'Set TRUSTED_PROXY_CIDRS to your proxy ranges, or TRUSTED_PROXY_HEADER=none.'
	);
}

// Live sockets per client key (see clientLimitKey), for maxConnectionsPerIp.
const connectionsPerClient = createConnectionCounter(SERVER_LIMITS.maxConnectionsPerIp);

/**
 * Send unless the socket is closed or its outbound buffer is over the cap.
 * Dropping (rather than queueing without bound) is the only safe choice for a
 * peer that stopped reading; its client recovers through ICE deadlines and
 * signaling reconnects.
 */
function sendTo(client, payload) {
	if (client.readyState !== WebSocket.OPEN) return;
	if (client.bufferedAmount > SERVER_LIMITS.maxBufferedBytes) {
		if (!client.sendsDropped) {
			client.sendsDropped = true;
			console.log(`⚠️ Dropping sends to backlogged client: ${client.clientId?.slice(0, 8)}...`);
		}
		return;
	}
	client.sendsDropped = false;
	client.send(payload);
}

// Allowed browser origins for both HTTP CORS and the WebSocket upgrade.
// Self-hosters set ALLOWED_ORIGINS (comma-separated) to their app origin(s).
const ALLOWED_ORIGINS = (
	process.env.ALLOWED_ORIGINS ||
	'http://localhost:5173,http://localhost:8080,http://localhost:8088,http://localhost:4173,http://127.0.0.1:8080,http://127.0.0.1:8088'
)
	.split(',')
	.map((s) => s.trim())
	.filter(Boolean);

// Production-ready WebSocket server configuration
const wss = new WebSocketServer({
	server,
	path: '/ws', // Use /ws path for nginx proxy
	perMessageDeflate: false, // Disable compression for better performance
	maxPayload: 16 * 1024, // 16KB max payload
	// Lenient Origin check: browsers always send Origin, so an unknown one is
	// rejected. Non-browser clients (e.g. the `ws`-based soak test) send no
	// Origin header at all and are allowed through.
	verifyClient: ({ origin }) => {
		if (origin && !ALLOWED_ORIGINS.includes(origin)) {
			console.log(`⚠️ Rejected WebSocket upgrade from disallowed origin: ${origin}`);
			return false;
		}
		return true;
	}
});

// Store connected clients by room
const rooms = new Map();

// Add connection tracking for monitoring
let totalConnections = 0;

// Rate limiting configuration
const RATE_LIMITS = {
	messagesPerSecond: readPositiveIntEnv('RATE_LIMIT_MESSAGES_PER_SECOND', 50),
	connectionAttempts: readPositiveIntEnv(
		'RATE_LIMIT_CONNECTION_ATTEMPTS_PER_MINUTE',
		process.env.NODE_ENV === 'production' ? 240 : 30
	),
	roomJoinsPerMinute: readPositiveIntEnv('RATE_LIMIT_ROOM_JOINS_PER_MINUTE', 30)
};

// Rate limiting storage with bounded size
const rateLimitStore = {
	messages: new Map(), // clientId -> { count, resetTime }
	connections: new Map(), // IP -> { count, resetTime }
	roomJoins: new Map() // clientId -> { count, resetTime }
};

/**
 * Enforce max entries on a Map using LRU-style cleanup
 */
function enforceMapLimit(map, maxSize) {
	if (map.size > maxSize) {
		// Remove oldest entries (first 10% of excess)
		const toRemove = Math.ceil((map.size - maxSize) * 1.1);
		const iterator = map.keys();
		for (let i = 0; i < toRemove; i++) {
			const key = iterator.next().value;
			if (key) map.delete(key);
		}
	}
}

// Clean up rate limit storage periodically
setInterval(() => {
	const now = Date.now();

	// Clean message rate limits
	for (const [key, data] of rateLimitStore.messages.entries()) {
		if (now > data.resetTime) {
			rateLimitStore.messages.delete(key);
		}
	}

	// Clean connection rate limits
	for (const [key, data] of rateLimitStore.connections.entries()) {
		if (now > data.resetTime) {
			rateLimitStore.connections.delete(key);
		}
	}

	// Clean room join rate limits
	for (const [key, data] of rateLimitStore.roomJoins.entries()) {
		if (now > data.resetTime) {
			rateLimitStore.roomJoins.delete(key);
		}
	}

	// Enforce max entries to prevent memory leaks
	enforceMapLimit(rateLimitStore.messages, SERVER_LIMITS.maxRateLimitEntries);
	enforceMapLimit(rateLimitStore.connections, SERVER_LIMITS.maxRateLimitEntries);
	enforceMapLimit(rateLimitStore.roomJoins, SERVER_LIMITS.maxRateLimitEntries);

	// Clean up empty rooms
	for (const [roomId, room] of rooms.entries()) {
		if (room.size === 0) {
			rooms.delete(roomId);
		}
	}
}, 60000); // Clean every minute

/**
 * Check if client has exceeded message rate limit
 */
function checkMessageRateLimit(clientId) {
	const now = Date.now();
	const limit = rateLimitStore.messages.get(clientId);

	if (!limit || now > limit.resetTime) {
		// Reset or create new limit
		rateLimitStore.messages.set(clientId, {
			count: 1,
			resetTime: now + 1000 // 1 second window
		});
		return true;
	}

	if (limit.count >= RATE_LIMITS.messagesPerSecond) {
		return false; // Rate limit exceeded
	}

	limit.count++;
	return true;
}

/**
 * Check if IP has exceeded connection rate limit
 */
function checkConnectionRateLimit(ip) {
	const now = Date.now();
	const limit = rateLimitStore.connections.get(ip);

	if (!limit || now > limit.resetTime) {
		// Reset or create new limit
		rateLimitStore.connections.set(ip, {
			count: 1,
			resetTime: now + 60000 // 1 minute window
		});
		return true;
	}

	if (limit.count >= RATE_LIMITS.connectionAttempts) {
		return false; // Rate limit exceeded
	}

	limit.count++;
	return true;
}

/**
 * Check if client has exceeded room join rate limit
 */
function checkRoomJoinRateLimit(clientId) {
	const now = Date.now();
	const limit = rateLimitStore.roomJoins.get(clientId);

	if (!limit || now > limit.resetTime) {
		// Reset or create new limit
		rateLimitStore.roomJoins.set(clientId, {
			count: 1,
			resetTime: now + 60000 // 1 minute window
		});
		return true;
	}

	if (limit.count >= RATE_LIMITS.roomJoinsPerMinute) {
		return false; // Rate limit exceeded
	}

	limit.count++;
	return true;
}

// Cloudflare TURN credentials, minted server-side (the app frontend is static
// and can't hold the CF secret). Refreshed on a timer rather than per request,
// so clients can never trigger credential generation. Delivered only to sockets
// in a room with at least one other member (deliverTurnCredentials), never on
// the bare welcome. Stays empty when CF_TURN_* env is unset, in which case
// clients fall back to STUN-only.
let turnIceServers = [];
const TURN_TTL_SECONDS = readPositiveIntEnv('CF_TURN_TTL_SECONDS', DEFAULT_TTL_SECONDS);

async function refreshTurnIceServers() {
	const next = await generateTurnIceServers(
		process.env.CF_TURN_TOKEN_ID,
		process.env.CF_TURN_API_TOKEN,
		{ ttl: TURN_TTL_SECONDS }
	);
	const configured = process.env.CF_TURN_TOKEN_ID && process.env.CF_TURN_API_TOKEN;
	// Keep the last good set if a refresh returns empty due to a transient
	// Cloudflare error while still configured — don't flap clients to STUN-only.
	if (next.length > 0 || !configured) {
		turnIceServers = next;
	}
}

/**
 * Hand the current TURN credentials to every member of a room that now has a
 * peer to relay to (PROTOCOL.md §3.1). Reuses the 'client-id' message, which
 * the client already treats as "replace my managed ICE servers"; it must be
 * sent before 'room-joined' / 'peer-joined' so the RTCPeerConnection built for
 * the new pair includes TURN.
 */
function deliverTurnCredentials(room) {
	if (turnIceServers.length === 0) return;
	for (const client of turnCredentialRecipients(room)) {
		sendTo(
			client,
			JSON.stringify({
				type: 'client-id',
				clientId: client.clientId,
				iceServers: turnIceServers
			})
		);
	}
}

wss.on('connection', (ws, req) => {
	// Check max connections limit
	if (totalConnections >= SERVER_LIMITS.maxConnections) {
		console.log(
			`⚠️ Max connections (${SERVER_LIMITS.maxConnections}) reached, rejecting new connection`
		);
		ws.close(1013, 'Server at capacity');
		return;
	}

	let currentRoom = null;

	// Generate server-assigned client ID (prevents client-side spoofing)
	const serverClientId = crypto.randomUUID();

	// Client IP for rate limiting, from a proxy header only when trusted
	const clientIP = resolveClientIp(req.headers, req.socket.remoteAddress, TRUSTED_PROXY);
	const clientKey = clientLimitKey(clientIP);

	// Check connection rate limit
	if (!checkConnectionRateLimit(clientKey)) {
		console.log(`⚠️ Connection rate limit exceeded for IP: ${clientIP}`);
		ws.close(1008, 'Rate limit exceeded');
		return;
	}

	// Check per-IP concurrent connections (released in the close handler below)
	if (!connectionsPerClient.tryAcquire(clientKey)) {
		console.log(
			`⚠️ Max connections per IP (${SERVER_LIMITS.maxConnectionsPerIp}) for: ${clientIP}`
		);
		ws.close(1013, 'Too many connections');
		return;
	}

	// Assign server-generated ID to connection
	ws.clientId = serverClientId;

	// Track connection for monitoring (decremented in the close handler below)
	totalConnections++;
	console.log(`📱 New connection (Total: ${totalConnections}, Rooms: ${rooms.size})`);

	// Set up keepalive mechanism
	ws.isAlive = true;
	ws.on('pong', () => {
		ws.isAlive = true;
	});

	// Send the server-assigned client ID to the client. Managed TURN credentials
	// follow on a later 'client-id' once the socket shares a room with a peer
	// (deliverTurnCredentials); an empty list here keeps clients STUN-only.
	sendTo(
		ws,
		JSON.stringify({
			type: 'client-id',
			clientId: serverClientId,
			iceServers: []
		})
	);

	// Remove this socket from its room and tell the remaining members. Clearing
	// currentRoom matters: without it a socket that sent 'leave' could keep
	// relaying into the room while no longer listed as a member.
	function leaveCurrentRoom() {
		const room = currentRoom ? rooms.get(currentRoom) : undefined;
		if (room && room.delete(ws)) {
			room.forEach((client) => {
				sendTo(
					client,
					JSON.stringify({
						type: 'peer-left',
						clientId: serverClientId
					})
				);
			});
			if (room.size === 0) {
				rooms.delete(currentRoom);
			}
		}
		currentRoom = null;
	}

	ws.on('message', (message) => {
		// Rate limit before parsing, so malformed frames cannot bypass it
		if (!checkMessageRateLimit(serverClientId)) {
			console.log(`⚠️ Message rate limit exceeded for client: ${serverClientId}`);
			sendTo(
				ws,
				JSON.stringify({
					type: 'error',
					message: 'Rate limit exceeded. Please slow down.'
				})
			);
			return;
		}

		// Wrap JSON parsing in try-catch to handle malformed messages
		let data;
		try {
			data = JSON.parse(message);
		} catch (parseError) {
			console.error('Invalid JSON message received:', parseError.message);
			sendTo(
				ws,
				JSON.stringify({
					type: 'error',
					message: 'Invalid message format'
				})
			);
			return;
		}

		try {
			switch (data?.type) {
				case 'join': {
					// Check room join rate limit
					if (!checkRoomJoinRateLimit(serverClientId)) {
						console.log(`⚠️ Room join rate limit exceeded for client: ${serverClientId}`);
						sendTo(
							ws,
							JSON.stringify({
								type: 'error',
								message: 'Too many room join attempts. Please wait.'
							})
						);
						return;
					}

					// Validate room ID
					if (
						!data.roomId ||
						typeof data.roomId !== 'string' ||
						data.roomId.length < 4 ||
						data.roomId.length > 100
					) {
						sendTo(
							ws,
							JSON.stringify({
								type: 'error',
								message: 'Invalid room ID'
							})
						);
						return;
					}

					// Check max rooms limit
					if (!rooms.has(data.roomId) && rooms.size >= SERVER_LIMITS.maxRooms) {
						sendTo(
							ws,
							JSON.stringify({
								type: 'error',
								message: 'Server at capacity. Cannot create new rooms.'
							})
						);
						return;
					}

					// Check per-room member limit
					if (!roomHasSpace(rooms.get(data.roomId), ws, SERVER_LIMITS.maxRoomMembers)) {
						sendTo(
							ws,
							JSON.stringify({
								type: 'error',
								message: 'Room is full.'
							})
						);
						return;
					}

					// Leave current room if any (notifying its members)
					if (currentRoom !== data.roomId) {
						leaveCurrentRoom();
					}

					// Join new room
					currentRoom = data.roomId;

					if (!rooms.has(currentRoom)) {
						rooms.set(currentRoom, new Set());
					}

					const room = rooms.get(currentRoom);
					room.add(ws);

					// TURN only once there is a peer to reach, and ahead of the
					// peer-joined / room-joined messages that build connections
					deliverTurnCredentials(room);

					// Notify others in room (use server-assigned ID)
					room.forEach((client) => {
						if (client !== ws && client.readyState === WebSocket.OPEN) {
							sendTo(
								client,
								JSON.stringify({
									type: 'peer-joined',
									clientId: serverClientId,
									roomId: currentRoom
								})
							);
						}
					});

					// Send list of existing peers (with their server-assigned IDs)
					const peers = [];
					room.forEach((client) => {
						if (client !== ws && client.clientId) {
							peers.push(client.clientId);
						}
					});

					sendTo(
						ws,
						JSON.stringify({
							type: 'room-joined',
							roomId: currentRoom,
							peers: peers,
							yourId: serverClientId
						})
					);
					console.log(`Client ${serverClientId.slice(0, 8)}... joined room ${currentRoom}`);
					break;
				}

				case 'offer':
				case 'answer':
				case 'ice-candidate':
				case 'relay-key':
					// Relay WebRTC signaling to specific peer
					if (currentRoom && rooms.has(currentRoom)) {
						const room = rooms.get(currentRoom);
						room.forEach((client) => {
							if (client.clientId === data.targetId && client.readyState === WebSocket.OPEN) {
								// Use server-assigned ID as fromId (prevents spoofing)
								sendTo(
									client,
									JSON.stringify({
										type: data.type,
										data: data.data,
										fromId: serverClientId
									})
								);
							}
						});
					}
					break;

				case 'relay':
					// Rate limit relay messages too (was missing!)
					if (!checkMessageRateLimit(serverClientId)) {
						sendTo(
							ws,
							JSON.stringify({
								type: 'error',
								message: 'Rate limit exceeded for relay messages.'
							})
						);
						return;
					}

					// Relay encrypted messages when P2P fails (fallback)
					// Server just forwards - content stays E2E encrypted
					// Use server-assigned ID to prevent spoofing
					if (currentRoom && rooms.has(currentRoom)) {
						const room = rooms.get(currentRoom);
						const relayMessage = JSON.stringify({
							type: 'relay',
							data: data.data,
							fromId: serverClientId // Use server-assigned ID, not client-provided
						});

						if (data.targetId) {
							// Send to specific peer
							room.forEach((client) => {
								if (client.clientId === data.targetId && client.readyState === WebSocket.OPEN) {
									sendTo(client, relayMessage);
								}
							});
						} else {
							// Broadcast to all peers in room
							room.forEach((client) => {
								if (client !== ws && client.readyState === WebSocket.OPEN) {
									sendTo(client, relayMessage);
								}
							});
						}
					}
					break;

				case 'leave':
					leaveCurrentRoom();
					break;
			}
		} catch (error) {
			console.error('Error handling message:', error.message);
			sendTo(
				ws,
				JSON.stringify({
					type: 'error',
					message: 'Internal server error'
				})
			);
		}
	});

	ws.on('close', () => {
		// Clean up on disconnect
		leaveCurrentRoom();
		console.log(`Client ${serverClientId.slice(0, 8)}... disconnected`);

		// Update connection monitoring counters
		totalConnections--;
		connectionsPerClient.release(clientKey);
		console.log(`📱 Connection closed (Total: ${totalConnections}, Rooms: ${rooms.size})`);
	});
});

// Production configuration
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const NODE_ENV = process.env.NODE_ENV || 'development';

// Add keepalive ping mechanism with mobile-friendly tolerance
// Mobile devices may be slow to respond when backgrounded or during network transitions
const KEEPALIVE_INTERVAL = 45000; // 45 seconds (increased from 30s for mobile)
const MAX_MISSED_PONGS = 2; // Allow 2 missed pongs before termination

const keepaliveInterval = setInterval(() => {
	wss.clients.forEach((ws) => {
		if (!ws.isAlive) {
			// Track missed pongs
			ws.missedPongs = (ws.missedPongs || 0) + 1;

			if (ws.missedPongs >= MAX_MISSED_PONGS) {
				console.log(`📡 Terminating dead connection (missed ${ws.missedPongs} pongs)`);
				ws.terminate();
				return;
			}

			console.log(`📡 Client missed pong (${ws.missedPongs}/${MAX_MISSED_PONGS})`);
		} else {
			// Reset missed pongs counter on successful pong
			ws.missedPongs = 0;
		}

		ws.isAlive = false;
		ws.ping();
	});
}, KEEPALIVE_INTERVAL);

// Mint TURN credentials at startup and refresh at half the TTL to stay well
// ahead of expiry. No-op (leaves turnIceServers empty) when CF_TURN_* is unset.
// Clamped to what setInterval accepts, and never faster than every 30s.
const TURN_REFRESH_MS = Math.min(Math.max((TURN_TTL_SECONDS / 2) * 1000, 30000), 2 ** 31 - 1);
void refreshTurnIceServers();
const turnRefreshInterval = setInterval(refreshTurnIceServers, TURN_REFRESH_MS);

wss.on('close', () => {
	clearInterval(keepaliveInterval);
	clearInterval(turnRefreshInterval);
});

server.listen(PORT, HOST, () => {
	console.log(`🚀 Mindline Signaling Server`);
	console.log(`   Port: ${PORT}`);
	console.log(`   Host: ${HOST}`);
	console.log(`   Environment: ${NODE_ENV}`);
	console.log(`   WebSocket Path: /ws`);
	console.log(
		`   Rate limits: msg/s=${RATE_LIMITS.messagesPerSecond}, conn/min=${RATE_LIMITS.connectionAttempts}, joins/min=${RATE_LIMITS.roomJoinsPerMinute}`
	);
	console.log(
		`   Caps: conns/IP=${SERVER_LIMITS.maxConnectionsPerIp}, members/room=${SERVER_LIMITS.maxRoomMembers}`
	);
	console.log(
		`   Client IP: ${TRUSTED_PROXY.headers.join(', ') || 'socket address'}` +
			(TRUSTED_PROXY.trustAnyPeer
				? ''
				: ` (trusted peers: ${TRUSTED_PROXY.cidrs.join(', ') || 'none'})`)
	);
	console.log(`💓 Keepalive enabled (${KEEPALIVE_INTERVAL / 1000}s interval)`);
	console.log(`   Ready for connections!`);
});

// Health monitoring endpoint with CORS and security headers
server.on('request', (req, res) => {
	// Security headers for all responses
	res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
	res.setHeader('X-Content-Type-Options', 'nosniff');
	res.setHeader('X-Frame-Options', 'DENY');
	res.setHeader('X-XSS-Protection', '1; mode=block');
	res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
	// This server returns only tiny text/JSON (e.g. /health), so lock the CSP
	// all the way down — no scripts, frames, or base URI of any kind.
	res.setHeader(
		'Content-Security-Policy',
		"default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
	);

	// CORS configuration - explicit allowed origins only (no wildcards!)
	const origin = req.headers.origin;

	// Only allow explicitly listed origins - no wildcards
	if (origin && ALLOWED_ORIGINS.includes(origin)) {
		res.setHeader('Access-Control-Allow-Origin', origin);
		res.setHeader('Access-Control-Allow-Credentials', 'true');
	}
	// Note: If origin is not in allowlist, no CORS headers are set (request blocked by browser)

	res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
	res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Origin, X-Requested-With, Accept');

	// Handle preflight requests
	if (req.method === 'OPTIONS') {
		if (origin && ALLOWED_ORIGINS.includes(origin)) {
			res.writeHead(200);
		} else {
			res.writeHead(403);
		}
		res.end();
		return;
	}

	const requestPath = req.url?.split('?', 1)[0];
	if (requestPath === '/health') {
		// Health endpoint - only expose minimal safe information
		// A cached success can conceal an outage from monitors.
		res.writeHead(200, {
			'Content-Type': 'application/json',
			'Cache-Control': 'no-store'
		});
		res.end(
			JSON.stringify({
				status: 'healthy',
				uptime: Math.floor(process.uptime()),
				version: '1.0.0'
				// Note: Removed connections, rooms, memory to prevent info disclosure
			})
		);
	} else if (requestPath === '/') {
		res.writeHead(200, { 'Content-Type': 'text/plain' });
		res.end('Mindline Signaling Server');
	} else {
		res.writeHead(404);
		res.end('Not Found');
	}
});

// Graceful shutdown
process.on('SIGTERM', () => {
	console.log('📴 Shutting down signaling server...');
	server.close(() => {
		console.log('✅ Server shutdown complete');
		process.exit(0);
	});
});
