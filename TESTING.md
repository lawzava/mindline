# Testing P2P Chat on Multiple Devices

## Prerequisites
- Node.js installed on all devices
- All devices should be on the same network (or have internet access for STUN servers)

## Setup Instructions

### 1. Start the Signaling Server
On one machine (can be any device):
```bash
# Install dependencies if not already done
npm install

# Start the signaling server
npm run signaling
```
The signaling server will run on port 3000.

### 2. Start the Web Application
In a separate terminal on the same machine:
```bash
# Build the project (only needed once or after changes)
npm run build

# Start the web server
npm start
```
The application will be available at http://localhost:8080

### 3. Access from Multiple Devices

#### Option A: Local Network Testing
1. Find your computer's local IP address:
   - Mac: `ifconfig | grep "inet " | grep -v 127.0.0.1`
   - Windows: `ipconfig` (look for IPv4 Address)
   - Linux: `ip addr show`

2. On other devices (phones, tablets, other computers):
   - Open a browser and navigate to `http://[YOUR-IP]:8080`
   - Example: `http://192.168.1.100:8080`

#### Option B: Same Computer Testing
1. Open multiple browser windows/tabs
2. Use incognito/private windows for different "users"
3. Navigate to `http://localhost:8080` in each window

### 4. Testing P2P Chat

1. **Initialize Users**:
   - In each browser, enter a username
   - Click "Initialize User"

2. **Create/Join a Room**:
   - First user: Enter a room name and click "Create Room"
   - Other users: Enter the same room name and click "Join Room"

3. **Start Chatting**:
   - Type messages and press Enter or click Send
   - Messages should appear on all connected devices
   - You'll see typing indicators when others are typing

## Troubleshooting

### Connection Issues
- Ensure the signaling server is running (`npm run signaling`)
- Check that all devices are on the same network
- Disable firewall temporarily for testing
- Check browser console for error messages (F12 → Console)

### WebRTC Not Working
- Some browsers require HTTPS for WebRTC on non-localhost connections
- Try using Chrome or Firefox (better WebRTC support)
- Ensure browser has camera/microphone permissions (even though we only use data channels)

### Messages Not Syncing
- Check the debug output area in the application
- Verify room IDs match exactly (case-sensitive)
- Refresh the page and rejoin the room

## Testing Checklist
- [ ] Signaling server running
- [ ] Web application built and served
- [ ] Multiple devices/browsers can access the application
- [ ] Users can initialize with unique names
- [ ] Users can create and join rooms
- [ ] Messages are delivered to all participants
- [ ] Typing indicators work
- [ ] Peer count updates when users join/leave
- [ ] Messages persist in chat history

## Network Configuration for Production

For production deployment, you'll need:
1. Deploy signaling server to a public server (e.g., Heroku, AWS)
2. Update WebSocket URL in `js/webrtc.js` to point to your signaling server
3. Use HTTPS for the web application (required for WebRTC in production)
4. Configure TURN servers for NAT traversal (currently only using STUN)