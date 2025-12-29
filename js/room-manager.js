/**
 * Room Management
 * Handles room creation, joining, and room operations
 */

import logger from './logger.js';
import USER_MESSAGES from './user-messages.js';
import {
  CONSTANTS,
  getCurrentRoomId,
  setCurrentRoomId,
  generateUUID,
  getP2PConnection,
  setP2PConnection,
  IndexState,
  resetReconnectionState
} from './state.js';
import {
  log,
  updateConnectionStatus,
  updateRoomDisplay,
  displayChatHistory,
  scrollChatToBottom
} from './ui.js';
import { loadChatHistory, retrieveMessages } from './message-manager.js';
import { addRoomToHistory, generateShareableURL } from './room-history.js';
import { initializeP2P } from './p2p-manager.js';

/**
 * Enter a room (create if it doesn't exist, or join if it does)
 * This is the unified function that handles both create and join operations
 * @param {string|null} roomId - Room ID to join/create (null to auto-generate)
 * @param {Object} options - Options for entering the room
 * @param {boolean} options.isCreate - Whether this is a create operation (affects logging)
 * @returns {string|null} The room ID or null if failed
 */
async function enterRoom(roomId = null, { isCreate = false } = {}) {
  // If no room ID, generate one (create operation)
  if (!roomId) {
    roomId = generateUUID();
    isCreate = true;
  }

  // Validate room ID
  if (!window.safeWasm?.validate_room_id) {
    logger.error('WASM validation not available');
    log(USER_MESSAGES.room.validationNotReady);
    return null;
  }

  try {
    if (!window.safeWasm.validate_room_id(roomId)) {
      logger.warn('Room ID validation failed:', roomId);
      log(USER_MESSAGES.room.invalidFormat);
      return null;
    }
  } catch (error) {
    logger.error('Room ID validation error:', error);
    log(USER_MESSAGES.room.joinFailed);
    return null;
  }

  try {
    updateConnectionStatus('connecting');

    // Register room in WASM (create_room_with_id and join_room are now equivalent)
    if (window.safeWasm) {
      if (isCreate) {
        window.safeWasm.create_room_with_id(roomId);
      } else {
        window.safeWasm.join_room(roomId, '{}');
      }
    }

    // Initialize P2P (non-fatal)
    let p2pConnected = false;
    try {
      await initializeP2P(roomId);
      p2pConnected = true;
    } catch (p2pError) {
      logger.warn('P2P initialization failed (non-fatal):', p2pError);
    }

    // Load and display chat history
    const messages = retrieveMessages(roomId);
    displayChatHistory(messages);

    // Update state
    updateRoomDisplay(roomId);
    localStorage.setItem('currentRoomId', roomId);
    setCurrentRoomId(roomId);
    addRoomToHistory(roomId);

    // Update UI
    updateConnectionStatus(p2pConnected ? 'connected' : 'local');
    document.getElementById('shareRoomBtn')?.classList.remove('hidden');
    scrollChatToBottom('auto', 200);

    log(isCreate ? USER_MESSAGES.room.created(roomId) : USER_MESSAGES.room.joined(roomId));
    return roomId;
  } catch (error) {
    logger.error(`Error ${isCreate ? 'creating' : 'joining'} room:`, error);
    log(isCreate ? USER_MESSAGES.room.createFailed : USER_MESSAGES.room.joinFailed);
    updateConnectionStatus('failed');
    return null;
  }
}

/**
 * Create a new chat room
 * @returns {string|null} The room ID or null if failed
 */
export async function createRoom() {
  const roomId = document.getElementById('roomIdInput')?.value || null;
  return enterRoom(roomId, { isCreate: true });
}

/**
 * Join an existing chat room
 * @param {string} roomId - Room ID to join
 * @returns {string|null} The room ID or null if failed
 */
export async function joinRoom(roomId) {
  if (!roomId) {
    log(USER_MESSAGES.room.enterRoomId);
    return null;
  }
  return enterRoom(roomId, { isCreate: false });
}

/**
 * Join room from history
 * @param {string} roomId - Room ID to join
 */
export async function joinRoomFromHistory(roomId) {
  if (!roomId) {
    log(USER_MESSAGES.room.invalidFormat);
    return;
  }

  try {
    // Clear any existing room input
    const roomIdInput = document.getElementById('roomIdInput');
    if (roomIdInput) {
      roomIdInput.value = '';
    }

    // Join the room
    await joinRoom(roomId);
  } catch (error) {
    logger.error('Error joining room from history:', error);
    log(USER_MESSAGES.room.joinFailed);
  }
}

/**
 * Attempt to reconnect P2P connection
 */
