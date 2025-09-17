/**
 * Message Manager
 * Handles message history, storage, and synchronization
 */

import logger from './logger.js';
import { AppState, getCurrentUserId, getCurrentRoomId, generateUUID } from './state.js';
import { log, clearMessageInput, displayMessage } from './ui.js';
import { debugLog } from './debug-utils.js';

/**
 * Load chat history for a room
 * @param {string} roomId - Room ID to load history for
 * @returns {Array} Array of messages
 */
export function loadChatHistory(roomId) {
  try {
    // Always load from WASM storage first
    if (window.safeWasm && window.safeWasm.load_room_messages_from_storage) {
      try {
        window.safeWasm.load_room_messages_from_storage(roomId);
      } catch (wasmError) {
        console.warn('Could not load from WASM storage:', wasmError);
      }
    }

    // Get messages from WASM (single source of truth)
    if (window.safeWasm && window.safeWasm.get_room_messages) {
      const messages = window.safeWasm.get_room_messages(roomId, 100);
      return messages || [];
    }

    return [];
  } catch (error) {
    logger.error('Error loading chat history:', error);
    return [];
  }
}

/**
 * Save chat history for a room
 * @param {string} roomId - Room ID to save history for
 */
export function saveChatHistory(roomId) {
  try {
    // Use WASM to save messages
    if (window.safeWasm && window.safeWasm.save_room_messages_to_storage) {
      window.safeWasm.save_room_messages_to_storage(roomId);
    }
  } catch (error) {
    console.error('Error saving chat history:', error);
  }
}

/**
 * Add message to chat history
 * @param {string} roomId - Room ID
 * @param {Object} message - Message object
 */
export function addMessageToHistory(roomId, message) {
  try {
    // Validate message
    if (!message || !message.id) {
      logger.warn('Cannot add invalid message to history');
      return;
    }

    // Add to WASM message system (single source of truth)
    if (window.safeWasm && window.safeWasm.receive_message_from_peer) {
      try {
        window.safeWasm.receive_message_from_peer(message);
        // Auto-save to storage
        saveChatHistory(roomId);
      } catch (wasmError) {
        console.warn('Could not add to WASM message system:', wasmError);
      }
    }
  } catch (error) {
    logger.error('Error adding message to history:', error);
  }
}

/**
 * Get chat history for a room
 * @param {string} roomId - Room ID
 * @returns {Array} Array of messages
 */
export function getChatHistory(roomId) {
  // Always get from WASM (single source of truth)
  if (window.safeWasm && window.safeWasm.get_room_messages) {
    return window.safeWasm.get_room_messages(roomId, 100) || [];
  }
  return [];
}

/**
 * Request message sync from peers
 * @param {string} roomId - Room ID to sync
 */
export function requestMessageSync(roomId) {
  if (!roomId) return;

  try {
    // Get stats from WASM
    let lastSync = 0;
    let messageCount = 0;

    if (window.safeWasm && window.safeWasm.get_room_message_stats) {
      const stats = window.safeWasm.get_room_message_stats(roomId);
      if (stats) {
        lastSync = stats.lastSync || 0;
        messageCount = stats.totalMessages || 0;
      }
    }

    // Create sync request using WASM
    if (window.safeWasm && window.safeWasm.create_sync_request) {
      const syncRequest = window.safeWasm.create_sync_request(roomId, lastSync, messageCount);
      if (syncRequest) {
        // Broadcast sync request to peers
        const p2pConnection = AppState.p2pConnection;
        if (p2pConnection) {
          p2pConnection.broadcast(syncRequest);
          logger.debug('Sync request sent for room:', roomId);
        }
      }
    }
  } catch (error) {
    logger.error('Error requesting message sync:', error);
  }
}

/**
 * Handle sync request from peer
 * @param {Object} message - Sync request message
 * @param {string} peerId - Peer ID that sent the request
 */
export function handleSyncRequest(message, peerId) {
  try {
    // Always use WASM sync handler
    if (window.safeWasm && window.safeWasm.handle_sync_request) {
      const syncResponse = window.safeWasm.handle_sync_request(message);
      if (syncResponse) {
        const p2pConnection = AppState.p2pConnection;
        if (p2pConnection) {
          p2pConnection.sendToPeer(peerId, syncResponse);
        }
      }
    }
  } catch (error) {
    logger.error('Error handling sync request:', error);
  }
}

/**
 * Handle sync response from peer
 * @param {Object} message - Sync response message
 * @param {string} peerId - Peer ID that sent the response
 */
export function handleSyncResponse(message, peerId) {
  try {
    const { roomId, request_type, messages } = message;

    // Check if it's a sync response with messages
    if (request_type === 'SyncResponse' && messages && Array.isArray(messages)) {
      logger.debug(`Received ${messages.length} messages from ${peerId} for sync`);

      // Add each message to WASM storage
      messages.forEach(msg => {
        addMessageToHistory(roomId, msg);
      });

      // Save to storage
      saveChatHistory(roomId);

      // Refresh UI if this is the current room
      const currentRoomId = getCurrentRoomId();
      if (roomId === currentRoomId) {
        const { displayChatHistory } = require('./ui.js');
        displayChatHistory(getChatHistory(roomId));
      }

      log(`Synced ${messages.length} messages from peer`);
    }
  } catch (error) {
    logger.error('Error handling sync response:', error);
  }
}

