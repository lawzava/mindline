import '../css/styles.css';
import { P2PConnection } from './webrtc.js';
import logger from './logger.js';
import sanitizer from './sanitizer.js';
import {
  AppState,
  CONSTANTS,
  getCurrentUserId,
  getCurrentRoomId,
  setCurrentUserId,
  setCurrentRoomId,
  generateUUID,
  getRoomFromURL,
  updateURLWithRoom
} from './state.js';
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

/**
 * Mindline Chat Application
 * Enterprise-ready implementation of a P2P encrypted chat application
 */

// Extended application state for index.js specific properties
const IndexState = {
  wasmModule: null,
  typingTimeout: null,
  initialized: false,
  darkMode: false,
  reconnectAttempts: 0,
  maxReconnectAttempts: 5,
  reconnectInterval: null,
  isReconnecting: false,
  draftTimeouts: new Map() // Track timeouts for clearing stale drafts
};

// Additional constants for index.js
const INDEX_CONSTANTS = {
  TIMEOUT_DRAFT_CLEAR: 3000 // Clear draft after 3 seconds of inactivity
};


/**
 * Generate shareable room URL
 * @param {string} roomId - The room ID to share
 * @returns {string} Complete shareable URL
 */
function generateShareableURL(roomId) {
  const baseURL = `${window.location.protocol}//${window.location.host}${window.location.pathname}`;
  return `${baseURL}?r=${encodeURIComponent(roomId)}`;
}

/**
 * Get room history from localStorage
 * @returns {Array} Array of room objects with {id, name, lastJoined}
 */
function getRoomHistory() {
  try {
    const history = localStorage.getItem('roomHistory');
    return history ? JSON.parse(history) : [];
  } catch (error) {
    logger.error('Error parsing room history:', error);
    return [];
  }
}

/**
 * Add room to history
 * @param {string} roomId - Room ID to add
 */
function addRoomToHistory(roomId) {
  if (!roomId || !isValidRoomId(roomId)) return;

  const history = getRoomHistory();
  const now = Date.now();

  // Remove existing entry for this room
  const filteredHistory = history.filter(room => room.id !== roomId);

  // Add new entry at the beginning
  const newEntry = {
    id: roomId,
    name: roomId, // Could be extended to store custom names
    lastJoined: now
  };

  filteredHistory.unshift(newEntry);

  // Keep only last 10 rooms
  const limitedHistory = filteredHistory.slice(0, 10);

  // Save back to localStorage
  try {
    localStorage.setItem('roomHistory', JSON.stringify(limitedHistory));
    updateRoomHistoryUI();
  } catch (error) {
    logger.error('Error saving room history:', error);
  }
}

/**
 * Remove room from history
 * @param {string} roomId - Room ID to remove
 */
function removeRoomFromHistory(roomId) {
  const history = getRoomHistory();
  const filteredHistory = history.filter(room => room.id !== roomId);

  try {
    localStorage.setItem('roomHistory', JSON.stringify(filteredHistory));
    updateRoomHistoryUI();
  } catch (error) {
    logger.error('Error removing room from history:', error);
  }
}

/**
 * Initialize the application
 */
async function initializeApp() {
  try {

    // Initialize theme preference
    initializeTheme();

    // Load WASM module first
    await loadWasmModule();
    createSafeWasmProxies();


    // Restore user state
    await restoreUserState();

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

    const roomId = getCurrentRoomId();
    updateConnectionStatus(roomId ? 'connected' : 'disconnected');

    // Initialize room history UI (with small delay to ensure DOM is ready)
    setTimeout(() => {
      updateRoomHistoryUI();
    }, 100);

    // Ensure chat is scrolled to bottom after full initialization
    if (roomId) {
      scrollChatToBottom('auto', 500);
    }

    log('Application initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize application:', error);
    updateDebugOutput(`Error initializing application: ${error.message}`);
  }
}

/**
 * Load the WebAssembly module
 * @returns {Promise<boolean>} Whether the module loaded successfully
 */
async function loadWasmModule() {
  try {
    // Dynamically import the module
    const wasm = await import('../pkg/mindline.js');
    const initialized = await wasm.default();
    IndexState.wasmModule = initialized;
    
    updateDebugOutput('WASM module loaded successfully!');
    return true;
  } catch (err) {
    updateDebugOutput(`Error loading WASM module: ${err.message}`);
    logger.error('Error loading WASM module:', err);
    throw err;
  }
}

/**
 * Create safe proxy functions to handle WebAssembly calls
 */
function createSafeWasmProxies() {
  if (!IndexState.wasmModule) {
    logger.warn("WASM module not loaded, cannot create safe proxies");
    return;
  }
  
  window.safeWasm = {
    initialize: safeWasmCall('initialize', ['userName', 'userId']),
    join_room: safeWasmCall('join_room', ['roomId', 'signalData']),
    create_room_with_id: safeWasmCall('create_room_with_id', ['roomId']),
    send_message: safeWasmCall('send_message', ['roomId', 'content', 'messageId']),
    get_messages: safeWasmCall('get_messages', ['roomId'])
  };
  
  log("Safe WASM function proxies created");
}

/**
 * Factory function to create safe WebAssembly function proxies
 * @param {string} funcName - The name of the WASM function
 * @param {string[]} paramNames - Names of parameters
 * @param {Object} paramTransforms - Optional transforms for parameters
 * @returns {Function} Safe proxy function
 */
function safeWasmCall(funcName, paramNames, paramTransforms = {}) {
  return function(...args) {
    try {
      
      // Ensure correct number of parameters
      const safeArgs = args.slice(0, paramNames.length).map((arg, index) => {
        const paramName = paramNames[index];
        const transform = paramTransforms[paramName] || String;
        
        // Apply transform function (String by default)
        const safeArg = transform(arg || "");
        
        // Validate required parameters
        if (safeArg === "" && paramName !== 'content' && paramName !== 'signalData') {
          throw new Error(`${paramName} cannot be empty`);
        }
        
        return safeArg;
      });
      
      // Call the original function
      const result = IndexState.wasmModule[funcName](...safeArgs);
      
      // Special handling for get_messages result
      if (funcName === 'get_messages') {
        if (Array.isArray(result)) {
          logger.warn(`Detected memory pointer, returning empty array ${result}`);
          return "[]";
        }
      }
      
      return result;
    } catch (error) {
      logger.error(`Error in ${funcName}:`, error);
      throw error;
    }
  };
}


/**
 * Chat History Management
 */

/**
 * Load chat history for a room from localStorage
 * @param {string} roomId - Room ID to load history for
 */
