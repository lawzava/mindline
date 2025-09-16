/**
 * Application State Management
 * Manages the extended application state for the main app
 */

import logger from './logger.js';

// Extended application state for index.js specific properties
export const IndexState = {
  wasmModule: null,
  typingTimeout: null,
  initialized: false,
  reconnectAttempts: 0,
  maxReconnectAttempts: 5,
  reconnectInterval: null,
  isReconnecting: false,
  draftTimeouts: new Map() // Track timeouts for clearing stale drafts
};

// Additional constants for the app
export const INDEX_CONSTANTS = {
  TIMEOUT_DRAFT_CLEAR: 10000 // Clear draft after 10 seconds of inactivity
};

/**
 * Initialize the application state
 */
export function initializeAppState() {
  IndexState.initialized = false;
  IndexState.reconnectAttempts = 0;
  IndexState.isReconnecting = false;
  IndexState.draftTimeouts.clear();
  logger.info('Application state initialized');
}

/**
 * Reset reconnection state
 */
export function resetReconnectionState() {
  IndexState.reconnectAttempts = 0;
  IndexState.isReconnecting = false;
  if (IndexState.reconnectInterval) {
    clearInterval(IndexState.reconnectInterval);
    IndexState.reconnectInterval = null;
  }
}

/**
 * Update initialization status
 */
export function setInitialized(status) {
  IndexState.initialized = status;
  logger.debug('App initialization status:', status);
}