/**
 * Retrieve messages for a room (with loading and syncing)
 * @param {string} roomId - Room ID
 * @returns {Array} Array of messages
 */
export function retrieveMessages(roomId) {
  if (!roomId) return [];

  try {
    // Load from storage first
    const messages = loadChatHistory(roomId);

    // Request sync in background to get any missing messages
    setTimeout(() => {
      requestMessageSync(roomId);
    }, 1000);

    return messages;
  } catch (error) {
    logger.error('Error retrieving messages:', error);
    return [];
  }
}

/**
 * Send a message to the current room
 */
export function sendMessage() {
  debugLog(`🚀 ========== SENDMESSAGE STARTED ==========`);

  // Start performance timer
  if (window.safeWasm && window.safeWasm.start_performance_timer) {
    window.safeWasm.start_performance_timer('message_send');
  }

  const messageInput = document.getElementById('messageInput');
  const rawMessage = messageInput?.value;

  debugLog(`📝 Raw message input: "${rawMessage}"`);

  // Use WASM validation for message
  const trimmedMessage = String(rawMessage || '').trim();

  if (!window.safeWasm || !window.safeWasm.validate_message) {
    logger.error('WASM message validation not available');
    log('Message validation system not ready. Please reload the page.');
    return;
  }

  let message;
  try {
    const isValid = window.safeWasm.validate_message(trimmedMessage);
    if (!isValid) {
      debugLog(`❌ Invalid or empty message, aborting send`);
      logger.warn('Message failed validation:', rawMessage);
      return;
    }
    // WASM validation passed, but we still need to truncate for now
    // as the WASM function validates but doesn't truncate
    message = trimmedMessage.substring(0, 2000);
  } catch (error) {
    logger.error('Message validation error:', error);
    log('Error validating message. Please try again.');
    return;
  }

  debugLog(`✅ Sanitized message: "${message}"`);

  // Get the current room ID safely
  const roomId = getCurrentRoomId();
  debugLog(`🏠 Current room ID: ${roomId}`);
  if (!roomId) {
    debugLog(`❌ No room ID available`);
    log('Please create or join a room first');
    return;
  }

  try {
    // Check if user is properly initialized
    const userId = getCurrentUserId();
    debugLog(`👤 Current user ID: ${userId}`);
    if (!userId || userId === 'Not initialized') {
      debugLog(`❌ Cannot send message: User not initialized. userId=${userId}`);
      log('Please wait for user initialization before sending messages');
      return;
    }

    // Generate message ID on client side
    const messageId = generateUUID();
    const rawUserName = document.getElementById('userName')?.value || 'Anonymous';
    // Use WASM validation for username
    let userName;
    if (!window.safeWasm || !window.safeWasm.validate_username) {
      // Fallback if WASM not ready
      userName = 'Anonymous';
    } else {
      try {
        const trimmedName = String(rawUserName || '').trim();
        const isValid = window.safeWasm.validate_username(trimmedName);
        if (isValid) {
          // WASM validation passed, but we still need to truncate for now
          // as the WASM function validates but doesn't truncate
          userName = trimmedName.substring(0, 32);
        } else {
          userName = 'Anonymous';
        }
      } catch (error) {
        logger.error('Username validation error:', error);
        userName = 'Anonymous';
      }
    }

    logger.debug(`📝 Sending message: userId=${userId}, userName=${userName}, messageId=${messageId}, roomId=${roomId}`);

    // Create message object with proper fields for P2P broadcast
    const messageObj = {
      id: messageId,
      type: 'chat',
      content: message,
      sender: userName,
      senderName: userName,  // Include both for compatibility
      senderId: getCurrentUserId(),
      messageId: messageId,  // Include messageId explicitly for P2P
      timestamp: Date.now()
    };

    logger.debug(`📦 Created message object:`, messageObj);

    // Validate message object
    if (!messageObj.id || !messageObj.content || !messageObj.senderId) {
      logger.error(`❌ Invalid message object:`, messageObj);
      log('Failed to create valid message object');
      debugLog(`🔥 EARLY RETURN: Invalid message object`);
      return;
    }

    logger.debug(`✅ Message object validation passed, continuing to P2P broadcast...`);

    // Check P2P connection status
    logger.debug(`🌐 P2P Connection state:`, {
      hasConnection: !!AppState.p2pConnection,
      connectionId: AppState.p2pConnection?.clientId,
      roomConnected: AppState.p2pConnection?.roomId
    });

    debugLog(`🔥 REACHED P2P BROADCAST SECTION`);
    // Send via P2P if connected
    debugLog(`🔥 CRITICAL: AppState.p2pConnection =`, AppState.p2pConnection);
    debugLog(`🔥 CRITICAL: !!AppState.p2pConnection =`, !!AppState.p2pConnection);
    if (AppState.p2pConnection) {
      logger.debug(`📤 CHAT BROADCAST: Starting chat message broadcast...`);
      logger.debug(`📤 CHAT BROADCAST: dataChannels.size =`, AppState.p2pConnection.dataChannels?.size);
      logger.debug(`📤 CHAT BROADCAST: Message object:`, messageObj);

      try {
        const result = AppState.p2pConnection.broadcast(messageObj);
        logger.debug(`📤 CHAT BROADCAST: Broadcast returned:`, result);
        logger.debug(`✅ CHAT BROADCAST: P2P broadcast completed successfully`);
      } catch (broadcastError) {
        logger.error(`❌ CHAT BROADCAST: P2P broadcast failed:`, broadcastError);
      }
    } else {
      logger.debug(`❌ CHAT BROADCAST: No P2P connection to broadcast message`);
    }

    // Store locally in WASM using enhanced message system
    debugLog(`💾 Attempting to store in WASM using enhanced system...`);
    try {
      if (window.safeWasm && window.safeWasm.send_message_enhanced) {
        window.safeWasm.send_message_enhanced(roomId, message, messageId);
        debugLog(`✅ Stored in WASM enhanced system successfully`);
      } else {
        debugLog(`⚠️ WASM enhanced system not available, using fallback`);
        // Store in AppState as fallback
        addMessageToHistory(roomId, messageObj);
      }
    } catch (wasmError) {
      logger.warn('WASM storage failed, using fallback:', wasmError);
      addMessageToHistory(roomId, messageObj);
    }

    // Display the message locally with "me" styling
    displayMessage(message, true, userName, false, messageObj.timestamp, messageObj);

    // Clear input
    clearMessageInput();

    // Send empty typing indicator to clear it for other peers
    if (AppState.p2pConnection) {
      const clearTypingMessage = {
        type: 'typing',
        content: '',
        senderId: userId,
        senderName: userName,
        timestamp: Date.now()
      };
      try {
        AppState.p2pConnection.broadcast(clearTypingMessage);
      } catch (error) {
        logger.debug('Failed to clear typing indicator:', error);
      }
    }

    // End performance timer
    if (window.safeWasm && window.safeWasm.end_performance_timer) {
      window.safeWasm.end_performance_timer('message_send');
    }

    // Record metric
    if (window.safeWasm && window.safeWasm.record_performance_metric) {
      try {
        window.safeWasm.record_performance_metric('messages_sent', 1);
      } catch (metricError) {
        logger.debug('Could not record message metric:', metricError);
      }
    }

    debugLog(`✅ ========== SENDMESSAGE COMPLETED ==========`);

  } catch (error) {
    logger.error('Error sending message:', error);
    log(`Failed to send message: ${error.message}`);
    debugLog(`❌ ========== SENDMESSAGE FAILED ==========`);

    // End performance timer even on error
    if (window.safeWasm && window.safeWasm.end_performance_timer) {
      window.safeWasm.end_performance_timer('message_send');
    }
  }
}