function loadChatHistory(roomId) {
  try {
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
function saveChatHistory(roomId) {
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
function addMessageToHistory(roomId, message) {
  console.log(`🗂️ ========== ADD MESSAGE TO HISTORY STARTED ==========`);
  console.log(`🗂️ Adding message to history: roomId=${roomId}, messageId=${message.id}`);
  console.log(`🗂️ Message to add:`, message);

  const roomHistory = AppState.chatHistory.get(roomId);
  console.log(`🗂️ Current room history:`, roomHistory);

  if (!roomHistory) {
    console.log(`🗂️ No existing history, creating new room history`);
    const newHistory = {
      messages: [message],
      lastSync: 0
    };
    AppState.chatHistory.set(roomId, newHistory);
    console.log(`🗂️ Created new room history:`, newHistory);
  } else {
    console.log(`🗂️ Existing history found with ${roomHistory.messages.length} messages`);

    // Check if message already exists (avoid duplicates)
    const exists = roomHistory.messages.some(msg => msg.id === message.id);
    console.log(`🗂️ Message already exists check: ${exists}`);

    if (!exists) {
      console.log(`🗂️ Adding new message to existing history`);
      roomHistory.messages.push(message);
      console.log(`🗂️ Messages after push: ${roomHistory.messages.length}`);

      // Sort messages by timestamp
      roomHistory.messages.sort((a, b) => a.timestamp - b.timestamp);
      console.log(`🗂️ Messages after sort: ${roomHistory.messages.length}`);
      console.log(`🗂️ Latest message after sort:`, roomHistory.messages[roomHistory.messages.length - 1]);
    } else {
      console.log(`🗂️ Message already exists, skipping duplicate`);
    }
  }

  console.log(`🗂️ Final room history state:`, AppState.chatHistory.get(roomId));

  // Save to localStorage
  console.log(`🗂️ Saving to localStorage...`);
  try {
    saveChatHistory(roomId);
    console.log(`✅ Saved to localStorage successfully`);
  } catch (saveError) {
    console.error(`❌ Failed to save to localStorage:`, saveError);
  }

  console.log(`🗂️ ========== ADD MESSAGE TO HISTORY COMPLETED ==========`);
}

/**
 * Get chat history for a room
 * @param {string} roomId - Room ID
 * @returns {Array} Array of messages
 */
function getChatHistory(roomId) {
  const roomHistory = AppState.chatHistory.get(roomId);
  return roomHistory ? roomHistory.messages : [];
}


/**
 * Message Synchronization Protocol
 */

/**
 * Request message synchronization from peers
 * @param {string} roomId - Room ID to sync
 */
function requestMessageSync(roomId) {
  const roomHistory = AppState.chatHistory.get(roomId);
  const lastSync = roomHistory ? roomHistory.lastSync : 0;
  const messageCount = roomHistory ? roomHistory.messages.length : 0;


  const syncRequest = {
    type: 'sync-request',
    roomId: roomId,
    lastSync: lastSync,
    messageCount: messageCount,
    requesterId: getCurrentUserId(),
    timestamp: Date.now()
  };

  if (AppState.p2pConnection) {
    AppState.p2pConnection.broadcast(syncRequest);
  }
}

/**
 * Handle sync request from peer
 * @param {Object} message - Sync request message
 * @param {string} peerId - Peer ID who sent the request
 */
function handleSyncRequest(message, peerId) {
  const roomId = message.roomId;
  const peerLastSync = message.lastSync;
  const peerMessageCount = message.messageCount;

  console.log(`📨 Handling sync request from ${peerId} for room ${roomId}, peerLastSync: ${peerLastSync}, peerMessageCount: ${peerMessageCount}`);

  const roomHistory = AppState.chatHistory.get(roomId);
  if (!roomHistory) {
    console.log(`❌ No room history found for ${roomId}`);
    return;
  }

  console.log(`📚 Local room history has ${roomHistory.messages.length} messages, lastSync: ${roomHistory.lastSync}`);

  // Find messages that peer might be missing (newer than their lastSync)
  const missingMessages = roomHistory.messages.filter(msg =>
    msg.timestamp > peerLastSync
  );

  console.log(`🔍 Found ${missingMessages.length} missing messages for peer ${peerId}`);


  if (missingMessages.length > 0) {
    const syncResponse = {
      type: 'sync-response',
      roomId: roomId,
      messages: missingMessages,
      senderId: getCurrentUserId(),
      timestamp: Date.now()
    };

    console.log(`📤 Sending sync response with ${missingMessages.length} messages to ${peerId}`);
    if (AppState.p2pConnection) {
      AppState.p2pConnection.sendToPeer(peerId, syncResponse);
    } else {
      console.log(`❌ No P2P connection to send sync response`);
    }
  } else {
    console.log(`✅ Peer ${peerId} is already up to date`);
  }
}

/**
 * Handle sync response from peer
 * @param {Object} message - Sync response message
 * @param {string} peerId - Peer ID who sent the response
 */
function handleSyncResponse(message, peerId) {
  const roomId = message.roomId;
  const newMessages = message.messages || [];

  console.log(`📥 Received sync response from ${peerId} for room ${roomId} with ${newMessages.length} messages`);

  if (newMessages.length === 0) {
    console.log(`📭 No new messages in sync response from ${peerId}`);
    return;
  }

  let addedMessages = 0;

  // Add new messages to history and display
  newMessages.forEach(msg => {
    // Check if we already have this message
    const roomHistory = AppState.chatHistory.get(roomId);
    const exists = roomHistory && roomHistory.messages.some(existing => existing.id === msg.id);

    if (!exists && !AppState.messageHistory.has(msg.id)) {
      // Add to persistent history
      addMessageToHistory(roomId, msg);

      // Display the message
      const isMe = msg.senderId === getCurrentUserId();
      displayMessage(msg.content, isMe, msg.sender);

      addedMessages++;
    }
  });

  if (addedMessages > 0) {
    log(`Synchronized ${addedMessages} missing messages from ${peerId}`);
  }
}

/**
 * Validate room ID format
 * @param {string} id - Room ID to validate
 * @returns {boolean} Whether the ID is valid
 */
function isValidRoomId(id) {
  if (!id || typeof id !== 'string') return false;
  // Allow alphanumeric plus dashes and underscores, minimum 8 characters
  const idRegex = new RegExp(`^[a-zA-Z0-9_-]{${CONSTANTS.MIN_ROOM_ID_LENGTH},}$`);
  return idRegex.test(id);
}


/**
 * Ensure user is initialized (create one if needed)
 */
async function ensureUserInitialized() {
  const userId = getCurrentUserId();
  if (!userId || userId === 'Not initialized') {
    // Initialize user if not already done
    const userName = document.getElementById('userName').value || 'Anonymous';
    const newUserId = generateUUID();

    try {
      window.safeWasm.initialize(userName, newUserId);

      // Update tooltip with user ID
      const userIdTooltip = document.getElementById('userIdTooltip');
      if (userIdTooltip) {
        userIdTooltip.textContent = newUserId;
      }

      // Store both username and user ID
      localStorage.setItem('userName', userName);
      localStorage.setItem('userId', newUserId);

      log(`Auto-initialized user for room join: ${userName} with ID: ${newUserId}`);
    } catch (error) {
      console.error("Could not initialize user:", error);
      log(`Error initializing user: ${error.message}`);
      throw error;
    }
  }
}

/**
 * Restore user state from localStorage
 */
async function restoreUserState() {
  if (!window.safeWasm) {
    console.warn("Safe WASM proxies not created yet, cannot restore state safely");
    return;
  }

  // Initialize user if needed
  restoreUserInfo();

  // Restore room connection
  await restoreRoomConnection();
}

/**
 * Restore user information from localStorage
 */
function restoreUserInfo() {
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
        window.safeWasm.initialize(savedUserName, savedUserId);
        if (userIdTooltip) {
          userIdTooltip.textContent = savedUserId;
        }
        document.getElementById('userName').value = savedUserName;

        log(`Restored user: ${savedUserName} with ID: ${savedUserId}`);
        return;
      }

      // No saved data, initialize with current values or defaults
      const userName = document.getElementById('userName').value || 'Anonymous';
      const userId = generateUUID();

      window.safeWasm.initialize(userName, userId);
      if (userIdTooltip) {
        userIdTooltip.textContent = userId;
      }

      // Store both username and user ID
      localStorage.setItem('userName', userName);
      localStorage.setItem('userId', userId);

      log(`Initialized new user: ${userName} with ID: ${userId}`);
    } catch (error) {
      console.error("Could not initialize user:", error);
      log(`Error initializing user: ${error.message}`);
    }
  }
}

