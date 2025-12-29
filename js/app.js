/**
 * Main Application Entry Point
 * Orchestrates the initialization of all modules
 */

import '../css/main.css';
import { P2PConnection } from './webrtc.js';
import logger from './logger.js';

// Import state management
import {
  CONSTANTS,
  getCurrentUserId,
  getCurrentRoomId,
  setCurrentUserId,
  setCurrentRoomId,
  generateUUID,
  getRoomFromURL,
  updateURLWithRoom,
  setP2PConnection,
  getP2PConnection,
  AppState,
  IndexState,
  INDEX_CONSTANTS,
  initializeAppState,
  setInitialized
} from './state.js';

// Import UI utilities
import {
  log,
  displayMessage,
  scrollChatToBottom,
  updateConnectionStatus,
  updateRoomDisplay,
  clearMessageInput,
  showToast,
  displayChatHistory,
  updateDraftsDisplay
} from './ui.js';

// Import module managers
import { updateRoomHistoryUI } from './room-history.js';
import { loadWasmModule, createSafeWasmProxies } from './wasm-manager.js';
import { loadChatHistory } from './message-manager.js';
import { setupEventHandlers } from './event-handlers.js';
import { initializeTheme } from './theme-manager.js';
import { initializeDebugMode } from './debug-utils.js';
import { restoreUserState, ensureUserInitialized } from './user-manager.js';
import { joinRoom, connectNewUIWithWasm } from './room-manager.js';

/**
 * Initialize WASM and logger
 */
function initializeWasm() {
  const isDevelopment = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  const debugEnabled = localStorage.getItem('debugEnabled') === 'true';

  if (window.safeWasm?.initialize_logger) {
    window.safeWasm.initialize_logger(isDevelopment, debugEnabled);
  }
  if (window.safeWasm?.start_performance_monitoring) {
    window.safeWasm.start_performance_monitoring();
  }
}

/**
 * Handle room initialization (URL join or restore)
 */
async function handleRoomInit() {
  const urlRoomId = getRoomFromURL();

  if (urlRoomId) {
    await ensureUserInitialized();
    try {
      await joinRoom(urlRoomId);
      // Clean up URL
      window.history.replaceState({}, document.title, window.location.pathname);
    } catch (error) {
      logger.error('Failed to auto-join room:', error);
    }
  } else {
    const roomId = getCurrentRoomId();
    if (roomId) {
      const messages = loadChatHistory(roomId);
      displayChatHistory(messages);
      updateRoomDisplay(roomId);
      updateConnectionStatus('local');
      scrollChatToBottom('auto', 500);
    } else {
      updateConnectionStatus('disconnected');
    }
  }
}

/**
 * Main application initialization
 */
async function initializeApp() {
  try {
    // Step 1: Core setup
    initializeAppState();
    initializeTheme();
    initializeDebugMode();

    // Step 2: WASM initialization
    await loadWasmModule();
    createSafeWasmProxies();
    initializeWasm();

    // Step 3: User and UI setup
    await restoreUserState();
    connectNewUIWithWasm();
    setupEventHandlers();

    // Step 4: Room initialization
    await handleRoomInit();

    // Step 5: Finalize
    updateRoomHistoryUI();
    setInitialized(true);
    log('App initialized');
  } catch (error) {
    logger.error('Failed to initialize:', error);
  }
}

// All functions have been successfully moved to appropriate modules

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', initializeApp);

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  const p2pConnection = getP2PConnection();
  if (p2pConnection) {
    p2pConnection.disconnect();
  }
});

// For now, re-export the main functions that other modules need
// These will be properly organized in the next iteration
export { initializeApp };

// Import retrieveMessages for testing
import { retrieveMessages } from './message-manager.js';

// Make these functions available globally for testing
window.displayChatHistory = displayChatHistory;
window.displayMessage = displayMessage;
window.getCurrentUserId = getCurrentUserId;
window.retrieveMessages = retrieveMessages;