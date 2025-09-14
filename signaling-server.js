const WebSocket = require('ws');
const http = require('http');

const server = http.createServer();
const wss = new WebSocket.Server({ server });

// Store connected clients by room
const rooms = new Map();

wss.on('connection', (ws) => {
  let currentRoom = null;
  let clientId = null;

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      switch (data.type) {
        case 'join':
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Signaling server running on port ${PORT}`);
});