/**
 * Restore room connection from localStorage
 */
async function restoreRoomConnection() {
  const savedRoomId = localStorage.getItem('currentRoomId');

  if (!savedRoomId || !isValidRoomId(savedRoomId)) {
    updateConnectionStatus('failed');
    return;
  }

  updateRoomDisplay(savedRoomId);

  try {
    // Try to join the room in WASM
    const connectionToken = window.safeWasm.join_room(savedRoomId, "{}");

    // Initialize P2P connection
    try {
      await initializeP2P(savedRoomId);
    } catch (p2pError) {
      console.warn("P2P connection failed:", p2pError);
      log("P2P connection failed, but room is available locally");
    }

    // Load and display chat history
    const messages = loadChatHistory(savedRoomId);
    displayChatHistory(messages);

    updateConnectionStatus('connected');
    log(`Restored previous room: ${savedRoomId}`);

    // Optionally, retrieve messages for the room
    setTimeout(retrieveMessages, 500, savedRoomId);
  } catch (error) {
    console.warn("Could not join saved room:", error);
    log(`Could not rejoin room: ${error.message}`);

    // Try creating the room instead
    try {
      window.safeWasm.create_room_with_id(savedRoomId);

      // Initialize P2P connection
      try {
        await initializeP2P(savedRoomId);
      } catch (p2pError) {
        console.warn("P2P connection failed:", p2pError);
        log("P2P connection failed, but room is available locally");
      }

      // Load and display chat history
      const messages = loadChatHistory(savedRoomId);
      displayChatHistory(messages);

      updateConnectionStatus('connected');
      log(`Created room with previous ID: ${savedRoomId}`);
    } catch (createError) {
      console.error("Failed to create room as fallback:", createError);
      log(`Failed to create room: ${createError.message}`);
      updateConnectionStatus('failed');
    }
  }
}

/**
 * Create a new chat room
 * @returns {string|null} The room ID or null if failed
 */
async function createRoom() {
  try {
    // Get the user-provided room ID if available
    let roomId = document.getElementById('roomIdInput').value;

    // If no room ID is provided, generate a UUID
    if (!roomId) {
      roomId = generateUUID();
    }

    // Validate the room ID format
    if (!isValidRoomId(roomId)) {
      log(`Room ID must be at least ${CONSTANTS.MIN_ROOM_ID_LENGTH} alphanumeric characters (can include dashes and underscores)`);
      return null;
    }

    // Show connecting status
    updateConnectionStatus('connecting');

    // Create the room in the WASM module
    window.safeWasm.create_room_with_id(roomId);

    // Initialize P2P connection
    await initializeP2P(roomId);

    // Load and display chat history
    const messages = loadChatHistory(roomId);
    displayChatHistory(messages);

    // Update UI and localStorage
    updateRoomDisplay(roomId);
    localStorage.setItem('currentRoomId', roomId);

    // Add to room history
    addRoomToHistory(roomId);

    // Update connection status
    updateConnectionStatus('connected');

    // Scroll to bottom after room creation
    scrollChatToBottom('auto', 200);

    log(`Created and joined room: ${roomId}`);
    return roomId;
  } catch (error) {
    log(`Error creating room: ${error.message}`);
    updateConnectionStatus('failed');
    return null;
  }
}

/**
 * Join an existing chat room
 * @param {string} roomId - Room ID to join
 * @returns {string|null} The room ID or null if failed
 */
async function joinRoom(roomId) {
  logger.info('joinRoom called with roomId:', roomId);

  if (!roomId) {
    log('Please enter a room ID to join');
    return null;
  }

  // Sanitize and validate room ID
  const sanitizedRoomId = sanitizer.validateRoomId(roomId);
  if (!sanitizedRoomId) {
    logger.warn('Room ID validation failed:', roomId);
    log(`Room ID must be at least ${CONSTANTS.MIN_ROOM_ID_LENGTH} alphanumeric characters (can include dashes and underscores)`);
    return null;
  }

  // Rate limiting check
  if (!sanitizer.checkRateLimit(`join_room_${sanitizedRoomId}`, 5, 30000)) {
    logger.warn('Rate limit exceeded for room join:', sanitizedRoomId);
    log('Too many join attempts. Please wait before trying again.');
    return null;
  }

  logger.info('Room ID validation passed:', sanitizedRoomId);

  // Use sanitized room ID for the rest of the function
  roomId = sanitizedRoomId;

  try {
    // Show connecting status
    updateConnectionStatus('connecting');

    // Join the room
    const connectionToken = window.safeWasm.join_room(roomId, '{}');

    // Initialize P2P connection
    await initializeP2P(roomId);

    // Load and display chat history
    const messages = loadChatHistory(roomId);
    displayChatHistory(messages);

    // Update UI and localStorage
    updateRoomDisplay(roomId);
    localStorage.setItem('currentRoomId', roomId);

    // Add to room history
    addRoomToHistory(roomId);

    // Update connection status
    updateConnectionStatus('connected');

    // Scroll to bottom after joining room
    scrollChatToBottom('auto', 200);

    log(`Joined room: ${roomId}`);
    return roomId;
  } catch (error) {
    log(`Error joining room: ${error.message}`);
    updateConnectionStatus('failed');
    return null;
  }
}

/**
 * Attempt to reconnect P2P connection
 */
