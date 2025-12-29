/**
 * Message Manager
 * Handles message history, storage, and synchronization
 */

import logger from './logger.js';
import USER_MESSAGES from './user-messages.js';
import { AppState, getCurrentUserId, getCurrentRoomId, generateUUID } from './state.js';
import { log, clearMessageInput, displayMessage } from './ui.js';
import { debugLog } from './debug-utils.js';

/**
 * Load chat history for a room (single source of truth: WASM)
 * @param {string} roomId - Room ID to load history for
 * @returns {Array} Array of messages
 */
export function loadChatHistory(roomId) {
  if (!roomId) return [];

  try {
    // Load from WASM storage
    window.safeWasm?.load_room_messages_from_storage?.(roomId);

    // Get messages from WASM
    const messages = window.safeWasm?.get_room_messages?.(roomId, 100);
    return Array.isArray(messages) ? messages : [];
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
        // Format message for WASM EnhancedMessage type
        const enhancedMessage = {
          id: message.id || message.messageId,
          sender_id: message.senderId || message.sender_id || 'unknown',
          sender_name: message.senderName || message.sender || message.sender_name || 'Anonymous',
          message_type: message.message_type || 'Text', // Use existing type or default to Text
          content: message.content || '',
          timestamp: message.timestamp || Date.now(),
          room_id: roomId,
          status: message.status || 'Sent',
          edited: message.edited || false,
          edit_timestamp: message.edit_timestamp || null,
          original_content: message.original_content || null,
          reply_to: message.reply_to || null,
          reactions: message.reactions || {},
          mentions: message.mentions || [],
          local_timestamp: message.local_timestamp || message.timestamp || Date.now(),
          delivery_attempts: message.delivery_attempts || 0,
          size_bytes: message.size_bytes || 0
        };

        // Pass the object directly - WASM expects JsValue, not JSON string
        window.safeWasm.receive_message_from_peer(enhancedMessage);
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
 * Get chat history for a room (alias for loadChatHistory)
 * @param {string} roomId - Room ID
 * @returns {Array} Array of messages
 */
export function getChatHistory(roomId) {
  return loadChatHistory(roomId);
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
        // Add type field for P2P handling
        syncRequest.type = 'sync-request';
        // Broadcast sync request to peers
        const p2pConnection = AppState.p2pConnection;
        if (p2pConnection) {
          p2pConnection.broadcast(syncRequest);
          logger.debug('Sync request sent for room:', roomId, syncRequest);
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
    logger.info('📥 SYNC REQUEST received from peer:', peerId);
    logger.debug('Sync request details:', message);

    // Always use WASM sync handler
    if (window.safeWasm && window.safeWasm.handle_sync_request) {
      // Pass the message object directly - WASM expects JsValue
      const syncResponse = window.safeWasm.handle_sync_request(message);
      logger.debug('WASM sync response:', syncResponse);

      if (syncResponse && syncResponse !== null) {
        // Add type field for P2P handling
        syncResponse.type = 'sync-response';

        // Get current room messages to include in response
        const roomId = message.room_id || message.roomId;
        const messages = getChatHistory(roomId);

        // Include messages in the response if WASM didn't provide them
        if (!syncResponse.messages && messages.length > 0) {
          syncResponse.messages = messages;
        }

        const p2pConnection = AppState.p2pConnection;
        if (p2pConnection) {
          p2pConnection.sendToPeer(peerId, syncResponse);
          logger.info(`📤 SYNC RESPONSE sent to peer ${peerId} with ${syncResponse.messages?.length || 0} messages`);
        } else {
          logger.error('No P2P connection available to send sync response');
        }
      } else {
        logger.warn('No sync response generated by WASM for request from:', peerId);

        // Fallback: manually create sync response with messages
        const roomId = message.room_id || message.roomId;
        const messages = getChatHistory(roomId);
        if (messages.length > 0) {
          const fallbackResponse = {
            type: 'sync-response',
            messages: messages,
            room_id: roomId,
            timestamp: Date.now()
          };
          const p2pConnection = AppState.p2pConnection;
          if (p2pConnection) {
            p2pConnection.sendToPeer(peerId, fallbackResponse);
            logger.info(`📤 FALLBACK SYNC RESPONSE sent to peer ${peerId} with ${messages.length} messages`);
          }
        }
      }
    } else {
      logger.error('WASM handle_sync_request not available');
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
    logger.info(`📨 SYNC RESPONSE received from peer ${peerId}`);
    const { room_id, roomId, request_type } = message;

    // Handle both room_id and roomId for compatibility
    const targetRoomId = room_id || roomId;

    // Handle nested structure: request_type can be an object with SyncResponse property
    let messages = null;
    if (request_type && typeof request_type === 'object' && request_type.SyncResponse) {
      messages = request_type.SyncResponse.messages;
    } else if (request_type === 'SyncResponse' && message.messages) {
      // Handle flat structure for compatibility
      messages = message.messages;
    } else if (message.messages) {
      // Handle direct messages field (fallback response format)
      messages = message.messages;
    }

    // Check if we have messages to process
    if (messages && Array.isArray(messages) && messages.length > 0) {
      logger.info(`Received ${messages.length} messages from ${peerId} for sync`);

      // Get existing messages to check for duplicates
      const existingMessages = getChatHistory(targetRoomId);
      const existingIds = new Set(existingMessages.map(msg => msg.id));

      logger.debug(`Existing messages in room: ${existingMessages.length}, IDs:`, Array.from(existingIds));
      logger.debug(`Synced messages to process:`, messages.map(m => ({ id: m.id, content: m.content })));

      // Filter out duplicates and collect new messages
      const newMessages = messages.filter(msg => {
        if (!existingIds.has(msg.id)) {
          logger.debug(`New message to add: ${msg.id}`);
          return true;
        } else {
          logger.debug(`Message ${msg.id} already exists, skipping`);
          return false;
        }
      });

      // Only proceed if we have new messages to add
      if (newMessages.length > 0) {
        // Add each synced message to WASM so it's properly tracked
        // Use addMessageToHistory which properly formats messages for WASM
        newMessages.forEach(msg => {
          try {
            addMessageToHistory(targetRoomId, msg);
            logger.debug(`Added synced message to WASM: ${msg.id}`);
          } catch (e) {
            logger.error(`Failed to add message ${msg.id} to WASM:`, e);
          }
        });
      }

      // Save to storage and update UI if we added any new messages
      if (newMessages.length > 0) {
        saveChatHistory(targetRoomId);

        // Refresh UI if this is the current room
        const currentRoomId = getCurrentRoomId();
        if (targetRoomId === currentRoomId) {
          // Reload all messages in chronological order instead of appending
          // This ensures synced messages appear in their correct time slots
          const allMessages = getChatHistory(targetRoomId);
          import('./ui.js').then(({ displayChatHistory }) => {
            displayChatHistory(allMessages);
          });
        }

        log(`Synced ${newMessages.length} new messages from peer`);
      } else {
        logger.debug('No new messages to sync (all duplicates)');
      }
    } else {
      logger.debug('No messages in sync response');
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
    logger.debug(`retrieveMessages: Loaded ${messages.length} messages for room ${roomId}`, messages);

    // Request sync in background to get any missing messages
    setTimeout(() => {
      logger.debug(`retrieveMessages: Requesting sync for room ${roomId}`);
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
  window.safeWasm?.start_performance_timer?.('message_send');

  const messageInput = document.getElementById('messageInput');
  const trimmedMessage = String(messageInput?.value || '').trim();

  // Validate message
  if (!window.safeWasm?.validate_message?.(trimmedMessage)) {
    return;
  }
  const message = trimmedMessage.substring(0, 2000);

  const roomId = getCurrentRoomId();
  if (!roomId) {
    log(USER_MESSAGES.message.noRoom);
    return;
  }

  const userId = getCurrentUserId();
  if (!userId) {
    log(USER_MESSAGES.message.userNotReady);
    return;
  }

  try {
    const messageId = generateUUID();
    const rawUserName = document.getElementById('userName')?.value || 'Anonymous';
    const userName = window.safeWasm?.validate_username?.(rawUserName.trim())
      ? rawUserName.trim().substring(0, 32)
      : 'Anonymous';

    const messageObj = {
      id: messageId,
      type: 'chat',
      content: message,
      sender: userName,
      senderName: userName,
      senderId: userId,
      messageId: messageId,
      timestamp: Date.now()
    };

    // Broadcast via P2P
    if (AppState.p2pConnection) {
      try {
        AppState.p2pConnection.broadcast(messageObj);
      } catch (error) {
        logger.error('P2P broadcast failed:', error);
      }
    }

    // Store in WASM
    if (window.safeWasm?.send_message_enhanced) {
      window.safeWasm.send_message_enhanced(roomId, message, messageId);
      saveChatHistory(roomId);
    } else {
      addMessageToHistory(roomId, messageObj);
    }

    // Display locally and clear input
    displayMessage(message, true, userName, false, messageObj.timestamp, messageObj);
    clearMessageInput();

    // Clear typing indicator
    if (AppState.p2pConnection) {
      AppState.p2pConnection.broadcast({
        type: 'typing',
        content: '',
        senderId: userId,
        senderName: userName,
        timestamp: Date.now()
      });
    }

    window.safeWasm?.end_performance_timer?.('message_send');
    window.safeWasm?.record_performance_metric?.('messages_sent', 1, 'count', 'network');

  } catch (error) {
    logger.error('Error sending message:', error);
    log(`Failed to send message: ${error.message}`);
    window.safeWasm?.end_performance_timer?.('message_send');
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

  // Add to message history and save to storage
  const roomId = getCurrentRoomId();
  if (roomId) {
    addMessageToHistory(roomId, messageObj);
    // Save to localStorage after adding message
    saveChatHistory(roomId);
  }
}

// Global functions for HTML handlers
window.sendMessage = sendMessage;
window.handleDraftMessage = handleDraftMessage;