/**
 * Room Management
 * Handles room creation, joining, and room operations
 */

import logger from './logger.js';
import USER_MESSAGES from './user-messages.js';
import { IndexState, resetReconnectionState } from './app-state.js';
import {
  CONSTANTS,
  getCurrentRoomId,
  setCurrentRoomId,
  generateUUID,
  getP2PConnection,
  setP2PConnection
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

// Room ID validation now uses WASM function
function isValidRoomId(id) {
  if (!window.safeWasm || !window.safeWasm.validate_room_id) {
    // Fallback if WASM not ready
    return false;
  }
  try {
    return window.safeWasm.validate_room_id(id);
  } catch (error) {
    logger.error('Room ID validation error:', error);
    return false;
  }
}

/**
 * Create a new chat room
 * @returns {string|null} The room ID or null if failed
 */
export async function createRoom() {
  try {
    // Get the user-provided room ID if available
    let roomId = document.getElementById('roomIdInput')?.value;

    // If no room ID is provided, generate a UUID
    if (!roomId) {
      roomId = generateUUID();
    }

    // Validate the room ID format using WASM
    if (!isValidRoomId(roomId)) {
      log(USER_MESSAGES.room.invalidFormat);
      return null;
    }

    // Show connecting status
    updateConnectionStatus('connecting');

    // Store messages with user-specific keys to prevent cross-user contamination
    const currentUserId = localStorage.getItem('userId');

    // Create the room in the WASM module
    if (window.safeWasm) {
      window.safeWasm.create_room_with_id(roomId);
    }

    // Initialize P2P connection (non-fatal - room works even if P2P fails)
    let p2pConnected = false;
    try {
      await initializeP2P(roomId);
      p2pConnected = true;
    } catch (p2pError) {
      logger.warn('P2P initialization failed (non-fatal):', p2pError);
      // Continue with room creation even if P2P fails
    }

    // Load and display chat history (will be empty if we cleared it)
    const messages = retrieveMessages(roomId);
    displayChatHistory(messages);

    // Update UI and localStorage
    updateRoomDisplay(roomId);
    localStorage.setItem('currentRoomId', roomId);
    setCurrentRoomId(roomId);

    // Add to room history
    addRoomToHistory(roomId);

    // Update connection status based on P2P
    // Show 'local' when room is joined but P2P is not connected (still functional for local messages)
    updateConnectionStatus(p2pConnected ? 'connected' : 'local');

    // Show share room button
    const shareRoomBtn = document.getElementById('shareRoomBtn');
    if (shareRoomBtn) {
      shareRoomBtn.classList.remove('hidden');
    }

    // Scroll to bottom after room creation
    scrollChatToBottom('auto', 200);

    log(USER_MESSAGES.room.created(roomId));
    return roomId;
  } catch (error) {
    logger.error('Error creating room:', error);
    log(USER_MESSAGES.room.createFailed);
    updateConnectionStatus('failed');
    return null;
  }
}

/**
 * Join an existing chat room
 * @param {string} roomId - Room ID to join
 * @returns {string|null} The room ID or null if failed
 */
export async function joinRoom(roomId) {
  logger.info('joinRoom called with roomId:', roomId);

  if (!roomId) {
    log(USER_MESSAGES.room.enterRoomId);
    return null;
  }

  // Use WASM validation
  if (!window.safeWasm || !window.safeWasm.validate_room_id) {
    logger.error('WASM validation not available');
    log(USER_MESSAGES.room.validationNotReady);
    return null;
  }

  try {
    const isValid = window.safeWasm.validate_room_id(roomId);
    if (!isValid) {
      logger.warn('Room ID validation failed:', roomId);
      log(USER_MESSAGES.room.invalidFormat);
      return null;
    }
    logger.info('Room ID validation passed:', roomId);
  } catch (error) {
    logger.error('Room ID validation error:', error);
    log(USER_MESSAGES.room.joinFailed);
    return null;
  }

  try {
    // Show connecting status
    updateConnectionStatus('connecting');

    // Store messages with user-specific keys to prevent cross-user contamination
    const currentUserId = localStorage.getItem('userId');

    // Join the room
    if (window.safeWasm) {
      const connectionToken = window.safeWasm.join_room(roomId, '{}');
    }

    // Initialize P2P connection (non-fatal - room works even if P2P fails)
    let p2pConnected = false;
    try {
      await initializeP2P(roomId);
      p2pConnected = true;
    } catch (p2pError) {
      logger.warn('P2P initialization failed (non-fatal):', p2pError);
      // Continue with room join even if P2P fails
    }

    // Load and display chat history (will be empty if we cleared it)
    const messages = retrieveMessages(roomId);
    displayChatHistory(messages);

    // Update UI and localStorage
    updateRoomDisplay(roomId);
    localStorage.setItem('currentRoomId', roomId);
    setCurrentRoomId(roomId);

    // Add to room history
    addRoomToHistory(roomId);

    // Update connection status based on P2P
    // Show 'local' when room is joined but P2P is not connected (still functional for local messages)
    updateConnectionStatus(p2pConnected ? 'connected' : 'local');

    // Show share room button
    const shareRoomBtn = document.getElementById('shareRoomBtn');
    if (shareRoomBtn) {
      shareRoomBtn.classList.remove('hidden');
    }

    // Scroll to bottom after joining room
    scrollChatToBottom('auto', 200);

    log(USER_MESSAGES.room.joined(roomId));
    return roomId;
  } catch (error) {
    logger.error('Error joining room:', error);
    log(USER_MESSAGES.room.joinFailed);
    updateConnectionStatus('failed');
    return null;
  }
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