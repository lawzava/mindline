/**
 * User Management
 * Handles user initialization, restoration, and state management
 */

import logger from './logger.js';
import {
  getCurrentUserId,
  generateUUID,
  setCurrentUserId,
  setCurrentRoomId
} from './state.js';
import { log } from './ui.js';

/**
 * Ensure user is initialized for operations
 */
export async function ensureUserInitialized() {
  const userId = getCurrentUserId();
  if (!userId || userId === 'Not initialized') {
    // Initialize user if not already done
    const userName = document.getElementById('userName')?.value || 'Anonymous';
    const newUserId = generateUUID();

    try {
      if (window.safeWasm) {
        window.safeWasm.initialize(userName, newUserId);
        window.safeWasm.set_message_manager_user(newUserId);
        // Also update state API
        window.safeWasm.update_user_session(userName, newUserId);
      }

      // Update tooltip with user ID
      const userIdTooltip = document.getElementById('userIdTooltip');
      if (userIdTooltip) {
        userIdTooltip.textContent = newUserId;
      }

      // Update both desktop and mobile inputs
      const userNameInput = document.getElementById('userName');
      const mobileUserNameInput = document.getElementById('userNameMobile');

      if (userNameInput) userNameInput.value = userName;
      if (mobileUserNameInput) mobileUserNameInput.value = userName;

      // Store both username and user ID
      localStorage.setItem('userName', userName);
      localStorage.setItem('userId', newUserId);

      log(`Auto-initialized user for room join: ${userName} with ID: ${newUserId}`);
    } catch (error) {
      logger.error("Could not initialize user:", error);
      log(`Error initializing user: ${error.message}`);
      throw error;
    }
  }
}

/**
 * Restore user state from localStorage
 */
export async function restoreUserState() {
  if (!window.safeWasm) {
    logger.warn("Safe WASM proxies not created yet, cannot restore state safely");
    return;
  }

  // Initialize user if needed
  restoreUserInfo();

  // Don't auto-restore room connection - user should manually rejoin
  // This prevents aggressive setInterval loops from starting on every page load
  // await restoreRoomConnection();
}

/**
 * Restore user information from localStorage
 */
export function restoreUserInfo() {
  const userIdTooltip = document.getElementById('userIdTooltip');
  const userIdText = userIdTooltip ? userIdTooltip.textContent.trim() : 'Not initialized';

  // Check if user needs initialization (handle HTML whitespace)
  const needsInitialization = userIdText.includes('Not') || userIdText.includes('initialized');

  if (needsInitialization) {
    try {
      // Restore both username and user ID from localStorage
      const savedUserName = localStorage.getItem('userName');
      const savedUserId = localStorage.getItem('userId');

      if (savedUserName && savedUserId) {
        // Restore saved user data
        if (window.safeWasm) {
          window.safeWasm.initialize(savedUserName, savedUserId);
          window.safeWasm.set_message_manager_user(savedUserId);
          // Also update state API
          window.safeWasm.update_user_session(savedUserName, savedUserId);
        }

        if (userIdTooltip) {
          userIdTooltip.textContent = savedUserId;
        }

        const userNameInput = document.getElementById('userName');
        const mobileUserNameInput = document.getElementById('userNameMobile');

        if (userNameInput) userNameInput.value = savedUserName;
        if (mobileUserNameInput) mobileUserNameInput.value = savedUserName;

        log(`Restored user: ${savedUserName} with ID: ${savedUserId}`);
        return;
      }

      // No saved data, initialize with current values or defaults
      const userName = document.getElementById('userName')?.value || 'Anonymous';
      const userId = generateUUID();

      if (window.safeWasm) {
        window.safeWasm.initialize(userName, userId);
        window.safeWasm.set_message_manager_user(userId);
        // Also update state API
        window.safeWasm.update_user_session(userName, userId);
      }

      if (userIdTooltip) {
        userIdTooltip.textContent = userId;
      }

      // Update both desktop and mobile inputs
      const userNameInput = document.getElementById('userName');
      const mobileUserNameInput = document.getElementById('userNameMobile');

      if (userNameInput) userNameInput.value = userName;
      if (mobileUserNameInput) mobileUserNameInput.value = userName;

      // Store both username and user ID
      localStorage.setItem('userName', userName);
      localStorage.setItem('userId', userId);

      log(`Initialized new user: ${userName} with ID: ${userId}`);
    } catch (error) {
      logger.error("Could not initialize user:", error);
      log(`Error initializing user: ${error.message}`);
    }
  }
}

/**
 * Restore room connection from localStorage
 */
async function restoreRoomConnection() {
  const savedRoomId = localStorage.getItem('currentRoomId');
  if (savedRoomId) {
    try {
      logger.info('Attempting to restore room connection:', savedRoomId);

      // Actually join the room to establish P2P connection
      const { joinRoom } = await import('./room-manager.js');
      await joinRoom(savedRoomId);

      logger.info('Successfully restored room connection:', savedRoomId);
    } catch (error) {
      logger.error('Error restoring room connection:', error);
      // Clear saved room ID if connection fails
      localStorage.removeItem('currentRoomId');
      setCurrentRoomId(null);
    }
  }
}

/**
 * Handle user initialization from UI
 * @param {string} userName - User name (optional)
 */
export function handleInitializeUser(userName = null) {
  try {
    // Get the user name from parameter or input field
    const finalUserName = userName || document.getElementById('userName')?.value || 'Anonymous';

    // Generate new user ID
    const userId = generateUUID();

    // Initialize WASM with user data
    if (window.safeWasm) {
      window.safeWasm.initialize(finalUserName, userId);
      window.safeWasm.set_message_manager_user(userId);
      // Also update state API
      window.safeWasm.update_user_session(finalUserName, userId);
    }

    // Update UI elements
    const userIdTooltip = document.getElementById('userIdTooltip');
    if (userIdTooltip) {
      userIdTooltip.textContent = userId;
    }

    // Update both desktop and mobile inputs
    const userNameInput = document.getElementById('userName');
    const mobileUserNameInput = document.getElementById('userNameMobile');

    if (userNameInput) userNameInput.value = finalUserName;
    if (mobileUserNameInput) mobileUserNameInput.value = finalUserName;

    // Store in localStorage
    localStorage.setItem('userName', finalUserName);
    localStorage.setItem('userId', userId);

    // Update state
    setCurrentUserId(userId);

    log(`User initialized: ${finalUserName} (${userId})`);

    // Show initialization status
    const initStatus = document.getElementById('initStatus');
    const initStatusMobile = document.getElementById('initStatusMobile');

    if (initStatus) {
      initStatus.textContent = 'Ready to chat!';
      initStatus.classList.remove('hidden');
      setTimeout(() => initStatus.classList.add('hidden'), 2000);
    }

    if (initStatusMobile) {
      initStatusMobile.textContent = 'Ready to chat!';
      initStatusMobile.classList.remove('hidden');
      setTimeout(() => initStatusMobile.classList.add('hidden'), 2000);
    }

  } catch (error) {
    logger.error('Error initializing user:', error);
    log(`Error initializing user: ${error.message}`);
  }
}

/**
 * Show user connection notification
 * @param {string} userName - Name of the user who connected
 */
export function showUserConnectionNotification(userName) {
  if (!userName) return;

  // Show a subtle notification
  if (window.toastManager) {
    window.toastManager.show(`${userName} joined the room`, 'info', 3000);
  } else {
    log(`${userName} joined the room`);
  }
}

// Global function for HTML handlers
window.handleInitializeUser = handleInitializeUser;