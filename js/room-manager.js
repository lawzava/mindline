/**
 * Room Management
 * Handles room creation, joining, and room operations
 */

import logger from './logger.js';
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
import { loadChatHistory } from './message-manager.js';
import { addRoomToHistory, generateShareableURL } from './room-history.js';
import { initializeP2P } from './p2p-manager.js';

// Room ID validation function
function isValidRoomId(id) {
  if (!id || typeof id !== 'string' || id.length < 8) {
    return false;
  }
  const validPattern = /^[a-zA-Z0-9_-]+$/;
  return validPattern.test(id);
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

    // Validate the room ID format
    if (!isValidRoomId(roomId)) {
      log(`Room ID must be at least ${CONSTANTS.MIN_ROOM_ID_LENGTH} alphanumeric characters (can include dashes and underscores)`);
      return null;
    }

    // Show connecting status
    updateConnectionStatus('connecting');

    // Create the room in the WASM module
    if (window.safeWasm) {
      window.safeWasm.create_room_with_id(roomId);
    }

    // Initialize P2P connection
    await initializeP2P(roomId);

    // Load and display chat history
    const messages = loadChatHistory(roomId);
    displayChatHistory(messages);

    // Update UI and localStorage
    updateRoomDisplay(roomId);
    localStorage.setItem('currentRoomId', roomId);
    setCurrentRoomId(roomId);

    // Add to room history
    addRoomToHistory(roomId);

    // Update connection status
    updateConnectionStatus('connected');

    // Show share room button
    const shareRoomBtn = document.getElementById('shareRoomBtn');
    if (shareRoomBtn) {
      shareRoomBtn.classList.remove('hidden');
    }

    // Scroll to bottom after room creation
    scrollChatToBottom('auto', 200);

    log(`Created and joined room: ${roomId}`);
    return roomId;
  } catch (error) {
    log(`Error creating room: ${error.message}`);
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
    log('Please enter a room ID to join');
    return null;
  }

  // Use proven JavaScript validation
  const sanitizedRoomId = String(roomId || '')
    .split('')
    .filter(c => /[a-zA-Z0-9_-]/.test(c))
    .join('');

  if (!sanitizedRoomId || sanitizedRoomId.length < 3 || sanitizedRoomId.length > 64) {
    logger.warn('Room ID validation failed:', roomId);
    log(`Room ID must be 3-64 alphanumeric characters (can include dashes and underscores)`);
    return null;
  }

  logger.info('Room ID validation passed:', sanitizedRoomId);

  // Use sanitized room ID for the rest of the function
  roomId = sanitizedRoomId;

  try {
    // Show connecting status
    updateConnectionStatus('connecting');

    // Join the room
    if (window.safeWasm) {
      const connectionToken = window.safeWasm.join_room(roomId, '{}');
    }

    // Initialize P2P connection
    await initializeP2P(roomId);

    // Load and display chat history
    const messages = loadChatHistory(roomId);
    displayChatHistory(messages);

    // Update UI and localStorage
    updateRoomDisplay(roomId);
    localStorage.setItem('currentRoomId', roomId);
    setCurrentRoomId(roomId);

    // Add to room history
    addRoomToHistory(roomId);

    // Update connection status
    updateConnectionStatus('connected');

    // Show share room button
    const shareRoomBtn = document.getElementById('shareRoomBtn');
    if (shareRoomBtn) {
      shareRoomBtn.classList.remove('hidden');
    }

    // Scroll to bottom after joining room
    scrollChatToBottom('auto', 200);

    log(`Joined room: ${roomId}`);
    return roomId;
  } catch (error) {
    log(`Error joining room: ${error.message}`);
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
    log('Invalid room ID');
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
    log(`Failed to join room: ${error.message}`);
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

  log(`Reconnection attempt ${IndexState.reconnectAttempts}/${IndexState.maxReconnectAttempts}...`);

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
    log('Reconnected successfully');

  } catch (error) {
    IndexState.isReconnecting = false;
    if (IndexState.reconnectAttempts >= IndexState.maxReconnectAttempts) {
      log(`Reconnection failed after ${IndexState.maxReconnectAttempts} attempts`);
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