async function attemptReconnect() {
  const roomId = getCurrentRoomId();
  if (!roomId || IndexState.isReconnecting) {
    return;
  }

  IndexState.isReconnecting = true;
  IndexState.reconnectAttempts++;

  log(`Reconnection attempt ${IndexState.reconnectAttempts}/${IndexState.maxReconnectAttempts}...`);

  // Update status to show reconnecting
  const statusElement = document.getElementById('connectionStatus');
  if (statusElement) {
    statusElement.textContent = `Reconnecting... (${IndexState.reconnectAttempts}/${IndexState.maxReconnectAttempts})`;
    statusElement.className = 'block w-full px-3 py-2 text-xs font-bold uppercase border-2 border-black dark:border-white tracking-wider text-center status-reconnecting';
  }

  try {
    // Clean up existing connection properly before reconnecting
    if (AppState.p2pConnection) {
      AppState.p2pConnection.disconnect();
      AppState.p2pConnection = null;
    }

    // Wait a bit before trying to reconnect (exponential backoff)
    const delay = Math.min(2000 * Math.pow(1.5, IndexState.reconnectAttempts - 1), 10000);
    await new Promise(resolve => setTimeout(resolve, delay));

    // Try to reinitialize P2P connection
    await initializeP2P(roomId);

    // If successful, reset reconnection state
    IndexState.reconnectAttempts = 0;
    IndexState.isReconnecting = false;
    if (IndexState.reconnectInterval) {
      clearInterval(IndexState.reconnectInterval);
      IndexState.reconnectInterval = null;
    }

    updateConnectionStatus('connected');
    log('Reconnection successful!');
  } catch (error) {
    console.error('Reconnection failed:', error);
    IndexState.isReconnecting = false;

    if (IndexState.reconnectAttempts >= IndexState.maxReconnectAttempts) {
      // Give up after max attempts
      log(`Reconnection failed after ${IndexState.maxReconnectAttempts} attempts`);
      updateConnectionStatus('failed');

      if (IndexState.reconnectInterval) {
        clearInterval(IndexState.reconnectInterval);
        IndexState.reconnectInterval = null;
      }
    } else {
      // Schedule next attempt
      log(`Reconnection attempt ${IndexState.reconnectAttempts} failed, will retry...`);
      updateConnectionStatus('reconnecting');
    }
  }
}

/**
 * Initialize P2P connection for a room
 */
async function initializeP2P(roomId) {
  // Disconnect existing connection if any
  if (AppState.p2pConnection) {
    AppState.p2pConnection.disconnect();
  }

  // Get user ID
  const userId = getCurrentUserId();
  if (!userId || userId === 'Not initialized') {
    throw new Error('User not initialized');
  }

  // Create new P2P connection
  AppState.p2pConnection = new P2PConnection(userId, roomId, null);

  // Set up message handlers
  AppState.p2pConnection.onMessage((message, peerId) => {
    handleIncomingP2PMessage(message, peerId);
  });

  AppState.p2pConnection.onPeerConnected((peerId) => {
    log(`Peer connected: ${peerId}`);
    updatePeerCount();

    // Request message synchronization from new peer
    setTimeout(() => {
      requestMessageSync(roomId);
    }, 1000); // Small delay to ensure connection is stable

    // Send brief connection notification to peers
    setTimeout(() => {
      const userName = document.getElementById('userName').value || 'Anonymous';
      const connectMessage = {
        type: 'user-connected',
        senderId: getCurrentUserId(),
        senderName: userName,
        timestamp: Date.now()
      };
      AppState.p2pConnection.broadcast(connectMessage);
    }, 1000); // Shorter delay for better UX
  });

  AppState.p2pConnection.onPeerDisconnected((peerId) => {
    log(`Peer disconnected: ${peerId}`);
    // Clear draft message for disconnected peer
    AppState.draftMessages.delete(peerId);
    // Clear timeout for disconnected peer
    const existingTimeout = IndexState.draftTimeouts.get(peerId);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
      IndexState.draftTimeouts.delete(peerId);
    }
    // Update draft messages display
    updateDraftMessages();
    updatePeerCount();
  });

  AppState.p2pConnection.onConnectionLost((reason) => {
    log(`Connection lost: ${reason}`);

    // Update status immediately
    updateConnectionStatus('reconnecting');

    // Start reconnection if not already trying
    if (!IndexState.isReconnecting && IndexState.reconnectAttempts < IndexState.maxReconnectAttempts) {
      // Start first attempt after a short delay, then schedule interval for subsequent attempts
      setTimeout(attemptReconnect, 2000);
      if (!IndexState.reconnectInterval) {
        IndexState.reconnectInterval = setInterval(attemptReconnect, 8000); // Less aggressive - every 8 seconds
      }
    }
  });

  // Connect to signaling server
  try {
    await AppState.p2pConnection.connect();
    log('Connected to P2P network');
  } catch (error) {
    console.error('Failed to connect to P2P network:', error);
    log('Failed to connect to P2P network. Starting reconnection...');

    // Start reconnection attempts if not already reconnecting
    if (!IndexState.isReconnecting && IndexState.reconnectAttempts < IndexState.maxReconnectAttempts) {
      updateConnectionStatus('reconnecting');
      setTimeout(attemptReconnect, 3000); // Initial attempt after 3 seconds
      IndexState.reconnectInterval = setInterval(attemptReconnect, 8000); // Try every 8 seconds
    }
  }
}

/**
 * Handle incoming P2P messages
 */
function handleIncomingP2PMessage(message, peerId) {
  console.log(`📨 Handling incoming P2P message from ${peerId}:`, message.type, message.id || 'no-id');

  // For draft messages, we don't need to prevent duplicates since they should update in real-time
  if (message.type !== 'draft' && message.type !== 'clear-draft' && AppState.messageHistory.has(message.id)) {
    console.log(`🔄 Duplicate message detected, ignoring: ${message.id}`);
    return;
  }

  // Only store chat messages in history, not draft messages
  if (message.type === 'chat') {
    console.log(`💬 Processing chat message: ${message.id}`);
    AppState.messageHistory.set(message.id, message);
  }

  switch (message.type) {
    case 'chat':
      console.log(`💬 Displaying received chat message: "${message.content}" from ${message.sender}`);
      // Display chat message
      displayReceivedMessage(message);
      // Store in WASM for persistence
      try {
        const roomId = getCurrentRoomId();
        window.safeWasm.send_message(roomId, message.content, message.id);
        // Add to persistent chat history
        addMessageToHistory(roomId, message);
        console.log(`✅ Chat message stored and displayed successfully`);
      } catch (error) {
        console.error('Error storing message in WASM:', error);
      }
      break;

    case 'draft':
      // Handle real-time draft message
      handlePeerDraft(message, peerId);
      break;

    case 'clear-draft':
      // Clear peer's draft message
      clearPeerDraft(peerId);
      break;

    case 'sync-request':
      // Handle synchronization request from peer
      handleSyncRequest(message, peerId);
      break;

    case 'sync-response':
      // Handle synchronization response from peer
      handleSyncResponse(message, peerId);
      break;

    case 'user-connected':
      // Show brief connection notification
      showUserConnectionNotification(message.senderName);
      break;
  }
}

/**
 * Send a message to the current room
 */
