const WebSocket = require('ws');
const http = require('http');
const crypto = require('crypto');

const server = http.createServer();

// Production limits to prevent resource exhaustion
const SERVER_LIMITS = {
  maxConnections: 1000,       // Maximum concurrent WebSocket connections
  maxRooms: 500,              // Maximum concurrent rooms
  maxRateLimitEntries: 10000  // Maximum entries in rate limit maps (LRU-style cleanup)
};

// Production-ready WebSocket server configuration
const wss = new WebSocket.Server({
  server,
  path: '/ws', // Use /ws path for nginx proxy
  perMessageDeflate: false, // Disable compression for better performance
  maxPayload: 16 * 1024 // 16KB max payload
});

// Store connected clients by room
const rooms = new Map();

// Add connection tracking for monitoring
let totalConnections = 0;

// Rate limiting configuration
const RATE_LIMITS = {
  messagesPerSecond: 10,     // Max 10 messages per second per client
  connectionAttempts: 5,      // Max 5 connection attempts per IP per minute
  roomJoinsPerMinute: 10     // Max 10 room joins per client per minute
};

// Rate limiting storage with bounded size
const rateLimitStore = {
  messages: new Map(),        // clientId -> { count, resetTime }
  connections: new Map(),     // IP -> { count, resetTime }
  roomJoins: new Map()       // clientId -> { count, resetTime }
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

wss.on('connection', (ws, req) => {
  // Check max connections limit
  if (totalConnections >= SERVER_LIMITS.maxConnections) {
    console.log(`⚠️ Max connections (${SERVER_LIMITS.maxConnections}) reached, rejecting new connection`);
    ws.close(1013, 'Server at capacity');
    return;
  }

  let currentRoom = null;

  // Generate server-assigned client ID (prevents client-side spoofing)
  const serverClientId = crypto.randomUUID();

  // Get client IP for rate limiting (check Cloudflare headers first)
  const clientIP = req.headers['cf-connecting-ip'] ||
                   req.headers['x-forwarded-for']?.split(',')[0] ||
                   req.socket.remoteAddress;

  // Check connection rate limit
  if (!checkConnectionRateLimit(clientIP)) {
    console.log(`⚠️ Connection rate limit exceeded for IP: ${clientIP}`);
    ws.close(1008, 'Rate limit exceeded');
    return;
  }

  // Assign server-generated ID to connection
  ws.clientId = serverClientId;

  // Set up keepalive mechanism
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  // Send the server-assigned client ID to the client
  ws.send(JSON.stringify({
    type: 'client-id',
    clientId: serverClientId
  }));

  ws.on('message', (message) => {
    // Wrap JSON parsing in try-catch to handle malformed messages
    let data;
    try {
      data = JSON.parse(message);
    } catch (parseError) {
      console.error('Invalid JSON message received:', parseError.message);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Invalid message format'
      }));
      return;
    }

    try {
      // Check message rate limit using server-assigned ID
      if (!checkMessageRateLimit(serverClientId)) {
        console.log(`⚠️ Message rate limit exceeded for client: ${serverClientId}`);
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Rate limit exceeded. Please slow down.'
        }));
        return;
      }

      switch (data.type) {
        case 'join':
          // Check room join rate limit
          if (!checkRoomJoinRateLimit(serverClientId)) {
            console.log(`⚠️ Room join rate limit exceeded for client: ${serverClientId}`);
            ws.send(JSON.stringify({
              type: 'error',
              message: 'Too many room join attempts. Please wait.'
            }));
            return;
          }

          // Validate room ID
          if (!data.roomId || typeof data.roomId !== 'string' || data.roomId.length < 4 || data.roomId.length > 100) {
            ws.send(JSON.stringify({
              type: 'error',
              message: 'Invalid room ID'
            }));
            return;
          }

          // Check max rooms limit
          if (!rooms.has(data.roomId) && rooms.size >= SERVER_LIMITS.maxRooms) {
            ws.send(JSON.stringify({
              type: 'error',
              message: 'Server at capacity. Cannot create new rooms.'
            }));
            return;
          }

          // Leave current room if any
          if (currentRoom && rooms.has(currentRoom)) {
            const room = rooms.get(currentRoom);
            room.delete(ws);
            if (room.size === 0) {
              rooms.delete(currentRoom);
            }
          }

          // Join new room
          currentRoom = data.roomId;

          if (!rooms.has(currentRoom)) {
            rooms.set(currentRoom, new Set());
          }

          const room = rooms.get(currentRoom);
          room.add(ws);

          // Notify others in room (use server-assigned ID)
          room.forEach(client => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify({
                type: 'peer-joined',
                clientId: serverClientId,
                roomId: currentRoom
              }));
            }
          });

          // Send list of existing peers (with their server-assigned IDs)
          const peers = [];
          room.forEach(client => {
            if (client !== ws && client.clientId) {
              peers.push(client.clientId);
            }
          });

          ws.send(JSON.stringify({
            type: 'room-joined',
            roomId: currentRoom,
            peers: peers,
            yourId: serverClientId
          }));
          console.log(`Client ${serverClientId.slice(0, 8)}... joined room ${currentRoom}`);
          break;

        case 'offer':
        case 'answer':
        case 'ice-candidate':
          // Relay WebRTC signaling to specific peer
          if (currentRoom && rooms.has(currentRoom)) {
            const room = rooms.get(currentRoom);
            room.forEach(client => {
              if (client.clientId === data.targetId && client.readyState === WebSocket.OPEN) {
                // Use server-assigned ID as fromId (prevents spoofing)
                client.send(JSON.stringify({
                  type: data.type,
                  data: data.data,
                  fromId: serverClientId
                }));
              }
            });
          }
          break;

        case 'relay':
          // Rate limit relay messages too (was missing!)
          if (!checkMessageRateLimit(serverClientId)) {
            ws.send(JSON.stringify({
              type: 'error',
              message: 'Rate limit exceeded for relay messages.'
            }));
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
              fromId: serverClientId  // Use server-assigned ID, not client-provided
            });

            if (data.targetId) {
              // Send to specific peer
              room.forEach(client => {
                if (client.clientId === data.targetId && client.readyState === WebSocket.OPEN) {
                  client.send(relayMessage);
                }
              });
            } else {
              // Broadcast to all peers in room
              room.forEach(client => {
                if (client !== ws && client.readyState === WebSocket.OPEN) {
                  client.send(relayMessage);
                }
              });
            }
          }
          break;

        case 'leave':
          if (currentRoom && rooms.has(currentRoom)) {
            const room = rooms.get(currentRoom);
            room.delete(ws);

            // Notify others
            room.forEach(client => {
              if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({
                  type: 'peer-left',
                  clientId: serverClientId
                }));
              }
            });

            if (room.size === 0) {
              rooms.delete(currentRoom);
            }
          }
          break;
      }
    } catch (error) {
      console.error('Error handling message:', error.message);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Internal server error'
      }));
    }
  });

  ws.on('close', () => {
    // Clean up on disconnect
    if (currentRoom && rooms.has(currentRoom)) {
      const room = rooms.get(currentRoom);
      room.delete(ws);

      // Notify others
      room.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({
            type: 'peer-left',
            clientId: serverClientId
          }));
        }
      });

      if (room.size === 0) {
        rooms.delete(currentRoom);
      }
    }
    console.log(`Client ${serverClientId.slice(0, 8)}... disconnected`);
  });
});

