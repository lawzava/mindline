/**
 * UI Management utilities for Mindline
 * Handles DOM manipulation, theme management, and user interface updates
 */

import logger from './logger.js';

/**
 * Log debug message to console and debug output area
 * @param {string} message - Debug message
 */
export function log(message) {
  logger.info(message);
  updateDebugOutput(`${new Date().toLocaleTimeString()} - ${message}`);
}

/**
 * Update debug output area
 * @param {string} message - Message to display
 */
function updateDebugOutput(message) {
  // Debug output removed for production - using logger instead
  logger.debug('Debug:', message);
}

/**
 * Display a message in the chat area
 * @param {string} message - Message content
 * @param {boolean} isMe - Whether the message is from the current user
 * @param {string} senderName - Name of the sender
 * @param {boolean} shouldScroll - Whether to scroll to bottom
 * @param {number|Date} messageTimestamp - Timestamp of the message (optional, defaults to current time)
 */
export function displayMessage(message, isMe = true, senderName = 'You', shouldScroll = true, messageTimestamp = null) {
  const chatArea = document.getElementById('chatArea');
  const welcomeMessage = document.getElementById('welcomeMessage');

  // Hide welcome message when first message is displayed
  if (welcomeMessage && welcomeMessage.style.display !== 'none') {
    welcomeMessage.style.display = 'none';
  }

  const messageElement = document.createElement('div');
  // Use provided timestamp or current time as fallback
  const timestamp = messageTimestamp
    ? new Date(messageTimestamp).toLocaleTimeString()
    : new Date().toLocaleTimeString();

  if (isMe) {
    messageElement.className = 'ml-auto max-w-[75%] mb-4 p-3 bg-primary/20 dark:bg-primary-dark/30 border-2 border-black dark:border-white shadow-md';
  } else {
    messageElement.className = 'mr-auto max-w-[75%] mb-4 p-3 bg-gray-200 dark:bg-gray-700 border-2 border-black dark:border-white shadow-md';
  }

  // Create message structure
  const senderDiv = document.createElement('div');
  senderDiv.className = 'text-xs font-bold text-gray-600 dark:text-gray-300 mb-1';
  senderDiv.textContent = `${senderName} • ${timestamp}`;

  const contentDiv = document.createElement('div');
  contentDiv.className = 'text-sm';
  contentDiv.textContent = message;

  messageElement.appendChild(senderDiv);
  messageElement.appendChild(contentDiv);

  chatArea.appendChild(messageElement);

  if (shouldScroll) {
    scrollChatToBottom('smooth', 100);
  }
}

/**
 * Scroll chat area to bottom
 * @param {string} behavior - Scroll behavior ('smooth', 'auto', or 'instant')
 * @param {number} delay - Delay in milliseconds
 */
export function scrollChatToBottom(behavior = 'smooth', delay = 0) {
  const chatArea = document.getElementById('chatArea');
  if (!chatArea) return;

  const scrollFunction = () => {
    chatArea.scrollTo({
      top: chatArea.scrollHeight,
      behavior: behavior
    });
  };

  if (delay > 0) {
    setTimeout(scrollFunction, delay);
  } else {
    scrollFunction();
  }
}

/**
 * Update connection status indicator
 * @param {string} status - 'disconnected', 'connecting', 'connected', 'failed', 'reconnecting'
 */
export function updateConnectionStatus(status = 'disconnected') {
  const statusElement = document.getElementById('connectionStatus');
  const connectionSection = document.getElementById('connectionSection');

  if (!statusElement) return;

  // Show the connection section
  if (connectionSection) {
    connectionSection.classList.remove('hidden');
  }

  // Remove all status classes
  statusElement.className = 'block w-full px-3 py-2 text-xs font-bold uppercase border-2 border-black dark:border-white tracking-wider text-center';

  switch (status) {
    case 'connecting':
      statusElement.textContent = 'Connecting...';
      statusElement.classList.add('status-connecting');
      break;
    case 'connected':
      statusElement.textContent = 'Connected';
      statusElement.classList.add('status-connected');
      break;
    case 'reconnecting':
      statusElement.textContent = 'Reconnecting...';
      statusElement.classList.add('status-reconnecting');
      break;
    case 'failed':
      statusElement.textContent = 'Connection Failed';
      statusElement.classList.add('status-failed');
      break;
    default:
      statusElement.textContent = 'Disconnected';
      statusElement.classList.add('status-disconnected');
  }

  logger.debug('Connection status updated to:', status);
}

