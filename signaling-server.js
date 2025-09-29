const WebSocket = require('ws');
const http = require('http');

const server = http.createServer();

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
let totalRooms = 0;

// Rate limiting configuration
const RATE_LIMITS = {
  messagesPerSecond: 10,     // Max 10 messages per second per client
  connectionAttempts: 5,      // Max 5 connection attempts per IP per minute
  roomJoinsPerMinute: 10     // Max 10 room joins per client per minute
};

// Rate limiting storage
const rateLimitStore = {
  messages: new Map(),        // clientId -> { count, resetTime }
  connections: new Map(),     // IP -> { count, resetTime }
  roomJoins: new Map()       // clientId -> { count, resetTime }
};

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
  let currentRoom = null;
  let clientId = null;
  let isAlive = true;

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

  // Set up keepalive mechanism
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      // Check message rate limit (after we have clientId)
      if (clientId && !checkMessageRateLimit(clientId)) {
        console.log(`⚠️ Message rate limit exceeded for client: ${clientId}`);
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Rate limit exceeded. Please slow down.'
        }));
        return;
      }

      switch (data.type) {
        case 'join':
          // Check room join rate limit
          if (data.clientId && !checkRoomJoinRateLimit(data.clientId)) {
            console.log(`⚠️ Room join rate limit exceeded for client: ${data.clientId}`);
            ws.send(JSON.stringify({
              type: 'error',
              message: 'Too many room join attempts. Please wait.'
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
          clientId = data.clientId;

          if (!rooms.has(currentRoom)) {
            rooms.set(currentRoom, new Set());
          }

          const room = rooms.get(currentRoom);
          room.add(ws);

          // Notify others in room
          room.forEach(client => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify({
                type: 'peer-joined',
                clientId: clientId,
                roomId: currentRoom
              }));
            }
          });

          // Store clientId on the WebSocket connection
          ws.clientId = clientId;

          // Send list of existing peers
          const peers = [];
          room.forEach(client => {
            if (client !== ws && client.clientId) {
              peers.push(client.clientId);
            }
          });

          ws.send(JSON.stringify({
            type: 'room-joined',
            roomId: currentRoom,
            peers: peers
          }));
          console.log(`Client ${clientId} joined room ${currentRoom}`);
          break;

        case 'offer':
        case 'answer':
        case 'ice-candidate':
          // Relay WebRTC signaling to specific peer
          if (currentRoom && rooms.has(currentRoom)) {
            const room = rooms.get(currentRoom);
            room.forEach(client => {
              if (client.clientId === data.targetId && client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({
                  type: data.type,
                  data: data.data,
                  fromId: clientId
                }));
              }
            });
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
                  clientId: clientId
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
      console.error('Error handling message:', error);
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
            clientId: clientId
          }));
        }
      });

      if (room.size === 0) {
        rooms.delete(currentRoom);
      }
    }
    console.log(`Client ${clientId} disconnected`);
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
  console.log(`📱 New connection (Total: ${totalConnections}, Rooms: ${totalRooms})`);

  ws.on('close', () => {
    totalConnections--;
    console.log(`📱 Connection closed (Total: ${totalConnections}, Rooms: ${totalRooms})`);
  });
});

// Health monitoring endpoint with CORS
server.on('request', (req, res) => {
  // Set CORS headers for all requests
  const allowedOrigins = [
    'https://mindline.pages.dev',
    'https://*.pages.dev',
    'http://localhost:8080',
    'http://127.0.0.1:8080'
  ];

  const origin = req.headers.origin;

  // Check if origin matches allowed origins or patterns
  const isAllowed = allowedOrigins.some(allowed => {
    if (allowed.includes('*')) {
      const pattern = allowed.replace('*', '.*');
      return new RegExp(`^${pattern}$`).test(origin);
    }
    return allowed === origin;
  });

  if (isAllowed || !origin) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Origin, X-Requested-With, Accept');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'healthy',
      connections: totalConnections,
      rooms: totalRooms,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      environment: NODE_ENV
    }));
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