// Production configuration
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const NODE_ENV = process.env.NODE_ENV || 'development';

// Add keepalive ping mechanism
const keepaliveInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) {
      console.log('📡 Terminating dead connection');
      ws.terminate();
      return;
    }

    ws.isAlive = false;
    ws.ping();
  });
}, 30000); // Ping every 30 seconds

wss.on('close', () => {
  clearInterval(keepaliveInterval);
});

server.listen(PORT, HOST, () => {
  console.log(`🚀 Mindline Signaling Server`);
  console.log(`   Port: ${PORT}`);
  console.log(`   Host: ${HOST}`);
  console.log(`   Environment: ${NODE_ENV}`);
  console.log(`   WebSocket Path: /ws`);
  console.log(`💓 Keepalive enabled (30s interval)`);
  console.log(`   Ready for connections!`);
});

// Add connection monitoring
wss.on('connection', (ws) => {
  totalConnections++;
  console.log(`📱 New connection (Total: ${totalConnections}, Rooms: ${rooms.size})`);

  ws.on('close', () => {
    totalConnections--;
    console.log(`📱 Connection closed (Total: ${totalConnections}, Rooms: ${rooms.size})`);
  });
});

// Health monitoring endpoint with CORS and security headers
server.on('request', (req, res) => {
  // Security headers for all responses
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self' wss: ws:; style-src 'self' 'unsafe-inline'");

  // CORS configuration - explicit allowed origins only (no wildcards!)
  const allowedOrigins = [
    'https://mindline.pages.dev',
    'http://localhost:8080',
    'http://localhost:8088',
    'http://127.0.0.1:8080',
    'http://127.0.0.1:8088'
  ];

  const origin = req.headers.origin;

  // Only allow explicitly listed origins - no wildcards
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  // Note: If origin is not in allowlist, no CORS headers are set (request blocked by browser)

  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Origin, X-Requested-With, Accept');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    if (origin && allowedOrigins.includes(origin)) {
      res.writeHead(200);
    } else {
      res.writeHead(403);
    }
    res.end();
    return;
  }

  if (req.url === '/health') {
    // Health endpoint - only expose minimal safe information
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'healthy',
      uptime: Math.floor(process.uptime()),
      version: '1.0.0'
      // Note: Removed connections, rooms, memory to prevent info disclosure
    }));
  } else if (req.url === '/') {
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