function sendMessage() {
  debugLog(`🚀 ========== SENDMESSAGE STARTED ==========`);

  const messageInput = document.getElementById('messageInput');
  const rawMessage = messageInput.value;

  debugLog(`📝 Raw message input: "${rawMessage}"`);

  // Sanitize and validate the message
  const message = sanitizer.validateMessage(rawMessage);

  if (!message) {
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
    const rawUserName = document.getElementById('userName').value || 'Anonymous';
    const userName = sanitizer.validateUsername(rawUserName) || 'Anonymous';

    console.log(`📝 Sending message: userId=${userId}, userName=${userName}, messageId=${messageId}, roomId=${roomId}`);

    // Create message object
    const messageObj = {
      id: messageId,
      type: 'chat',
      content: message,
      sender: userName,
      senderId: getCurrentUserId(),
      timestamp: Date.now()
    };

    console.log(`📦 Created message object:`, messageObj);

    // Validate message object
    if (!messageObj.id || !messageObj.content || !messageObj.senderId) {
      console.error(`❌ Invalid message object:`, messageObj);
      log('Failed to create valid message object');
      return;
    }

    // Check P2P connection status
    console.log(`🌐 P2P Connection state:`, {
      hasConnection: !!AppState.p2pConnection,
      connectionId: AppState.p2pConnection?.clientId,
      roomConnected: AppState.p2pConnection?.roomId
    });

    // Send via P2P if connected
    if (AppState.p2pConnection) {
      debugLog(`📤 Broadcasting chat message...`);
      try {
        const result = AppState.p2pConnection.broadcast(messageObj);
        debugLog(`✅ P2P broadcast completed successfully`);
      } catch (broadcastError) {
        debugLog(`❌ P2P broadcast failed: ${broadcastError.message}`);
      }
    } else {
      debugLog(`❌ No P2P connection to broadcast message`);
    }

    // Store locally in WASM
    debugLog(`💾 Attempting to store in WASM...`);
    try {
      if (!window.safeWasm) {
        throw new Error('window.safeWasm is not available');
      }
      if (!window.safeWasm.send_message) {
        throw new Error('window.safeWasm.send_message function is missing');
      }

      debugLog(`💾 Calling WASM send_message...`);
      const wasmResult = window.safeWasm.send_message(roomId, message, messageId);
      debugLog(`✅ Message stored in WASM successfully`);
    } catch (wasmError) {
      debugLog(`❌ Failed to store message in WASM: ${wasmError.message}`);
      log(`Failed to store message: ${wasmError.message}`);
    }

    // Store in history to prevent duplicates
    console.log(`📚 Adding to message history: ${messageId}`);
    AppState.messageHistory.set(messageId, messageObj);
    console.log(`📚 AppState.messageHistory size after add:`, AppState.messageHistory.size);

    // Add to persistent chat history
    console.log(`🗂️ Attempting to add to persistent chat history...`);
    try {
      console.log(`🗂️ Calling addMessageToHistory for room: ${roomId}`);
      addMessageToHistory(roomId, messageObj);
      console.log(`✅ Message added to persistent history successfully`);

      // Verify it was added
      const roomHistory = AppState.chatHistory.get(roomId);
      console.log(`🗂️ Room history after add:`, {
        roomId: roomId,
        messageCount: roomHistory?.messages?.length || 0,
        lastMessage: roomHistory?.messages?.[roomHistory.messages.length - 1]
      });
    } catch (historyError) {
      console.error(`❌ Failed to add message to persistent history:`, historyError);
      console.error(`❌ History Error stack:`, historyError.stack);
    }

    // Clear input and send clear-draft message
    console.log(`🧹 Clearing input field`);
    messageInput.value = '';

    // Send clear draft message to peers
    if (AppState.p2pConnection) {
      console.log(`🧹 Broadcasting clear-draft message`);
      try {
        const clearResult = AppState.p2pConnection.broadcast({
          type: 'clear-draft',
          senderId: getCurrentUserId(),
          timestamp: Date.now()
        });
        console.log(`🧹 Clear-draft broadcast result:`, clearResult);
      } catch (clearError) {
        console.error(`❌ Failed to broadcast clear-draft:`, clearError);
      }
    }

    // Display the message in chat
    console.log(`🖥️ Displaying message in chat UI`);
    try {
      displayMessage(message, true, userName);
      console.log(`✅ Message displayed in UI successfully`);
    } catch (displayError) {
      console.error(`❌ Failed to display message in UI:`, displayError);
    }

    // Ensure chat stays scrolled to bottom after sending
    scrollChatToBottom('smooth', 50);

    // Retrieve messages for debugging
    console.log(`🔍 Scheduling message retrieval for verification...`);
    setTimeout(() => {
      console.log(`🔍 Retrieving messages for verification...`);
      retrieveMessages(roomId);
    }, 500);

    debugLog(`🏁 ========== SENDMESSAGE COMPLETED ==========`);
  } catch (error) {
    console.error(`💥 Critical error in sendMessage:`, error);
    console.error(`💥 Error stack:`, error.stack);
    log(`Error sending message: ${error.message}`);
  }
}

/**
 * Retrieve messages from the current room
 * @param {string} roomId - Room ID to get messages from
 */
function retrieveMessages(roomId) {
  console.log(`🔍 ========== RETRIEVE MESSAGES STARTED ==========`);
  console.log(`🔍 Retrieving messages for room: ${roomId}`);

  try {
    if (!window.safeWasm) {
      throw new Error('window.safeWasm is not available');
    }
    if (!window.safeWasm.get_messages) {
      throw new Error('window.safeWasm.get_messages function is missing');
    }

    console.log(`🔍 Calling WASM get_messages for room: ${roomId}`);
    const messagesResult = window.safeWasm.get_messages(roomId);
    console.log(`🔍 WASM get_messages returned:`, {
      type: typeof messagesResult,
      length: messagesResult?.length,
      value: messagesResult
    });

    // Parse the JSON string
    if (typeof messagesResult === 'string') {
      try {
        const messages = JSON.parse(messagesResult);
        console.log(`✅ Retrieved ${messages.length} messages from room ${roomId}`);
        console.log(`📋 Messages retrieved:`, messages);

        // Also check JavaScript-side message history
        const jsHistory = AppState.chatHistory.get(roomId);
        console.log(`📋 JS history comparison:`, {
          wasmMessageCount: messages.length,
          jsMessageCount: jsHistory?.messages?.length || 0,
          jsMessages: jsHistory?.messages || []
        });

        // Check if latest message persisted
        if (messages.length > 0) {
          const latestWasmMessage = messages[messages.length - 1];
          console.log(`🔍 Latest WASM message:`, latestWasmMessage);
        }

        log(`Retrieved ${messages.length} messages from room ${roomId}`);

        // In a real app, we would update the chat UI with all messages
      } catch (jsonError) {
        console.error("❌ Failed to parse messages JSON:", jsonError, "Raw JSON:", messagesResult);
      }
    } else {
      console.warn(`⚠️ Unexpected type from get_messages: ${typeof messagesResult}, value:`, messagesResult);
    }
  } catch (error) {
    console.error('❌ Error retrieving messages:', error);
    console.error('❌ Error stack:', error.stack);
  }

  console.log(`🔍 ========== RETRIEVE MESSAGES COMPLETED ==========`);
}

/**
 * Update connection status indicator
 * @param {boolean} isConnected - Whether connected to a room
 */
/**
 * Legacy function for backward compatibility
 */
