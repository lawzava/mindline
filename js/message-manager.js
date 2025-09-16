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
    // First try to load from WASM enhanced message system
    if (window.safeWasm && window.safeWasm.load_room_messages_from_storage) {
      try {
        window.safeWasm.load_room_messages_from_storage(roomId);
      } catch (wasmError) {
        console.warn('Could not load from WASM storage:', wasmError);
      }
    }

    // Then get messages from WASM
    if (window.safeWasm && window.safeWasm.get_room_messages) {
      const messages = window.safeWasm.get_room_messages(roomId, 100);
      if (messages && messages.length > 0) {
        // Store in AppState for compatibility
        AppState.chatHistory.set(roomId, {
          messages: messages,
          lastSync: Date.now()
        });
        return messages;
      }
    }

    // Fallback to localStorage if WASM doesn't have messages
    const historyKey = `chatHistory_${roomId}`;
    const savedHistory = localStorage.getItem(historyKey);

    if (savedHistory) {
      const parsed = JSON.parse(savedHistory);
      AppState.chatHistory.set(roomId, {
        messages: parsed.messages || [],
        lastSync: parsed.lastSync || 0
      });
      return parsed.messages || [];
    } else {
      AppState.chatHistory.set(roomId, {
        messages: [],
        lastSync: 0
      });
      return [];
    }
  } catch (error) {
    logger.error('Error loading chat history:', error);
    AppState.chatHistory.set(roomId, {
      messages: [],
      lastSync: 0
    });
    return [];
  }
}

/**
 * Save chat history for a room to localStorage
 * @param {string} roomId - Room ID to save history for
 */
