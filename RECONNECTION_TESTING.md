# Reconnection & UX Testing Guide

## New Features

### 1. Automatic Reconnection
- Automatically attempts to reconnect when connection is lost
- Up to 5 reconnection attempts with 5-second intervals
- Visual feedback during reconnection process

### 2. User-Friendly Connection Notifications
- "User connected" notifications instead of test draft messages
- Green notification boxes that auto-dismiss after 2 seconds

## Testing Automatic Reconnection

### Test 1: Signaling Server Restart
1. **Setup**: Have 2+ users connected in a room
2. **Disconnect**: Stop the signaling server (`npm run signaling`)
3. **Expected**:
   - Status changes to "Reconnecting... (1/5)"
   - Orange pulsing reconnection indicator
   - Console shows "Connection lost: signaling_server_disconnect"
4. **Reconnect**: Start signaling server again
5. **Expected**:
   - Automatic reconnection within 5 seconds
   - Status returns to "Connected (X peers)"
   - Log shows "Reconnection successful!"

### Test 2: Network Interruption Simulation
1. **Setup**: Connected users
2. **Simulate**: Disconnect network/WiFi for 10-30 seconds
3. **Expected**:
   - Reconnection attempts start automatically
   - Status shows attempt count: "Reconnecting... (X/5)"
4. **Reconnect**: Restore network connection
5. **Expected**: Successful reconnection

### Test 3: Max Reconnection Attempts
1. **Setup**: Connected users
2. **Disconnect**: Stop signaling server permanently
3. **Expected**:
   - 5 reconnection attempts over ~25 seconds
   - Status progresses: "Reconnecting... (1/5)" → "Reconnecting... (5/5)"
   - Final status: "Connection failed"
   - Red failed status indicator

## Testing Connection Notifications

### Test 1: User Joins Room
1. **Setup**: User A in room "test-room"
2. **Action**: User B joins same room
3. **Expected in User A's window**:
   - Green notification: "UserB connected"
   - Notification appears in draft area
   - Auto-dismisses after 2 seconds
   - Console log: "UserB connected"

### Test 2: Multiple Users Join
1. **Setup**: User A in room
2. **Action**: Users B, C, D join sequentially
3. **Expected**:
   - Separate "connected" notification for each user
   - All notifications in draft area temporarily
   - Each auto-dismisses independently

## Visual Status Indicators

### Connection States
- **Connected**: Green "Connected (X peers)"
- **Reconnecting**: Orange pulsing "Reconnecting... (X/5)"
- **Failed**: Red "Connection failed"

### Draft Area Notifications
- **User Connected**: Green background, center-aligned text
- **Draft Messages**: Yellow background with "LIVE" badge
- **Multiple Types**: Can show both drafts and notifications simultaneously

## Console Debugging

### Expected Log Messages
```
// Successful connection:
"Connected to P2P network"
"Sending connection notification to peers..."
"UserName connected"

// Connection loss:
"Connection lost: signaling_server_disconnect"
"Reconnection attempt 1/5..."
"Reconnection successful!"

// Failed reconnection:
"Reconnection attempt 5/5..."
"Reconnection failed after 5 attempts"
```

## Manual Testing Commands

### Trigger Reconnection (Browser Console)
```javascript
// Simulate connection loss
if (window.AppState.p2pConnection) {
  window.AppState.p2pConnection.disconnect();
}

// Check reconnection state
console.log('Reconnect attempts:', window.AppState.reconnectAttempts);
console.log('Is reconnecting:', window.AppState.isReconnecting);
```

### Test Connection Notification
```javascript
// Show connection notification manually
showUserConnectionNotification('Test User');
```

## Expected User Experience

### Seamless Reconnection
- User doesn't need to refresh page or manually reconnect
- Clear visual feedback about connection status
- Automatic recovery from temporary network issues

### Connection Awareness
- Users see when others join/leave the room
- Connection status is always visible
- Failed connections are clearly indicated

### Transparent Process
- All connection events logged to console
- Reconnection progress clearly shown
- No hidden failures or silent disconnections