function updateConnectionStatusLegacy(isConnected) {
  updateConnectionStatus(isConnected ? 'connected' : 'disconnected');
}

/**
 * Setup all event handlers for the UI
 */
function setupEventHandlers() {
  // Theme toggle functionality
  const themeToggleBtn = document.getElementById('themeToggleBtn');
  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', toggleTheme);
  } else {
    console.warn('themeToggleBtn element not found');
  }

  // Auto-initialize user on name change
  let initDebounceTimeout = null;
  const userNameInput = document.getElementById('userName');
  if (userNameInput) {
    userNameInput.addEventListener('input', (event) => {
      const userName = event.target.value.trim();

      // Clear existing timeout
      if (initDebounceTimeout) {
        clearTimeout(initDebounceTimeout);
      }

      // Debounce the initialization to avoid too many re-inits
      initDebounceTimeout = setTimeout(() => {
        if (userName) {
          handleInitializeUser(userName);
        }
      }, 500); // Wait 500ms after user stops typing
    });
  } else {
    console.warn('userName element not found');
  }

  // Room management
  const joinRoomBtn = document.getElementById('joinRoomBtn');
  if (joinRoomBtn) {
    joinRoomBtn.addEventListener('click', async () => {
      let roomId = document.getElementById('roomIdInput').value.trim();

      // Generate UUID if room ID is empty
      if (!roomId) {
        roomId = generateUUID();
      }

      try {
        await joinRoom(roomId);
        // Clear the input only after successfully joining
        const roomIdInput = document.getElementById('roomIdInput');
        if (roomIdInput) {
          roomIdInput.value = '';
        }
      } catch (error) {
        console.error('Failed to join room:', error);
        // Don't clear input if join failed
      }
    });
  } else {
    console.warn('joinRoomBtn element not found');
  }

  // Message sending
  const sendBtn = document.getElementById('sendBtn');
  if (sendBtn) {
    sendBtn.addEventListener('click', sendMessage);
  } else {
    console.warn('sendBtn element not found');
  }

  const messageInput = document.getElementById('messageInput');
  if (messageInput) {
    messageInput.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        sendMessage();
      }
    });

    // Real-time draft messages
    messageInput.addEventListener('input', handleDraftMessage);
  } else {
    console.warn('messageInput element not found');
  }

  // Share room functionality
  const shareRoomBtn = document.getElementById('shareRoomBtn');
  if (shareRoomBtn) {
    shareRoomBtn.addEventListener('click', shareCurrentRoom);
  } else {
    console.warn('shareRoomBtn element not found');
  }

  // Debug controls removed for production
}

/**
 * Handle user initialization
 */
function handleInitializeUser(userName = null) {
  // Use provided userName or get from input
  if (!userName) {
    userName = document.getElementById('userName').value || 'Anonymous';
  }
  try {
    // Generate user ID client-side
    const userId = generateUUID();

    // Initialize user in WASM module
    window.safeWasm.initialize(userName, userId);

    // Update tooltip with user ID
    const tooltip = document.getElementById('userIdTooltip');
    if (tooltip) {
      tooltip.textContent = userId;
    }

    // Store both username and user ID
    localStorage.setItem('userName', userName);
    localStorage.setItem('userId', userId);

    log(`Initialized user: ${userName} with ID: ${userId}`);
  } catch (error) {
    console.error('Error in handleInitializeUser:', error);
    log(`Error initializing user: ${error.message}`);
  }
}

/**
 * Handle real-time draft message updates
 */
function handleDraftMessage() {
  const roomId = getCurrentRoomId();
  if (!roomId) {
    return;
  }

  // Skip if not connected
  const statusElement = document.getElementById('connectionStatus');
  if (!statusElement.textContent.startsWith('Connected')) {
    return;
  }

  const messageInput = document.getElementById('messageInput');
  const content = messageInput.value;

  try {
    if (AppState.p2pConnection) {
      if (content.trim()) {
        // Send draft content to peers
        const draftMessage = {
          type: 'draft',
          content: content,
          senderId: getCurrentUserId(),
          senderName: document.getElementById('userName').value || 'Anonymous',
          timestamp: Date.now()
        };

        AppState.p2pConnection.broadcast(draftMessage);
      } else {
        // Send clear draft message when input is empty
        const clearMessage = {
          type: 'clear-draft',
          senderId: getCurrentUserId(),
          timestamp: Date.now()
        };

        AppState.p2pConnection.broadcast(clearMessage);
      }
    } else {
      console.warn('No P2P connection available for draft messages');
    }
  } catch (error) {
    console.error("Error handling draft message:", error);
  }
}

/**
 * Show user connection notification
 * @param {string} userName - Name of user who connected
 */
function showUserConnectionNotification(userName) {
  // Create temporary notification in draft area
  const draftsArea = document.getElementById('draftsArea');
  if (draftsArea) {
    // Show draft area temporarily
    draftsArea.style.display = 'block';

    // Create connection notification
    const notification = document.createElement('div');
    notification.className = 'mb-2 p-2 bg-green-100 dark:bg-green-900/40 border border-green-400 dark:border-green-500 rounded opacity-90';

    const contentElement = document.createElement('div');
    contentElement.className = 'text-xs text-green-800 dark:text-green-200 italic text-center';
    contentElement.textContent = `${userName} connected`;
    notification.appendChild(contentElement);

    draftsArea.appendChild(notification);

    // Remove notification after 2 seconds
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
        // Hide draft area if no other drafts
        if (draftsArea.children.length === 0) {
          draftsArea.style.display = 'none';
        }
      }
    }, 2000);
  }

  log(`${userName} connected`);
}



/**
 * Update debug output area
 * @param {string} message - Message to display
 */
function updateDebugOutput(message) {
  // Debug output removed for production - using console.error instead
  console.error('Debug:', message);
}

/**
 * Visual debug system for mobile devices
 */
let debugVisible = false;

function debugLog(message) {
  logger.debug(message);

  // Also add to visual debug panel
  const debugContent = document.getElementById('debugContent');
  if (debugContent) {
    const timestamp = new Date().toLocaleTimeString();
    debugContent.textContent += `[${timestamp}] ${message}\n`;
    debugContent.scrollTop = debugContent.scrollHeight;

    // Only auto-show debug panel if debug mode is enabled
    const debugToggleBtn = document.getElementById('debugToggleBtn');
    if (debugToggleBtn && debugToggleBtn.style.display !== 'none' && !debugVisible) {
      showDebugPanel();
    }
  }
}

function showDebugPanel() {
  const debugPanel = document.getElementById('debugPanel');
  if (debugPanel) {
    debugPanel.style.display = 'block';
    debugVisible = true;

    const toggleBtn = document.getElementById('debugToggleBtn');
    if (toggleBtn) {
      toggleBtn.textContent = '🐛 Hide';
    }
  }
}

function hideDebugPanel() {
  const debugPanel = document.getElementById('debugPanel');
  if (debugPanel) {
    debugPanel.style.display = 'none';
    debugVisible = false;

    const toggleBtn = document.getElementById('debugToggleBtn');
    if (toggleBtn) {
      toggleBtn.textContent = '🐛 Debug';
    }
  }
}

