/**
 * User-Friendly Messages
 * Centralized user-facing messages for better UX
 */

export const USER_MESSAGES = {
  // Room-related messages
  room: {
    invalidFormat: '⚠️ Room ID must be at least 8 characters (letters, numbers, dashes, underscores)',
    enterRoomId: '💡 Please enter a room ID to join a conversation',
    created: (roomId) => `✅ Room created: ${roomId}`,
    joined: (roomId) => `✅ Joined room: ${roomId}`,
    createFailed: '❌ Failed to create room. Please try again.',
    joinFailed: '❌ Unable to join room. Please check the room ID and try again.',
    noRoomToShare: '💡 Create or join a room first to share it',
    linkCopied: '✅ Room link copied to clipboard!',
    shareFailed: '❌ Unable to share room link. Try copying the URL manually.',
    validationNotReady: '⏳ Loading... Please wait a moment and try again.'
  },

  // Connection messages
  connection: {
    connecting: '🔄 Connecting...',
    connected: '✅ Connected to room',
    disconnected: '⚠️ Disconnected',
    local: '📱 Local mode (messages saved locally)',
    reconnecting: (attempt, max) => `🔄 Reconnecting... (${attempt}/${max})`,
    reconnected: '✅ Reconnected successfully!',
    reconnectFailed: '❌ Connection lost. Click "Join Room" to reconnect.',
    p2pInitFailed: '⚠️ Peer-to-peer connection unavailable. You can still chat locally.',
    signalingUnavailable: '📱 Running in local mode - messages saved on your device'
  },

  // Message sending
  message: {
    noRoom: '💡 Join a room first to start chatting',
    userNotReady: '⏳ Initializing... Please wait a moment.',
    validationNotReady: '⏳ Loading... Please wait a moment and try again.',
    validationFailed: '❌ Unable to send message. Please try again.',
    sendFailed: (error) => `❌ Message not sent: ${error}. Your message was saved locally.`,
    createFailed: '❌ Unable to create message. Please try again.',
    synced: (count) => count === 1 ? `✅ Synced 1 new message` : `✅ Synced ${count} new messages`
  },

  // User initialization
  user: {
    enterName: '💡 Enter your name to start chatting',
    nameUpdated: (name) => `✅ Name updated to: ${name}`,
    initFailed: '❌ Unable to initialize user. Please reload the page.'
  },

  // General errors
  error: {
    generic: '❌ Something went wrong. Please try again.',
    reload: '❌ An error occurred. Please reload the page.',
    networkIssue: '⚠️ Connection issue detected. Your messages are saved locally.',
    rateLimitExceeded: '⏸️ Slow down! You\'re sending messages too quickly.'
  },

  // Loading states
  loading: {
    app: '⏳ Loading Mindline...',
    wasm: '⏳ Initializing encryption...',
    room: '⏳ Joining room...',
    messages: '⏳ Loading messages...',
    connection: '⏳ Establishing connection...'
  },

  // Success messages
  success: {
    appReady: '✅ Mindline ready!',
    messageSent: '✅ Message sent',
    roomCreated: '✅ Room created',
    roomJoined: '✅ Room joined'
  },

  // Info messages
  info: {
    localMode: '📱 Local mode: Messages saved on this device only',
    p2pMode: '🌐 P2P mode: Messages synced with connected peers',
    noHistory: '📝 No messages yet. Start the conversation!',
    peerConnected: (name) => `✅ ${name} joined the room`,
    peerDisconnected: (name) => `⚠️ ${name} left the room`,
    typing: (name) => `${name} is typing...`
  }
};

/**
 * Get a user-friendly error message from any error object
 * @param {Error|string} error - Error object or message
 * @param {string} context - Context where error occurred (e.g., 'room', 'message')
 * @returns {string} User-friendly error message
 */
export function getUserFriendlyError(error, context = 'general') {
  // If it's already a user-friendly message (starts with emoji), return as-is
  if (typeof error === 'string' && /^[⚠️❌💡⏳✅🔄📱🌐📝]/.test(error)) {
    return error;
  }

  // Extract error message
  const errorMsg = error?.message || error?.toString() || 'Unknown error';

  // Map technical errors to user-friendly messages
  if (errorMsg.includes('rate limit') || errorMsg.includes('too many')) {
    return USER_MESSAGES.error.rateLimitExceeded;
  }

  if (errorMsg.includes('network') || errorMsg.includes('connection') || errorMsg.includes('timeout')) {
    return USER_MESSAGES.error.networkIssue;
  }

  if (errorMsg.includes('not initialized') || errorMsg.includes('not ready')) {
    return USER_MESSAGES.loading.app;
  }

  if (errorMsg.includes('invalid') && context === 'room') {
    return USER_MESSAGES.room.invalidFormat;
  }

  // Context-specific fallbacks
  switch (context) {
    case 'room':
      return USER_MESSAGES.room.joinFailed;
    case 'message':
      return USER_MESSAGES.message.sendFailed('Connection issue');
    case 'connection':
      return USER_MESSAGES.connection.p2pInitFailed;
    default:
      return USER_MESSAGES.error.generic;
  }
}

export default USER_MESSAGES;