/**
 * Update room display in the UI
 * @param {string} roomId - Room ID to display
 */
export function updateRoomDisplay(roomId) {
  // Update page title to show current room
  document.title = `Mindline - Room: ${roomId}`;

  logger.debug('Room display updated:', roomId);
}

/**
 * Clear the message input field
 */
export function clearMessageInput() {
  const messageInput = document.getElementById('messageInput');
  if (messageInput) {
    messageInput.value = '';
  }
}

/**
 * Get the current message input value
 * @returns {string} Current message input value
 */
export function getMessageInputValue() {
  const messageInput = document.getElementById('messageInput');
  return messageInput ? messageInput.value : '';
}

/**
 * Set focus to message input
 */
export function focusMessageInput() {
  const messageInput = document.getElementById('messageInput');
  if (messageInput) {
    messageInput.focus();
  }
}

/**
 * Show a toast notification
 * @param {string} message - Message to show
 * @param {string} type - Type of toast ('info', 'success', 'warning', 'error')
 */
export function showToast(message, type = 'info') {
  // For now, just use the existing log function
  // In the future, this could create proper toast notifications
  if (type === 'error') {
    logger.error(message);
  } else if (type === 'warning') {
    logger.warn(message);
  } else {
    logger.info(message);
  }

  log(message);
}

/**
 * Show/hide loading indicator
 * @param {boolean} show - Whether to show the loading indicator
 */
export function showLoading(show = true) {
  // Implementation for loading indicator
  // This could be a spinner or progress bar
  if (show) {
    updateConnectionStatus('connecting');
  }
}

/**
 * Display chat history in the UI
 * @param {Array} messages - Array of message objects
 */
export function displayChatHistory(messages) {
  const chatArea = document.getElementById('chatArea');
  const welcomeMessage = document.getElementById('welcomeMessage');

  if (!chatArea) return;

  // Clear current chat display
  chatArea.innerHTML = '';

  if (messages.length === 0) {
    // Show welcome message if no history
    if (welcomeMessage) {
      chatArea.appendChild(welcomeMessage.cloneNode(true));
    }
  } else {
    // Display all messages
    messages.forEach(message => {
      const isMe = message.senderId === getCurrentUserId();
      displayMessage(message.content, isMe, message.sender, false); // false = don't scroll yet
    });

    // Scroll to bottom after all messages are displayed
    scrollChatToBottom('auto', 100);
  }

  // Ensure draft area is ready (it's now in HTML, not dynamically created)
  const draftsArea = document.getElementById('draftsArea');
  if (draftsArea) {
    draftsArea.style.display = 'none'; // Hidden by default
  }
}

/**
 * Update draft messages display
 * @param {Map} draftMessages - Map of user ID to draft message
 * @param {string} currentUserId - Current user's ID
 */
export function updateDraftsDisplay(draftMessages, currentUserId) {
  const draftsArea = document.getElementById('draftsArea');
  if (!draftsArea) return;

  // Clear existing drafts
  draftsArea.innerHTML = '';

  let hasDrafts = false;

  // Display drafts from other users
  draftMessages.forEach((draft, userId) => {
    if (userId !== currentUserId && draft.content && draft.content.trim()) {
      hasDrafts = true;

      const draftElement = document.createElement('div');
      draftElement.className = 'text-xs text-gray-600 dark:text-gray-400 mb-1 italic';
      draftElement.innerHTML = `
        <span class="font-semibold">${draft.sender || 'Someone'}</span> is typing:
        <span class="text-gray-500 dark:text-gray-500">${draft.content}</span>
      `;

      draftsArea.appendChild(draftElement);
    }
  });

  // Show/hide the drafts area
  if (hasDrafts) {
    draftsArea.style.display = 'block';
    scrollChatToBottom('smooth', 50);
  } else {
    draftsArea.style.display = 'none';
  }
}

// Re-export getCurrentUserId for convenience
import { getCurrentUserId } from './state.js';