function clearDebugPanel() {
  const debugContent = document.getElementById('debugContent');
  if (debugContent) {
    debugContent.textContent = '';
  }
}

/**
 * Enable debug mode via console
 */
function enableDebugMode() {
  const debugToggleBtn = document.getElementById('debugToggleBtn');
  if (debugToggleBtn) {
    debugToggleBtn.style.display = 'inline-block';
    console.log('🐛 Debug mode enabled! Debug button is now visible.');
    return true;
  }
  console.error('Debug button not found');
  return false;
}

/**
 * Disable debug mode
 */
function disableDebugMode() {
  const debugToggleBtn = document.getElementById('debugToggleBtn');
  const debugPanel = document.getElementById('debugPanel');

  if (debugToggleBtn) {
    debugToggleBtn.style.display = 'none';
  }
  if (debugPanel) {
    debugPanel.style.display = 'none';
  }
  debugVisible = false;

  console.log('🐛 Debug mode disabled.');
  return true;
}

// Make debug functions available globally for console access
window.enableDebugMode = enableDebugMode;
window.disableDebugMode = disableDebugMode;
window.showDebugPanel = showDebugPanel;
window.hideDebugPanel = hideDebugPanel;
window.clearDebugPanel = clearDebugPanel;

// Log debug commands availability (only in development)
if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
  console.log('%c🐛 Debug Commands Available:', 'color: #f39c12; font-weight: bold;');
  console.log('%cenableDebugMode()', 'color: #3498db; font-family: monospace;', '- Show debug button and enable visual debugging');
  console.log('%cdisableDebugMode()', 'color: #3498db; font-family: monospace;', '- Hide debug button and disable visual debugging');
  console.log('%cshowDebugPanel()', 'color: #3498db; font-family: monospace;', '- Show debug panel (if debug mode enabled)');
  console.log('%chideDebugPanel()', 'color: #3498db; font-family: monospace;', '- Hide debug panel');
  console.log('%cclearDebugPanel()', 'color: #3498db; font-family: monospace;', '- Clear debug panel contents');
}

/**
 * Share room URL by room ID
 * @param {string} roomId - The room ID to share
 */
async function shareRoomById(roomId) {
  if (!roomId) {
    alert('Invalid room ID.');
    return;
  }

  const shareUrl = generateShareableURL(roomId);

  // Try to use Web Share API if available
  if (navigator.share) {
    try {
      await navigator.share({
        title: 'Join my Mindline chat room',
        text: `Join my secure P2P chat room: ${roomId}`,
        url: shareUrl,
      });
      return;
    } catch (error) {
      // Fall back to clipboard if user cancels or error occurs
    }
  }

  // Fallback: Copy to clipboard
  try {
    await navigator.clipboard.writeText(shareUrl);
    // Show temporary feedback
    showTemporaryMessage('Room link copied to clipboard!');
  } catch (error) {
    // Ultimate fallback: show URL in prompt
    prompt('Copy this room link to share:', shareUrl);
  }
}

/**
 * Share current room URL (legacy function for backward compatibility)
 */
async function shareCurrentRoom() {
  const roomId = getCurrentRoomId();
  if (!roomId) {
    alert('No room to share. Create or join a room first.');
    return;
  }

  await shareRoomById(roomId);
}

/**
 * Show temporary feedback message
 */
function showTemporaryMessage(message) {
  // Create a temporary toast notification
  const toast = document.createElement('div');
  toast.className = 'fixed top-4 right-4 bg-green-500 text-white px-4 py-2 border-2 border-black dark:border-white shadow-lg z-50';
  toast.textContent = message;
  document.body.appendChild(toast);

  // Remove after 3 seconds
  setTimeout(() => {
    if (toast.parentNode) {
      toast.parentNode.removeChild(toast);
    }
  }, 3000);
}

/**
 * Update room display and connection section visibility
 */

/**
 * Update room history UI
 */
