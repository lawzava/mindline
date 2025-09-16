/**
 * Event Handlers
 * Manages UI event listeners and user interactions
 */

import logger from './logger.js';
import { toggleTheme } from './theme-manager.js';
import { generateUUID } from './state.js';

// Store references to handlers and state
let initDebounceTimeout = null;
let lastInitializedName = '';

/**
 * Setup all event handlers for the application
 */
export function setupEventHandlers() {
  setupThemeToggle();
  setupUserNameHandlers();
  setupRoomManagement();
  setupMessageHandlers();
  setupShareButton();
  setupDebugHandlers();
}

/**
 * Setup theme toggle functionality
 */
function setupThemeToggle() {
  const themeToggleBtn = document.getElementById('themeToggleBtn');
  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', toggleTheme);
  } else {
    logger.warn('themeToggleBtn element not found');
  }
}

/**
 * Setup user name input handlers
 */
function setupUserNameHandlers() {
  const userNameInput = document.getElementById('userName');
  if (userNameInput) {
    const handleUserNameChange = (event) => {
      const userName = event.target.value.trim();
      logger.debug(`Username changed to: ${userName} (event: ${event.type})`);

      // Clear existing timeout
      if (initDebounceTimeout) {
        clearTimeout(initDebounceTimeout);
      }

      // Debounce the initialization to avoid too many re-inits
      initDebounceTimeout = setTimeout(() => {
        if (userName && userName !== lastInitializedName) {
          logger.debug(`Re-initializing user with name: ${userName} (previous: ${lastInitializedName})`);

          // Force clear localStorage before re-initializing to ensure Firefox compatibility
          localStorage.removeItem('userId');
          localStorage.removeItem('userName');

          // Force a new initialization
          if (window.handleInitializeUser) {
            window.handleInitializeUser(userName);
          }
          lastInitializedName = userName;
        }
      }, 300);
    };

    // Add multiple event listeners for better browser compatibility
    userNameInput.addEventListener('input', handleUserNameChange);
    userNameInput.addEventListener('change', handleUserNameChange);
    userNameInput.addEventListener('blur', handleUserNameChange);
    userNameInput.addEventListener('keyup', handleUserNameChange);

    // Store initial value to track changes
    lastInitializedName = userNameInput.value.trim();
  } else {
    logger.warn('userName element not found');
  }

  // Sync mobile and desktop username inputs
  const userNameMobile = document.getElementById('userNameMobile');
  if (userNameInput && userNameMobile) {
    userNameInput.addEventListener('input', (e) => {
      userNameMobile.value = e.target.value;
    });
    userNameMobile.addEventListener('input', (e) => {
      userNameInput.value = e.target.value;
    });
  }
}

/**
 * Setup room management handlers
 */
function setupRoomManagement() {
  const joinRoomBtn = document.getElementById('joinRoomBtn');
  if (joinRoomBtn) {
    joinRoomBtn.addEventListener('click', async () => {
      let roomId = document.getElementById('roomIdInput').value.trim();

      // Generate UUID if room ID is empty
      if (!roomId) {
        roomId = generateUUID();
      }

      try {
        if (window.joinRoom) {
          await window.joinRoom(roomId);
          // Clear the input only after successfully joining
          const roomIdInput = document.getElementById('roomIdInput');
          if (roomIdInput) {
            roomIdInput.value = '';
          }
        }
      } catch (error) {
        logger.error('Failed to join room:', error);
        // Don't clear input if join failed
      }
    });
  } else {
    logger.warn('joinRoomBtn element not found');
  }

  // Enter key to join room
  const roomIdInput = document.getElementById('roomIdInput');
  if (roomIdInput && joinRoomBtn) {
    roomIdInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        joinRoomBtn.click();
      }
    });
  }
}

/**
 * Setup message sending handlers
 */
function setupMessageHandlers() {
  const sendBtn = document.getElementById('sendBtn');
  if (sendBtn) {
    sendBtn.addEventListener('click', () => {
      if (window.sendMessage) {
        window.sendMessage();
      }
    });
  } else {
    logger.warn('sendBtn element not found');
  }

  const messageInput = document.getElementById('messageInput');
  if (messageInput) {
    messageInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        if (window.sendMessage) {
          window.sendMessage();
        }
      }
    });

    // Real-time draft messages
    messageInput.addEventListener('input', () => {
      if (window.handleDraftMessage) {
        window.handleDraftMessage();
      }
    });
  } else {
    logger.warn('messageInput element not found');
  }
}

/**
 * Setup share room button
 */
function setupShareButton() {
  const shareRoomBtn = document.getElementById('shareRoomBtn');
  if (shareRoomBtn) {
    shareRoomBtn.addEventListener('click', () => {
      if (window.shareCurrentRoom) {
        window.shareCurrentRoom();
      }
    });
  }
}

/**
 * Setup debug panel handlers
 */
function setupDebugHandlers() {
  const clearDebugBtn = document.getElementById('clearDebugBtn');
  if (clearDebugBtn) {
    clearDebugBtn.addEventListener('click', () => {
      if (window.clearDebugPanel) {
        window.clearDebugPanel();
      }
    });
  }
}

/**
 * Handle user name change for mobile input
 * @param {string} userName - New user name
 */
export function handleUserNameChange(userName) {
  // Sync both desktop and mobile inputs
  const userNameInput = document.getElementById('userName');
  const userNameMobile = document.getElementById('userNameMobile');

  if (userNameInput) userNameInput.value = userName;
  if (userNameMobile) userNameMobile.value = userName;

  // Trigger the debounced initialization
  if (initDebounceTimeout) {
    clearTimeout(initDebounceTimeout);
  }

  initDebounceTimeout = setTimeout(() => {
    if (userName && userName !== lastInitializedName) {
      localStorage.removeItem('userId');
      localStorage.removeItem('userName');

      if (window.handleInitializeUser) {
        window.handleInitializeUser(userName);
      }
      lastInitializedName = userName;
    }
  }, 300);
}

/**
 * Clean up event handlers
 */
export function cleanupEventHandlers() {
  if (initDebounceTimeout) {
    clearTimeout(initDebounceTimeout);
    initDebounceTimeout = null;
  }
}