export function saveChatHistory(roomId) {
  try {
    const roomHistory = AppState.chatHistory.get(roomId);
    if (!roomHistory) return;

    const historyKey = `chatHistory_${roomId}`;
    const historyData = {
      messages: roomHistory.messages,
      lastSync: Date.now()
    };

    localStorage.setItem(historyKey, JSON.stringify(historyData));
    roomHistory.lastSync = historyData.lastSync;
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
    // First ensure we have valid message data
    if (!message || !message.id) {
      logger.warn('Cannot add invalid message to history');
      return;
    }

    // Add to WASM enhanced message system if available
    if (window.safeWasm && window.safeWasm.receive_message_from_peer) {
      try {
        const messageData = JSON.stringify(message);
        window.safeWasm.receive_message_from_peer(messageData);
      } catch (wasmError) {
        console.warn('Could not add to WASM message system:', wasmError);
      }
    }

    // Also maintain in AppState for immediate UI updates
    let roomHistory = AppState.chatHistory.get(roomId);
    if (!roomHistory) {
      roomHistory = {
        messages: [],
        lastSync: 0
      };
      AppState.chatHistory.set(roomId, roomHistory);
    }

    // Check if message already exists (avoid duplicates)
    const existingMessageIndex = roomHistory.messages.findIndex(msg => msg.id === message.id);
    if (existingMessageIndex !== -1) {
      // Update existing message
      roomHistory.messages[existingMessageIndex] = message;
      logger.debug('Updated existing message in history:', message.id);
    } else {
      // Add new message
      roomHistory.messages.push(message);
      logger.debug('Added new message to history:', message.id);
    }

    // Sort messages by timestamp to maintain order
    roomHistory.messages.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

    // Keep only last 100 messages for performance
    if (roomHistory.messages.length > 100) {
      roomHistory.messages = roomHistory.messages.slice(-100);
    }

    // Auto-save periodically
    saveChatHistory(roomId);

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
  const roomHistory = AppState.chatHistory.get(roomId);
  if (roomHistory && roomHistory.messages) {
    return roomHistory.messages;
  }

  // Try to load if not in memory
  return loadChatHistory(roomId);
}

/**
 * Request message sync from peers
 * @param {string} roomId - Room ID to sync
 */
export function requestMessageSync(roomId) {
  if (!roomId) return;

  try {
    const roomHistory = AppState.chatHistory.get(roomId);
    const lastSync = roomHistory ? roomHistory.lastSync : 0;
    const messageCount = roomHistory ? roomHistory.messages.length : 0;

    // Create sync request using WASM if available
    if (window.safeWasm && window.safeWasm.create_sync_request) {
      const syncRequest = window.safeWasm.create_sync_request(roomId, lastSync, messageCount);
      if (syncRequest) {
        // Broadcast sync request to peers
        const p2pConnection = AppState.p2pConnection;
        if (p2pConnection) {
          p2pConnection.broadcast(syncRequest);
          logger.debug('Sync request sent for room:', roomId);
        }
        return;
      }
    }

    // Fallback sync request
    const syncMessage = {
      type: 'sync-request',
      roomId: roomId,
      lastSync: lastSync,
      messageCount: messageCount,
      timestamp: Date.now()
    };

    const p2pConnection = AppState.p2pConnection;
    if (p2pConnection) {
      p2pConnection.broadcast(syncMessage);
      log(`Requested message sync for room ${roomId}`);
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
    const { roomId, lastSync, messageCount } = message;

    // Use WASM sync handler if available
    if (window.safeWasm && window.safeWasm.handle_sync_request) {
      const syncResponse = window.safeWasm.handle_sync_request(JSON.stringify(message));
      if (syncResponse) {
        const p2pConnection = AppState.p2pConnection;
        if (p2pConnection) {
          p2pConnection.sendToPeer(peerId, JSON.parse(syncResponse));
        }
        return;
      }
    }

    // Fallback sync handling
    const roomHistory = AppState.chatHistory.get(roomId);
    if (!roomHistory || !roomHistory.messages) {
      return; // No messages to share
    }

    // Find messages newer than their last sync
    const messagesToSend = roomHistory.messages.filter(msg =>
      (msg.timestamp || 0) > lastSync
    ).slice(0, 20); // Limit to 20 messages per sync

    if (messagesToSend.length > 0) {
      const syncResponse = {
        type: 'sync-response',
        roomId: roomId,
        messages: messagesToSend,
        timestamp: Date.now()
      };

      const p2pConnection = AppState.p2pConnection;
      if (p2pConnection) {
        p2pConnection.sendToPeer(peerId, syncResponse);
        logger.debug(`Sent ${messagesToSend.length} messages to ${peerId} for sync`);
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
    const { roomId, messages } = message;
    if (!messages || !Array.isArray(messages)) return;

    logger.debug(`Received ${messages.length} messages from ${peerId} for sync`);

    // Add each message to history
    messages.forEach(msg => {
      addMessageToHistory(roomId, msg);
    });

    // Update last sync timestamp
    const roomHistory = AppState.chatHistory.get(roomId);
    if (roomHistory) {
      roomHistory.lastSync = Math.max(roomHistory.lastSync, Date.now());
      saveChatHistory(roomId);
    }

    // Refresh UI if this is the current room
    const currentRoomId = AppState.currentRoomId;
    if (roomId === currentRoomId) {
      const { displayChatHistory } = require('./ui.js');
      displayChatHistory(getChatHistory(roomId));
    }

    log(`Synced ${messages.length} messages from peer`);
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

  const messageInput = document.getElementById('messageInput');
  const rawMessage = messageInput?.value;

  debugLog(`📝 Raw message input: "${rawMessage}"`);

  // Use pure JavaScript validation until WASM serialization is fixed
  const message = String(rawMessage || '').trim().substring(0, 2000);

  if (!message || message.length === 0) {
    debugLog(`❌ Invalid or empty message, aborting send`);
    logger.warn('Message failed validation:', rawMessage);
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
    // Use pure JavaScript validation until WASM serialization is fixed
    const userName = String(rawUserName || '').trim()
      .split('').filter(c => /[a-zA-Z0-9 _-]/.test(c)).join('')
      .substring(0, 32) || 'Anonymous';

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

    debugLog(`✅ ========== SENDMESSAGE COMPLETED ==========`);

  } catch (error) {
    logger.error('Error sending message:', error);
    log(`Failed to send message: ${error.message}`);
    debugLog(`❌ ========== SENDMESSAGE FAILED ==========`);
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

  // Store draft in WASM if available
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