function updateRoomHistoryUI() {
  const historyContainer = document.getElementById('roomHistoryList');
  if (!historyContainer) {
    console.warn('Room history container not found, skipping update');
    return;
  }

  const history = getRoomHistory();
  const currentRoom = getCurrentRoomId();

  if (history.length === 0) {
    historyContainer.innerHTML = `
      <div class="text-sm text-gray-500 dark:text-gray-400 text-center py-4">
        No recent rooms
      </div>
    `;
    return;
  }

  const historyHTML = history.map(room => {
    const isCurrentRoom = room.id === currentRoom;
    const timeAgo = formatTimeAgo(room.lastJoined);

    return `
      <div class="flex items-center justify-between p-2 border-2 border-gray-300 dark:border-gray-600 hover:border-black dark:hover:border-white transition-colors ${isCurrentRoom ? 'bg-gray-200 dark:bg-gray-700' : 'bg-gray-100 dark:bg-gray-800'} cursor-pointer group"
           onclick="joinRoomFromHistory('${room.id}')"
           title="Click to join room">
        <div class="flex-1 min-w-0">
          <div class="font-mono text-sm truncate ${isCurrentRoom ? 'font-bold' : ''}">${room.id}</div>
          <div class="text-xs text-gray-500 dark:text-gray-400">${timeAgo}</div>
        </div>
        <div class="flex items-center gap-1">
          ${isCurrentRoom ? `
            <span class="text-xs text-success dark:text-success-dark font-bold mr-2">CURRENT</span>
          ` : ''}
          <button onclick="event.stopPropagation(); shareRoomById('${room.id}')"
                  class="opacity-0 group-hover:opacity-100 p-1 text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 transition-opacity"
                  title="Share room link">
            <svg class="w-3 h-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.367 2.684 3 3 0 00-5.367-2.684z" />
            </svg>
          </button>
          ${!isCurrentRoom ? `
            <button onclick="event.stopPropagation(); removeRoomFromHistory('${room.id}')"
                    class="opacity-0 group-hover:opacity-100 p-1 text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 transition-opacity"
                    title="Remove from history">
              <svg class="w-3 h-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');

  historyContainer.innerHTML = historyHTML;
}

/**
 * Format timestamp to relative time
 */
function formatTimeAgo(timestamp) {
  const now = Date.now();
  const diff = now - timestamp;

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;

  return new Date(timestamp).toLocaleDateString();
}

/**
 * Join room from history (called by onclick)
 */
async function joinRoomFromHistory(roomId) {
  if (!roomId) return;

  // Check if we're already in this room
  const currentRoom = getCurrentRoomId();
  if (currentRoom === roomId) {
    return; // Already in this room
  }

  // Join the room
  try {
    await joinRoom(roomId);
  } catch (error) {
    console.error('Failed to join room from history:', error);
  }
}

/**
 * Global functions to make them available to inline onclick
 */
window.joinRoomFromHistory = joinRoomFromHistory;
window.removeRoomFromHistory = removeRoomFromHistory;
window.shareRoomById = shareRoomById;


/**
 * Toggle between light and dark themes
 */
function toggleTheme() {
  // Toggle on both documentElement and body for consistency
  document.documentElement.classList.toggle('dark');
  document.body.classList.toggle('dark');
  const isDark = document.documentElement.classList.contains('dark');
  localStorage.setItem('theme', isDark ? 'dark' : 'light');

  // Update icon visibility
  const sunIcon = document.getElementById('sunIcon');
  const moonIcon = document.getElementById('moonIcon');
  if (sunIcon && moonIcon) {
    if (isDark) {
      moonIcon.classList.add('hidden');
      sunIcon.classList.remove('hidden');
    } else {
      sunIcon.classList.add('hidden');
      moonIcon.classList.remove('hidden');
    }
  }
}

/**
 * Initialize theme based on user preference
 */
function initializeTheme() {
  const savedTheme = localStorage.getItem('theme');
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;

  // Ensure both documentElement and body have the correct class
  if (savedTheme === 'dark' || (savedTheme === null && prefersDark)) {
    document.documentElement.classList.add('dark');
    document.body.classList.add('dark');
  } else {
    // Explicitly remove dark class if light theme
    document.documentElement.classList.remove('dark');
    document.body.classList.remove('dark');
  }

  // Update icon visibility based on current theme
  const isDark = document.documentElement.classList.contains('dark');
  const sunIcon = document.getElementById('sunIcon');
  const moonIcon = document.getElementById('moonIcon');
  if (sunIcon && moonIcon) {
    if (isDark) {
      moonIcon.classList.add('hidden');
      sunIcon.classList.remove('hidden');
    } else {
      sunIcon.classList.add('hidden');
      moonIcon.classList.remove('hidden');
    }
  }
}

/**
 * Connect the new UI elements with WASM functionality
 */
function connectNewUIWithWasm() {
  // Skip if WASM isn't loaded
  if (!window.safeWasm) {
    console.warn("Cannot connect UI - safe WASM proxies not available");
    return;
  }

  // Event handlers are already set up in setupEventHandlers(), just log success

  log('New UI successfully connected to WASM functionality');

  // Debug function for connection issues (development only)
  window.debugConnections = () => {
    if (AppState.p2pConnection) {
      const connectedPeers = AppState.p2pConnection.getConnectedPeers();
      const totalPeers = AppState.p2pConnection.peers.size;
      const connectedCount = connectedPeers.length;
      const healthRate = totalPeers > 0 ? (connectedCount / totalPeers * 100).toFixed(1) : 100;

      return {
        myId: getCurrentUserId(),
        roomId: getCurrentRoomId(),
        totalPeers,
        connectedPeers,
        healthRate: `${healthRate}%`,
        draftCount: AppState.draftMessages.size,
        reconnectAttempts: IndexState.reconnectAttempts,
        isReconnecting: IndexState.isReconnecting
      };
    }
  };

  // Test message broadcasting (development only)
  window.testBroadcast = (message = 'Test message') => {
    if (AppState.p2pConnection) {
      const result = AppState.p2pConnection.broadcast({
        type: 'test',
        content: message,
        senderId: getCurrentUserId(),
        timestamp: Date.now()
      });
      return result;
    }
  };
}


// Display received message from P2P
function displayReceivedMessage(messageObj) {
  displayMessage(messageObj.content, false, messageObj.sender);

  // Ensure chat scrolls to show new message from peer
  scrollChatToBottom('smooth', 50);
}

// Update peer count display
function updatePeerCount() {
  if (AppState.p2pConnection) {
    const connectedPeers = AppState.p2pConnection.getConnectedPeers();
    const peerCount = connectedPeers.length;
    const statusText = peerCount > 0 ? `Connected (${peerCount} peer${peerCount !== 1 ? 's' : ''})` : 'Connected';
    const statusElement = document.getElementById('connectionStatus');
    if (statusElement.textContent !== 'Disconnected') {
      statusElement.textContent = statusText;
    }

  }
}

// Handle peer draft message
function handlePeerDraft(message, peerId) {
  const senderName = message.senderName || message.senderId || peerId;

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

  // Set a timeout to automatically clear draft after inactivity
  const timeout = setTimeout(() => {
    AppState.draftMessages.delete(peerId);
    IndexState.draftTimeouts.delete(peerId);
    updateDraftMessages();
  }, CONSTANTS.TIMEOUT_DRAFT_CLEAR);

  IndexState.draftTimeouts.set(peerId, timeout);

  // Update the draft messages display
  updateDraftMessages();
}

// Clear peer's draft message
function clearPeerDraft(peerId) {
  AppState.draftMessages.delete(peerId);

  // Clear timeout for this peer
  const existingTimeout = IndexState.draftTimeouts.get(peerId);
  if (existingTimeout) {
    clearTimeout(existingTimeout);
    IndexState.draftTimeouts.delete(peerId);
  }

  updateDraftMessages();
}

// Update draft messages display
function updateDraftMessages() {
  const draftsArea = document.getElementById('draftsArea');
  if (!draftsArea) {
    console.warn('Drafts area element not found');
    return;
  }

  // Clear existing drafts
  draftsArea.innerHTML = '';

  // Check if we have any drafts to show
  const activeDrafts = Array.from(AppState.draftMessages.values()).filter(draft => draft.content.trim());

  if (activeDrafts.length === 0) {
    // Hide draft area when no drafts
    draftsArea.style.display = 'none';
    return;
  }

  // Show draft area
  draftsArea.style.display = 'block';

  // Add header showing how many people are typing
  if (activeDrafts.length > 1) {
    const headerElement = document.createElement('div');
    headerElement.className = 'text-xs font-bold text-yellow-700 dark:text-yellow-300 mb-1 px-1';
    headerElement.textContent = `${activeDrafts.length} people are typing:`;
    draftsArea.appendChild(headerElement);
  }

  // Display each peer's draft message
  AppState.draftMessages.forEach((draft, peerId) => {
    if (draft.content.trim()) {
      const draftElement = document.createElement('div');
      draftElement.className = 'draft-message mb-2 p-2 bg-yellow-100 dark:bg-yellow-900/50 border border-yellow-400 dark:border-yellow-500 rounded opacity-90';

      // Add sender name and content in one line for compact display
      const contentElement = document.createElement('div');
      contentElement.className = 'text-xs text-gray-800 dark:text-gray-200';
      contentElement.innerHTML = `<span class="font-bold italic text-yellow-800 dark:text-yellow-200">${draft.senderName} is typing:</span> <span class="italic text-gray-700 dark:text-gray-300">"${draft.content}"</span>`;
      draftElement.appendChild(contentElement);

      draftsArea.appendChild(draftElement);
    }
  });

  // Scroll draft area to bottom if it has overflow
  draftsArea.scrollTop = draftsArea.scrollHeight;
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  // Clear reconnection attempts
  if (IndexState.reconnectInterval) {
    clearInterval(IndexState.reconnectInterval);
  }

  if (AppState.p2pConnection) {
    AppState.p2pConnection.disconnect();
  }
});

// Initialize the application when DOM is loaded
document.addEventListener('DOMContentLoaded', initializeApp);