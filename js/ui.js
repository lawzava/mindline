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
 * Display a message in the chat area with enhanced styling
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

  // Create message container
  const messageContainer = document.createElement('div');
  messageContainer.className = 'message-container mb-4';

  // Create the message bubble
  const messageElement = document.createElement('div');

  // Use provided timestamp or current time as fallback
  const timestamp = messageTimestamp
    ? new Date(messageTimestamp).toLocaleTimeString()
    : new Date().toLocaleTimeString();

  if (isMe) {
    messageElement.className = 'neo-message-bubble sent';
    messageContainer.style.display = 'flex';
    messageContainer.style.justifyContent = 'flex-end';
  } else {
    messageElement.className = 'neo-message-bubble received';
    messageContainer.style.display = 'flex';
    messageContainer.style.justifyContent = 'flex-start';
  }

  // Create enhanced message structure
  const senderDiv = document.createElement('div');
  senderDiv.className = 'message-sender';
  senderDiv.textContent = senderName;

  const contentDiv = document.createElement('div');
  contentDiv.className = 'message-content';
  contentDiv.textContent = message;

  const timestampDiv = document.createElement('div');
  timestampDiv.className = 'message-timestamp';
  timestampDiv.textContent = timestamp;

  // Add status indicator for sent messages
  if (isMe) {
    const statusDiv = document.createElement('div');
    statusDiv.className = 'message-status';
    statusDiv.textContent = 'sent';
    messageElement.appendChild(statusDiv);
  }

  // Assemble message
  messageElement.appendChild(senderDiv);
  messageElement.appendChild(contentDiv);
  messageElement.appendChild(timestampDiv);

  messageContainer.appendChild(messageElement);
  chatArea.appendChild(messageContainer);

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

  // Remove all status classes and set base classes
  statusElement.className = 'status-indicator';

  switch (status) {
    case 'connecting':
      statusElement.innerHTML = '<span class="sr-only">Connection status:</span>Connecting...';
      statusElement.classList.add('status-connecting');
      break;
    case 'connected':
      statusElement.innerHTML = '<span class="sr-only">Connection status:</span>Connected';
      statusElement.classList.add('status-connected');
      break;
    case 'reconnecting':
      statusElement.innerHTML = '<span class="sr-only">Connection status:</span>Reconnecting...';
      statusElement.classList.add('status-reconnecting');
      break;
    case 'failed':
      statusElement.innerHTML = '<span class="sr-only">Connection status:</span>Connection Failed';
      statusElement.classList.add('status-failed');
      break;
    default:
      statusElement.innerHTML = '<span class="sr-only">Connection status:</span>Disconnected';
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
      displayMessage(message.content, isMe, message.sender, false, message.timestamp); // false = don't scroll yet, pass timestamp
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
 * Update draft messages display with enhanced styling
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

      // Create enhanced typing indicator
      const typingIndicator = document.createElement('div');
      typingIndicator.className = 'typing-indicator';

      // User name
      const userSpan = document.createElement('span');
      userSpan.className = 'typing-user';
      userSpan.textContent = draft.sender || 'Someone';

      // Typing dots
      const dotsContainer = document.createElement('div');
      dotsContainer.className = 'typing-dots-container';

      for (let i = 0; i < 3; i++) {
        const dot = document.createElement('div');
        dot.className = 'typing-dot';
        dotsContainer.appendChild(dot);
      }

      // Live preview of what they're typing
      const preview = document.createElement('span');
      preview.className = 'typing-preview';
      preview.textContent = draft.content;

      // Assemble the indicator
      typingIndicator.appendChild(userSpan);
      typingIndicator.appendChild(dotsContainer);
      if (draft.content.length > 0) {
        typingIndicator.appendChild(preview);
      }

      draftsArea.appendChild(typingIndicator);
    }
  });

  // Show/hide the drafts area with smooth animation
  if (hasDrafts) {
    draftsArea.style.display = 'block';
    // Trigger reflow to ensure display change is applied
    draftsArea.offsetHeight;
    scrollChatToBottom('smooth', 100);
  } else {
    draftsArea.style.display = 'none';
  }
}

// Re-export getCurrentUserId for convenience
import { getCurrentUserId } from './state.js';