/**
 * Handle draft message input
 */
export function handleDraftMessage() {
  const messageInput = document.getElementById('messageInput');
  if (!messageInput) return;

  const content = messageInput.value;
  const roomId = getCurrentRoomId();
  const userId = getCurrentUserId();
  const userName = document.getElementById('userName')?.value || 'Anonymous';

  if (!roomId || !userId) return;

  // Send typing indicator to peers
  if (AppState.p2pConnection && content.length > 0) {
    const draftMessage = {
      type: 'typing',
      content: content,
      senderId: userId,
      senderName: userName,
      timestamp: Date.now()
    };

    try {
      AppState.p2pConnection.broadcast(draftMessage);
    } catch (error) {
      logger.debug('Failed to broadcast draft message:', error);
    }
  }

  // Always store draft in WASM
  if (window.safeWasm && window.safeWasm.set_draft_message) {
    try {
      window.safeWasm.set_draft_message(userId, content, userName);
    } catch (error) {
      logger.debug('Failed to store draft in WASM:', error);
    }
  }
}

/**
 * Display received message in the UI
 * @param {Object} messageObj - Message object to display
 */
export function displayReceivedMessage(messageObj) {
  if (!messageObj || !messageObj.content) return;

  const isMe = messageObj.senderId === getCurrentUserId();
  const senderName = messageObj.sender || 'Unknown';
  const timestamp = messageObj.timestamp || Date.now();

  displayMessage(messageObj.content, isMe, senderName, true, timestamp, messageObj);

  // Add to message history
  const roomId = getCurrentRoomId();
  if (roomId) {
    addMessageToHistory(roomId, messageObj);
  }
}

// Global functions for HTML handlers
window.sendMessage = sendMessage;
window.handleDraftMessage = handleDraftMessage;