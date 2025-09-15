/**
 * Application State Management for Mindline
 * Centralized state management and configuration
 */

import logger from './logger.js';

// Application state
export const AppState = {
  currentUserId: null,
  currentRoomId: null,
  p2pConnection: null,
  chatHistory: new Map(),
  messageHistory: new Map(),
  draftMessages: new Map(),
  isWasmLoaded: false,
  safeWasm: null
};

// Application constants
export const CONSTANTS = {
  MIN_ROOM_ID_LENGTH: 8,
  MAX_MESSAGE_LENGTH: 2000,
  MAX_USERNAME_LENGTH: 32,
  RECONNECT_DELAY: 2000,
  MAX_RECONNECT_ATTEMPTS: 5,
  MESSAGE_SYNC_TIMEOUT: 5000
};

// Helper functions for state management
export function getCurrentUserId() {
  if (AppState.currentUserId) {
    return AppState.currentUserId;
  }

  // Try to get from DOM element
  const userIdElement = document.getElementById('userIdTooltip');
  if (userIdElement && userIdElement.textContent) {
    const userId = userIdElement.textContent.trim();
    if (userId && !userId.includes('Not') && !userId.includes('initialized')) {
      AppState.currentUserId = userId;
      return userId;
    }
  }

  return null;
}

export function getCurrentRoomId() {
  return AppState.currentRoomId;
}

export function setCurrentUserId(userId) {
  AppState.currentUserId = userId;
  logger.debug('Current user ID set to:', userId);
}

export function setCurrentRoomId(roomId) {
  AppState.currentRoomId = roomId;
  logger.debug('Current room ID set to:', roomId);
}

export function getP2PConnection() {
  return AppState.p2pConnection;
}

export function setP2PConnection(connection) {
  AppState.p2pConnection = connection;
  logger.debug('P2P connection set');
}

export function getChatHistory(roomId) {
  return AppState.chatHistory.get(roomId);
}

export function setChatHistory(roomId, history) {
  AppState.chatHistory.set(roomId, history);
  logger.debug('Chat history set for room:', roomId);
}

export function addMessageToHistory(roomId, message) {
  const roomHistory = AppState.chatHistory.get(roomId);
  if (!roomHistory) {
    AppState.chatHistory.set(roomId, {
      messages: [message],
      lastSync: 0
    });
  } else {
    // Check if message already exists (avoid duplicates)
    const exists = roomHistory.messages.some(msg => msg.id === message.id);
    if (!exists) {
      roomHistory.messages.push(message);
      // Sort messages by timestamp
      roomHistory.messages.sort((a, b) => a.timestamp - b.timestamp);
    }
  }
  logger.debug('Message added to history for room:', roomId);
}

export function getMessageHistory() {
  return AppState.messageHistory;
}

export function addToMessageHistory(messageId, message) {
  AppState.messageHistory.set(messageId, message);
}

export function getDraftMessages() {
  return AppState.draftMessages;
}

export function setDraftMessage(userId, message) {
  AppState.draftMessages.set(userId, message);
}

export function clearDraftMessage(userId) {
  AppState.draftMessages.delete(userId);
}

export function isWasmLoaded() {
  return AppState.isWasmLoaded;
}

export function setWasmLoaded(loaded) {
  AppState.isWasmLoaded = loaded;
  logger.debug('WASM loaded state set to:', loaded);
}

export function getSafeWasm() {
  return AppState.safeWasm;
}

export function setSafeWasm(safeWasm) {
  AppState.safeWasm = safeWasm;
  window.safeWasm = safeWasm; // Make globally available
  logger.debug('Safe WASM proxy set');
}

// URL helper functions - now using WASM
export function getURLParams() {
  return new URLSearchParams(window.location.search);
}

export function getRoomFromURL() {
  if (window.safeWasm && window.safeWasm.get_room_from_url) {
    const roomId = window.safeWasm.get_room_from_url();
    logger.debug('getRoomFromURL - WASM result:', roomId);
    return roomId;
  } else {
    // Fallback to JavaScript implementation
    const params = getURLParams();
    const roomId = params.get('r');
    logger.debug('getRoomFromURL - JS fallback, URL search:', window.location.search);
    logger.debug('getRoomFromURL - JS fallback, parsed room ID:', roomId);
    return roomId;
  }
}

export function updateURLWithRoom(roomId) {
  if (window.safeWasm && window.safeWasm.update_url_with_room) {
    if (roomId) {
      try {
        window.safeWasm.update_url_with_room(roomId);
        logger.debug('URL updated with room ID via WASM:', roomId);
      } catch (error) {
        logger.error('WASM URL update failed, using fallback:', error);
        // Fallback to JavaScript implementation
        const newUrl = `${window.location.pathname}?r=${encodeURIComponent(roomId)}`;
        window.history.replaceState(null, '', newUrl);
        logger.debug('URL updated with room ID via JS fallback:', roomId);
      }
    }
  } else {
    // Fallback to JavaScript implementation
    if (roomId) {
      const newUrl = `${window.location.pathname}?r=${encodeURIComponent(roomId)}`;
      window.history.replaceState(null, '', newUrl);
      logger.debug('URL updated with room ID via JS fallback:', roomId);
    }
  }
}

// UUID generation - JavaScript primary for cross-browser stability
export function generateUUID() {
  // Use JavaScript UUID for maximum browser compatibility
  // WASM UUID will be re-enabled once cross-browser serialization is resolved
  try {
    return crypto.randomUUID();
  } catch (error) {
    logger.error('JavaScript UUID generation failed:', error);
    // Fallback to manual UUID generation
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c == 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }
}