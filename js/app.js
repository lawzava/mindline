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
  AppState
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
import { IndexState, INDEX_CONSTANTS, initializeAppState, setInitialized } from './app-state.js';
import { updateRoomHistoryUI } from './room-history.js';
import { loadWasmModule, createSafeWasmProxies } from './wasm-manager.js';
import { loadChatHistory } from './message-manager.js';
import { setupEventHandlers } from './event-handlers.js';
import { initializeTheme } from './theme-manager.js';
import { initializeDebugMode } from './debug-utils.js';
import { restoreUserState, ensureUserInitialized } from './user-manager.js';
import { joinRoom, connectNewUIWithWasm } from './room-manager.js';

/**
 * Main application initialization
 */
async function initializeApp() {
  try {
    // Initialize application state
    initializeAppState();

    // Initialize theme preference
    initializeTheme();

    // Initialize debug mode
    initializeDebugMode();

    // Load WASM module first
    await loadWasmModule();
    createSafeWasmProxies();

    // Initialize Rust logger
    const isDevelopment = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const debugEnabled = localStorage.getItem('debugEnabled') === 'true';

    if (window.safeWasm && window.safeWasm.initialize_logger) {
      window.safeWasm.initialize_logger(isDevelopment, debugEnabled);
      log("Rust logger initialized");
    }

    // Start performance monitoring
    if (window.safeWasm && window.safeWasm.start_performance_monitoring) {
      try {
        window.safeWasm.start_performance_monitoring();
        log("Performance monitoring started");

        // Record initial metrics
        if (window.safeWasm.record_performance_metric) {
          try {
            window.safeWasm.record_performance_metric('app_start', Date.now());
            window.safeWasm.record_performance_metric('memory_usage', performance.memory ? performance.memory.usedJSHeapSize : 0);
          } catch (metricError) {
            logger.warn('Could not record initial metrics:', metricError);
          }
        }
      } catch (perfError) {
        logger.warn('Could not start performance monitoring:', perfError);
      }
    }

    // Restore user state
    await restoreUserState();

    // Set initial log context
    const userId = getCurrentUserId();
    let roomId = getCurrentRoomId();
    if (window.safeWasm && window.safeWasm.set_log_context) {
      window.safeWasm.set_log_context(userId, roomId, 'core');
    }

    // Connect UI elements
    connectNewUIWithWasm();

    // Update room history UI after user state is restored
    updateRoomHistoryUI();

    // Initialize event handlers
    setupEventHandlers();

    // Check for room ID in URL and auto-join if present
    const urlRoomId = getRoomFromURL();
    logger.info('URL Room ID detected:', urlRoomId);

    if (urlRoomId) {
      logger.info('Attempting to auto-join room from URL:', urlRoomId);

      // Ensure user is initialized before joining room
      await ensureUserInitialized();
      logger.debug('User initialized for URL room join');

      // Auto-join the room
      try {
        logger.debug('Calling joinRoom with URL room ID:', urlRoomId);
        await joinRoom(urlRoomId);
        logger.info('Successfully joined room from URL');

        // Clean up URL after successful join (optional)
        const newURL = `${window.location.protocol}//${window.location.host}${window.location.pathname}`;
        window.history.replaceState({}, document.title, newURL);
      } catch (error) {
        logger.error('Failed to auto-join room from URL:', error);
        log(`Failed to auto-join room from URL: ${error.message}`);
      }
    } else {
      console.log('No room ID found in URL');
    }

    // Update connection status based on restored room state
    roomId = getCurrentRoomId();
    if (roomId) {
      // A room was restored, but we need to verify P2P connection
      const p2pConnection = getP2PConnection();
      updateConnectionStatus(p2pConnection ? 'connected' : 'connecting');
    } else {
      updateConnectionStatus('disconnected');
    }

    // Initialize room history UI (with small delay to ensure DOM is ready)
    setTimeout(() => {
      updateRoomHistoryUI();
    }, 100);

    // Ensure chat is scrolled to bottom after full initialization
    if (roomId) {
      scrollChatToBottom('auto', 500);
    }

    setInitialized(true);
    log('Application initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize application:', error);
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