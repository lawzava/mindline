const WebSocket = require('ws');
const http = require('http');

const PORT = process.env.PORT || 3000;

// Create HTTP server
const server = http.createServer((req, res) => {
  // Health check endpoint
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK');
    return;
  }

  // CORS headers for browser requests
  res.writeHead(200, {
    'Content-Type': 'text/plain',
    'Access-Control-Allow-Origin': '*'
  });
  res.end('Mindline Signaling Server\n');
});

// Create WebSocket server
const wss = new WebSocket.Server({
  server,
  path: '/ws'
});

// Store room participants
const rooms = new Map();

wss.on('connection', (ws, req) => {
  console.log('New client connected');

  let currentRoom = null;
  let clientId = null;

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      console.log('Received:', data.type, 'from', data.clientId);

      switch (data.type) {
        case 'join':
          clientId = data.clientId;
          currentRoom = data.roomId;

          // Get or create room
          if (!rooms.has(currentRoom)) {
            rooms.set(currentRoom, new Map());
          }
          const room = rooms.get(currentRoom);

          // Get list of existing peers
          const peers = Array.from(room.keys()).filter(id => id !== clientId);

          // Add this client to room
          room.set(clientId, ws);

          // Send room-joined with peer list
          ws.send(JSON.stringify({
            type: 'room-joined',
            roomId: currentRoom,
            peers: peers
          }));

          // Notify others in room
          peers.forEach(peerId => {
            const peerWs = room.get(peerId);
            if (peerWs && peerWs.readyState === WebSocket.OPEN) {
              peerWs.send(JSON.stringify({
                type: 'peer-joined',
                clientId: clientId
              }));
            }
          });

          console.log(`Client ${clientId} joined room ${currentRoom}. Room now has ${room.size} peers.`);
          break;

        case 'offer':
        case 'answer':
        case 'ice-candidate':
        case 'message':
          // Relay to specific peer
          if (currentRoom && data.to) {
            const room = rooms.get(currentRoom);
            if (room) {
              const targetWs = room.get(data.to);
              if (targetWs && targetWs.readyState === WebSocket.OPEN) {
                targetWs.send(JSON.stringify({
                  ...data,
                  from: clientId
                }));
              }
            }
          }
          break;

        case 'broadcast':
          // Broadcast to all in room except sender
          if (currentRoom) {
            const room = rooms.get(currentRoom);
            if (room) {
              room.forEach((peerWs, peerId) => {
                if (peerId !== clientId && peerWs.readyState === WebSocket.OPEN) {
                  peerWs.send(JSON.stringify({
                    ...data,
                    from: clientId
                  }));
                }
              });
            }
          }
          break;
      }
    } catch (error) {
      console.error('Error handling message:', error);
    }
  });

  ws.on('close', () => {
    console.log(`Client ${clientId} disconnected`);

    // Remove from room
    if (currentRoom && clientId) {
      const room = rooms.get(currentRoom);
      if (room) {
        room.delete(clientId);

        // Notify others
        room.forEach((peerWs, peerId) => {
          if (peerWs.readyState === WebSocket.OPEN) {
            peerWs.send(JSON.stringify({
              type: 'peer-left',
              clientId: clientId
            }));
          }
        });

        // Clean up empty rooms
        if (room.size === 0) {
          rooms.delete(currentRoom);
        }
      }
    }
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

server.listen(PORT, () => {
  console.log(`Signaling server running on port ${PORT}`);
  console.log(`WebSocket endpoint: ws://localhost:${PORT}/ws`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});