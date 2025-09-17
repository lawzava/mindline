/**
 * P2P Connection Manager
 * Handles peer-to-peer connections and message routing
 */

import logger from './logger.js';
import { P2PConnection } from './webrtc.js';
import {
  getCurrentUserId,
  getCurrentRoomId,
  getP2PConnection,
  setP2PConnection,
  AppState
} from './state.js';
import { log, updateConnectionStatus, updateDraftsDisplay, displayMessage } from './ui.js';
import {
  handleSyncRequest,
  handleSyncResponse,
  requestMessageSync,
  addMessageToHistory
} from './message-manager.js';
import { debugLog } from './debug-utils.js';
import { IndexState, INDEX_CONSTANTS } from './app-state.js';

/**
 * Initialize P2P connection for a room
 * @param {string} roomId - Room ID to initialize P2P for
 */
export async function initializeP2P(roomId) {
  logger.debug(`Starting initializeP2P with roomId: ${roomId}`);

  // Disconnect existing connection if any
  const existingConnection = getP2PConnection();
  if (existingConnection) {
    existingConnection.disconnect();
    setP2PConnection(null);
    // Small delay to ensure cleanup completes
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  // Clear any corrupted state from localStorage
  const storedUserId = localStorage.getItem('userId');
  if (storedUserId && (storedUserId.includes(',') || storedUserId.length < 10)) {
    logger.warn('Clearing corrupted stored user ID:', storedUserId);
    localStorage.removeItem('userId');
    localStorage.removeItem('userName');
    // Force re-initialization
    window.location.reload();
    return;
  }

  // Get user ID
  const userId = getCurrentUserId();
  if (!userId || userId === 'Not initialized') {
    throw new Error('User not initialized');
  }

  // Ensure userId is a string (safety check)
  const userIdString = Array.isArray(userId) ? userId.join(',') : String(userId);

  // Initialize Rust P2P manager
  try {
    if (window.safeWasm && window.safeWasm.initialize_p2p_manager) {
      window.safeWasm.initialize_p2p_manager(userIdString, roomId);
      logger.debug(`Rust P2P manager initialized for user ${userIdString} in room ${roomId}`);
    }
  } catch (error) {
    logger.warn('Failed to initialize Rust P2P manager:', error);
  }

  // Create new P2P connection
  logger.debug(`Creating P2PConnection for user ${userIdString} in room ${roomId}`);
  let p2pConnection;
  try {
    p2pConnection = new P2PConnection(userIdString, roomId, null);
    logger.debug(`P2PConnection created successfully`);
    setP2PConnection(p2pConnection);
  } catch (constructorError) {
    logger.error(`P2PConnection constructor failed:`, constructorError);
    throw constructorError;
  }

  // Add warning for testing
  logger.info('TESTING TIP: To test P2P messaging, open a second browser window/tab with a different username and join the same room!');

  // Set up message handlers
  p2pConnection.onMessage((message, peerId) => {
    handleIncomingP2PMessage(message, peerId);
  });

  p2pConnection.onPeerConnected((peerId) => {
    log(`Peer connected: ${peerId}`);
    updatePeerCount();

    // Use WASM to decide connection strategy
    if (window.safeWasm && window.safeWasm.get_connection_decision) {
      const decision = window.safeWasm.get_connection_decision(peerId);
      logger.debug(`Connection decision for ${peerId}: ${decision}`);
    }

    // Record peer in WASM P2P manager
    if (window.safeWasm && window.safeWasm.add_known_peer) {
      window.safeWasm.add_known_peer(peerId);
    }

    // Request message synchronization from new peer
    setTimeout(() => {
      requestMessageSync(roomId);
    }, 1000); // Small delay to ensure connection is stable

    // Send brief connection notification to peers
    setTimeout(() => {
      const userName = document.getElementById('userName')?.value || 'Anonymous';
      const connectMessage = {
        type: 'user-connected',
        senderId: getCurrentUserId(),
        senderName: userName,
        timestamp: Date.now()
      };
      p2pConnection.broadcast(connectMessage);
    }, 500);
  });

  p2pConnection.onPeerDisconnected((peerId) => {
    log(`Peer disconnected: ${peerId}`);
    updatePeerCount();

    // Remove peer from WASM P2P manager
    if (window.safeWasm && window.safeWasm.remove_peer_from_network) {
      window.safeWasm.remove_peer_from_network(peerId);
    }

    // Handle connection failure
    if (window.safeWasm && window.safeWasm.handle_connection_failure) {
      window.safeWasm.handle_connection_failure(peerId);
    }
  });

  // Connect to the signaling server
  try {
    await p2pConnection.connect();
    updateConnectionStatus('connected');
    log(`Connected to room: ${roomId}`);

    // Start message queue processing loop
    startQueueProcessing(p2pConnection);
  } catch (error) {
    logger.error('Failed to connect to P2P:', error);
    updateConnectionStatus('failed');
    throw error;
  }
}

/**
 * Start processing messages from the queue
 * @param {P2PConnection} p2pConnection - P2P connection instance
 */
function startQueueProcessing(p2pConnection) {
  if (!window.safeWasm || !window.safeWasm.process_p2p_queue) {
    logger.debug('Queue processing not available');
    return;
  }

  // Process queue every 200ms
  const queueInterval = setInterval(() => {
    try {
      const messages = window.safeWasm.process_p2p_queue();
      if (messages && messages.length > 0) {
        logger.debug(`Processing ${messages.length} queued messages`);

        for (const msg of messages) {
          // Send queued messages
          if (msg.target_peer) {
            // Unicast to specific peer
            const channel = p2pConnection.dataChannels.get(msg.target_peer);
            if (channel && channel.readyState === 'open') {
              try {
                channel.send(msg.content);
                logger.debug(`✅ Sent queued message to ${msg.target_peer}`);
              } catch (e) {
                logger.error(`Failed to send queued message to ${msg.target_peer}:`, e);
              }
            }
          } else {
            // Broadcast to all peers
            try {
              const parsedMsg = JSON.parse(msg.content);
              p2pConnection.broadcast(parsedMsg);
              logger.debug(`✅ Broadcast queued message type: ${parsedMsg.type}`);
            } catch (e) {
              logger.error(`Failed to broadcast queued message:`, e);
            }
          }
        }
      }
    } catch (error) {
      logger.error('Error processing message queue:', error);
    }

    // Check if connection is still active, clear interval if not
    if (!getP2PConnection()) {
      clearInterval(queueInterval);
      logger.debug('Queue processing stopped - P2P disconnected');
    }
  }, 200); // Process every 200ms

  // Store interval ID for cleanup
  if (!window.queueIntervals) {
    window.queueIntervals = [];
  }
  window.queueIntervals.push(queueInterval);
}

/**
 * Handle incoming P2P messages
 * @param {Object} message - Incoming message
 * @param {string} peerId - Peer ID that sent the message
 */
export function handleIncomingP2PMessage(message, peerId) {
  try {
    logger.info(`🎯 Received P2P message from ${peerId}:`, message.type, message);

    // Record message received for P2P metrics
    if (window.safeWasm && window.safeWasm.record_peer_message_received) {
      const messageSize = JSON.stringify(message).length;
      window.safeWasm.record_peer_message_received(peerId, messageSize);
    }

    switch (message.type) {
      case 'chat':
        handleChatMessage(message, peerId);
        break;
      case 'typing':
        handleTypingMessage(message, peerId);
        break;
      case 'sync-request':
        handleSyncRequest(message, peerId);
        break;
      case 'sync-response':
        handleSyncResponse(message, peerId);
        break;
      case 'user-connected':
        handleUserConnected(message, peerId);
        break;
      case 'edit':
        handleEditMessage(message, peerId);
        break;
      case 'delete':
        handleDeleteMessage(message, peerId);
        break;
      case 'reaction':
        handleReactionMessage(message, peerId);
        break;
      default:
        logger.warn(`Unknown message type: ${message.type}`);
    }
  } catch (error) {
    logger.error('Error handling P2P message:', error);
  }
}

/**
 * Handle chat messages from peers
 * @param {Object} message - Chat message
 * @param {string} peerId - Peer ID
 */
function handleChatMessage(message, peerId) {
  const { content, senderName, senderId, messageId, timestamp, encrypted } = message;

  logger.info('🎯 Handling chat message:', { content: encrypted ? '[encrypted]' : content, senderName, senderId, messageId, timestamp });

  if (!content || (!senderName && !senderId)) {
    logger.warn('Invalid chat message received');
    return;
  }

  // Decrypt message if it's encrypted
  let decryptedContent = content;
  if (encrypted && window.safeWasm && window.safeWasm.decrypt_message_content) {
    try {
      decryptedContent = window.safeWasm.decrypt_message_content(content);
      logger.debug('Message decrypted successfully');
    } catch (error) {
      logger.warn('Failed to decrypt message:', error);
      decryptedContent = '[Encrypted message - unable to decrypt]';
    }
  }

  // Use senderId as fallback for senderName
  const displayName = senderName || senderId || peerId;

  // Add to message history
  const messageObj = {
    id: messageId || `msg_${Date.now()}_${Math.random()}`,
    content: decryptedContent,
    senderId: senderId || peerId,
    sender: displayName,
    timestamp: timestamp || Date.now(),
    type: 'chat'
  };

  const roomId = getCurrentRoomId();
  if (roomId) {
    addMessageToHistory(roomId, messageObj);
  }

  // Display the message
  displayMessage(decryptedContent, false, displayName, true, timestamp, messageObj);

  // Clear the typing indicator for this peer since they sent a message
  clearPeerDraft(peerId);

  debugLog(`Chat message from ${displayName}: ${content}`);
}

/**
 * Handle typing indicator messages
 * @param {Object} message - Typing message
 * @param {string} peerId - Peer ID
 */
function handleTypingMessage(message, peerId) {
  const { content, senderName, senderId } = message;

  logger.info('🎯 Handling typing message:', { content, senderName, senderId });

  // Call the draft handler directly
  handlePeerDraft(message, peerId);

  debugLog(`Typing from ${senderName || senderId || peerId}: ${content || '[empty]'}`);
}

/**
 * Handle user connected notifications
 * @param {Object} message - User connected message
 * @param {string} peerId - Peer ID
 */
function handleUserConnected(message, peerId) {
  const { senderName } = message;
  if (senderName && window.showUserConnectionNotification) {
    window.showUserConnectionNotification(senderName);
  }
}

/**
 * Handle message edit requests
 * @param {Object} message - Edit message
 * @param {string} peerId - Peer ID
 */
function handleEditMessage(message, peerId) {
  // TODO: Implement message editing
  logger.debug('Message edit not yet implemented');
}

/**
 * Handle message delete requests
 * @param {Object} message - Delete message
 * @param {string} peerId - Peer ID
 */
function handleDeleteMessage(message, peerId) {
  // TODO: Implement message deletion
  logger.debug('Message deletion not yet implemented');
}

/**
 * Handle message reactions
 * @param {Object} message - Reaction message
 * @param {string} peerId - Peer ID
 */
function handleReactionMessage(message, peerId) {
  // TODO: Implement message reactions
  logger.debug('Message reactions not yet implemented');
}

/**
 * Update peer count display
 */
export function updatePeerCount() {
  const p2pConnection = getP2PConnection();
  if (!p2pConnection) return;

  const connectedPeers = p2pConnection.getConnectedPeers();
  const peerCount = connectedPeers.length;

  // Update UI to show peer count (if such element exists)
  const peerCountElement = document.getElementById('peerCount');
  if (peerCountElement) {
    peerCountElement.textContent = `${peerCount} peer${peerCount !== 1 ? 's' : ''} connected`;
  }

  debugLog(`Connected to ${peerCount} peers: ${connectedPeers.join(', ')}`);
}

/**
 * Send message to all connected peers
 * @param {Object} message - Message to send
 */
export function broadcastMessage(message) {
  const p2pConnection = getP2PConnection();
  if (!p2pConnection) {
    logger.warn('No P2P connection available for broadcasting');
    return false;
  }

  try {
    const deliveredCount = p2pConnection.broadcast(message);
    logger.debug(`Message broadcast delivered to ${deliveredCount} peers`);
    return deliveredCount > 0;
  } catch (error) {
    logger.error('Error broadcasting message:', error);
    return false;
  }
}

/**
 * Send message to specific peer
 * @param {string} peerId - Target peer ID
 * @param {Object} message - Message to send
 */
export function sendToPeer(peerId, message) {
  const p2pConnection = getP2PConnection();
  if (!p2pConnection) {
    logger.warn('No P2P connection available for sending');
    return false;
  }

  try {
    p2pConnection.sendToPeer(peerId, message);
    logger.debug(`Message sent to peer ${peerId}`);
    return true;
  } catch (error) {
    logger.error(`Error sending message to peer ${peerId}:`, error);
    return false;
  }
}

/**
 * Disconnect from P2P network
 */
export function disconnectP2P() {
  const p2pConnection = getP2PConnection();
  if (p2pConnection) {
    p2pConnection.disconnect();
    setP2PConnection(null);
    updateConnectionStatus('disconnected');
    updatePeerCount();
    log('Disconnected from P2P network');
  }
}

/**
 * Handle peer draft messages
 * @param {Object} message - Draft message
 * @param {string} peerId - Peer ID
 */
export function handlePeerDraft(message, peerId) {

  const senderName = message.senderName || message.senderId || peerId;

  // If content is empty, clear the draft
  if (!message.content || message.content.length === 0) {
    clearPeerDraft(peerId);
    return;
  }

  // Store the draft message
  AppState.draftMessages.set(peerId, {
    content: message.content,
    senderName: senderName,
    lastUpdate: Date.now()
  });

  // Clear any existing timeout for this peer
  const existingTimeout = IndexState.draftTimeouts.get(peerId);
  if (existingTimeout) {
    clearTimeout(existingTimeout);
  }

  // Set a timeout to clear the draft after inactivity
  const timeout = setTimeout(() => {
    AppState.draftMessages.delete(peerId);
    IndexState.draftTimeouts.delete(peerId);
    updateDraftMessages();
  }, INDEX_CONSTANTS.TIMEOUT_DRAFT_CLEAR);

  IndexState.draftTimeouts.set(peerId, timeout);

  // Update the drafts display
  updateDraftMessages();
}

/**
 * Clear peer draft message
 * @param {string} peerId - Peer ID
 */
export function clearPeerDraft(peerId) {

  AppState.draftMessages.delete(peerId);

  // Clear timeout for this peer
  const existingTimeout = IndexState.draftTimeouts.get(peerId);
  if (existingTimeout) {
    clearTimeout(existingTimeout);
    IndexState.draftTimeouts.delete(peerId);
  }

  updateDraftMessages();
}

/**
 * Update draft messages display
 */
function updateDraftMessages() {

  const draftsArea = document.getElementById('draftsArea');
  if (!draftsArea) {
    logger.warn('Drafts area element not found');
    return;
  }

  // Check if we have any drafts to show
  const activeDrafts = Array.from(AppState.draftMessages.values()).filter(draft => draft.content.trim());

  if (activeDrafts.length === 0) {
    draftsArea.style.display = 'none';
    draftsArea.innerHTML = '';
    return;
  }

  // Show drafts area and update content
  draftsArea.style.display = 'block';
  updateDraftsDisplay(activeDrafts);
}

// Global functions for HTML handlers
window.handlePeerDraft = handlePeerDraft;