export async function attemptReconnect() {
  const roomId = getCurrentRoomId();
  if (!roomId || IndexState.isReconnecting) {
    return;
  }

  IndexState.isReconnecting = true;
  IndexState.reconnectAttempts++;

  log(USER_MESSAGES.connection.reconnecting(IndexState.reconnectAttempts, IndexState.maxReconnectAttempts));

  // Update status to show reconnecting
  const statusElement = document.getElementById('connectionStatus');
  if (statusElement) {
    statusElement.textContent = `Reconnecting... (${IndexState.reconnectAttempts}/${IndexState.maxReconnectAttempts})`;
    statusElement.className = 'block w-full px-3 py-2 text-xs font-bold uppercase border-2 border-black dark:border-white tracking-wider text-center status-reconnecting';
  }

  try {
    // Clean up existing connection properly before reconnecting
    const existingConnection = getP2PConnection();
    if (existingConnection) {
      existingConnection.disconnect();
      setP2PConnection(null);
    }

    // Wait for cleanup
    const delay = Math.min(1000 * Math.pow(1.2, IndexState.reconnectAttempts - 1), 5000);
    await new Promise(resolve => setTimeout(resolve, delay));

    // Try to reconnect
    await initializeP2P(roomId);

    // Success - reset reconnection state
    IndexState.reconnectAttempts = 0;
    IndexState.isReconnecting = false;
    if (IndexState.reconnectInterval) {
      clearInterval(IndexState.reconnectInterval);
      IndexState.reconnectInterval = null;
    }

    updateConnectionStatus('connected');
    log(USER_MESSAGES.connection.reconnected);

  } catch (error) {
    IndexState.isReconnecting = false;
    if (IndexState.reconnectAttempts >= IndexState.maxReconnectAttempts) {
      log(USER_MESSAGES.connection.reconnectFailed);
      updateConnectionStatus('failed');
      if (IndexState.reconnectInterval) {
        clearInterval(IndexState.reconnectInterval);
        IndexState.reconnectInterval = null;
      }
    } else {
      log(`Reconnection attempt ${IndexState.reconnectAttempts} failed, will retry...`);
      updateConnectionStatus('reconnecting');
    }
  }
}

/**
 * Start automatic reconnection attempts
 */
export function startReconnectionAttempts() {
  if (!IndexState.isReconnecting && IndexState.reconnectAttempts < IndexState.maxReconnectAttempts) {
    if (!IndexState.reconnectInterval) {
      IndexState.reconnectInterval = setInterval(attemptReconnect, 8000); // Less aggressive - every 8 seconds
    }
  }
}

/**
 * Handle connection loss and start reconnection
 */
export function handleConnectionLoss() {
  updateConnectionStatus('reconnecting');
  if (!IndexState.isReconnecting && IndexState.reconnectAttempts < IndexState.maxReconnectAttempts) {
    IndexState.reconnectInterval = setInterval(attemptReconnect, 8000); // Try every 8 seconds
  }
}

/**
 * Share room by ID
 * @param {string} roomId - Room ID to share
 */
export async function shareRoomById(roomId) {
  if (!roomId) {
    log('No room to share');
    return;
  }

  try {
    const shareUrl = generateShareableURL(roomId);

    // Try to use Web Share API if available
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Join my Mindline chat room',
          text: `Join my secure P2P chat room: ${roomId}`,
          url: shareUrl,
        });
        return;
      } catch (shareError) {
        // Fall back to clipboard if share was cancelled or failed
        if (shareError.name !== 'AbortError') {
          logger.warn('Web Share API failed:', shareError);
        }
      }
    }

    // Fallback: Copy to clipboard
    try {
      await navigator.clipboard.writeText(shareUrl);
      if (window.toastManager) {
        window.toastManager.show('Room link copied to clipboard!', 'success', 3000);
      } else {
        log('Room link copied to clipboard!');
      }
    } catch (clipboardError) {
      logger.warn('Clipboard API failed:', clipboardError);

      // Final fallback: Show URL in a prompt
      prompt('Copy this room link to share:', shareUrl);
    }
  } catch (error) {
    logger.error('Error sharing room:', error);
    log('Failed to share room link');
  }
}

/**
 * Share current room
 */
export async function shareCurrentRoom() {
  const roomId = getCurrentRoomId();
  if (!roomId) {
    log('Join a room first to share it');
    return;
  }

  await shareRoomById(roomId);
}

/**
 * Connect new UI elements to WASM functions
 */
export function connectNewUIWithWasm() {
  // Show share room button if in a room
  const roomId = getCurrentRoomId();
  const shareRoomBtn = document.getElementById('shareRoomBtn');

  if (shareRoomBtn) {
    if (roomId) {
      shareRoomBtn.classList.remove('hidden');
    } else {
      shareRoomBtn.classList.add('hidden');
    }
  }

  // Update connection section visibility
  const connectionSection = document.getElementById('connectionSection');
  if (connectionSection) {
    if (roomId) {
      connectionSection.classList.remove('hidden');
    } else {
      connectionSection.classList.add('hidden');
    }
  }
}

// Global functions for HTML handlers
window.joinRoom = joinRoom;
window.joinRoomFromHistory = joinRoomFromHistory;
window.shareRoomById = shareRoomById;
window.shareCurrentRoom = shareCurrentRoom;