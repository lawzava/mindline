/**
 * Application State Management for Mindline
 * Centralized state management and configuration
 */

import logger from './logger.js';

// Application state
// Note: User, room, message history, and peer state now managed in WASM
export const AppState = {
  p2pConnection: null,  // WebRTC object remains in JS
  isWasmLoaded: false,
  safeWasm: null,
  draftMessages: new Map(),  // Track typing indicators from peers
  messageHistory: new Map()  // Kept for compatibility
};

// Extended application state (merged from app-state.js)
export const IndexState = {
  wasmModule: null,
  typingTimeout: null,
  initialized: false,
  reconnectAttempts: 0,
  maxReconnectAttempts: 5,
  reconnectInterval: null,
  isReconnecting: false,
  draftTimeouts: new Map()
};

// Application constants
export const CONSTANTS = {
  RECONNECT_DELAY: 2000,
  MAX_RECONNECT_ATTEMPTS: 5,
  MESSAGE_SYNC_TIMEOUT: 5000
};

// Constants for app initialization (merged from app-state.js)
export const INDEX_CONSTANTS = {
  TIMEOUT_DRAFT_CLEAR: 3000
};

// Helper functions for state management
export function getCurrentUserId() {
  // Use WASM as single source of truth
  if (window.safeWasm && window.safeWasm.get_current_user_id) {
    const userId = window.safeWasm.get_current_user_id();
    return userId || null;
  }
  return null;
}

export function getCurrentRoomId() {
  // Use WASM as single source of truth
  if (window.safeWasm && window.safeWasm.get_current_room_id) {
    const roomId = window.safeWasm.get_current_room_id();
    return roomId || null;
  }
  return null;
}

export function setCurrentUserId(userId) {
  // Store in WASM - will be updated via update_user_session
  logger.debug('Current user ID set to:', userId);
  // Note: Actual setting happens via update_user_session in user-manager.js
}

export function setCurrentRoomId(roomId) {
  // Store in WASM
  if (window.safeWasm && window.safeWasm.set_current_room_id) {
    try {
      window.safeWasm.set_current_room_id(roomId || '');
      logger.debug('Current room ID set to:', roomId);
    } catch (error) {
      logger.error('Failed to set room ID in WASM:', error);
    }
  }
}

export function getP2PConnection() {
  // P2P connection object remains in JavaScript as it's a WebRTC object
  // But peer tracking is in WASM
  return AppState.p2pConnection;
}

export function setP2PConnection(connection) {
  // P2P connection object remains in JavaScript
  // Clear peers in WASM when connection changes
  AppState.p2pConnection = connection;
  if (!connection && window.safeWasm && window.safeWasm.clear_all_connected_peers) {
    try {
      window.safeWasm.clear_all_connected_peers();
    } catch (error) {
      logger.error('Failed to clear peers in WASM:', error);
    }
  }
  logger.debug('P2P connection set');
}

export function getChatHistory(roomId) {
  // Use WASM to get messages for the room
  if (window.safeWasm && window.safeWasm.get_messages) {
    try {
      const messagesJson = window.safeWasm.get_messages(roomId);
      // Parse the JSON string returned from WASM
      const messages = messagesJson ? JSON.parse(messagesJson) : [];
      if (messages && messages.length > 0) {
        return {
          messages: messages,
          lastSync: Date.now()
        };
      }
    } catch (error) {
      logger.error('Failed to get chat history from WASM:', error);
    }
  }
  return null;
}

export function setChatHistory(roomId, history) {
  // Messages are managed in WASM, this is now a no-op
  // Messages are added via send_message and stored in WASM
  logger.debug('Chat history managed by WASM for room:', roomId);
}

export function addMessageToHistory(roomId, message) {
  // Messages are stored in WASM via send_message
  // This function is kept for compatibility but messages go directly to WASM
  logger.debug('Message stored in WASM for room:', roomId);
}

export function getMessageHistory() {
  return AppState.messageHistory;
}

export function addToMessageHistory(messageId, message) {
  AppState.messageHistory.set(messageId, message);
}

export function getDraftMessages() {
  // Use WASM as source of truth for draft messages
  if (window.safeWasm && window.safeWasm.get_draft_messages) {
    try {
      const drafts = window.safeWasm.get_draft_messages();
      if (drafts) {
        // Convert to Map for compatibility
        const draftMap = new Map();
        if (typeof drafts === 'object') {
          for (const [key, value] of Object.entries(drafts)) {
            draftMap.set(key, value);
          }
        }
        return draftMap;
      }
    } catch (error) {
      logger.error('Failed to get draft messages from WASM:', error);
    }
  }
  return new Map();
}

export function setDraftMessage(userId, message) {
  // Store draft message in WASM
  if (window.safeWasm && window.safeWasm.set_draft_message) {
    try {
      const senderName = document.getElementById('userName')?.value || 'Anonymous';
      window.safeWasm.set_draft_message(userId, message, senderName);
    } catch (error) {
      logger.error('Failed to set draft message in WASM:', error);
    }
  }
}

export function clearDraftMessage(userId) {
  // Clear draft message from WASM
  if (window.safeWasm && window.safeWasm.clear_draft_message) {
    try {
      window.safeWasm.clear_draft_message(userId);
    } catch (error) {
      logger.error('Failed to clear draft message in WASM:', error);
    }
  }
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
    return roomId || null; // Convert undefined to null
  }
  return null;
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

// UUID generation - using WASM for consistency
export function generateUUID() {
  if (window.safeWasm && window.safeWasm.generate_uuid) {
    return window.safeWasm.generate_uuid();
  }
  throw new Error('WASM UUID generation not available');
}

// App initialization functions (merged from app-state.js)
export function initializeAppState() {
  IndexState.initialized = false;
  IndexState.reconnectAttempts = 0;
  IndexState.isReconnecting = false;
  IndexState.draftTimeouts.clear();
  logger.info('Application state initialized');
}

export function resetReconnectionState() {
  IndexState.reconnectAttempts = 0;
  IndexState.isReconnecting = false;
  if (IndexState.reconnectInterval) {
    clearInterval(IndexState.reconnectInterval);
    IndexState.reconnectInterval = null;
  }
}

export function setInitialized(status) {
  IndexState.initialized = status;
  logger.debug('App initialization status:', status);
}