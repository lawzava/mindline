import '../css/styles.css';
import { P2PConnection } from './webrtc.js';

/**
 * Mindline Chat Application
 * Enterprise-ready implementation of a P2P encrypted chat application
 */

// Application state
const AppState = {
  wasmModule: null,
  typingTimeout: null,
  initialized: false,
  darkMode: false,
  p2pConnection: null,
  messageHistory: new Map(), // Store messages by ID to avoid duplicates
  draftMessages: new Map(), // Store draft messages by peer ID: peerId -> {content, senderName, lastUpdate}
  draftTimeouts: new Map(), // Track timeouts for clearing stale drafts
  chatHistory: new Map(), // Store chat history per room: roomId -> {messages: [], lastSync: timestamp}
  reconnectAttempts: 0, // Track reconnection attempts
  maxReconnectAttempts: 5, // Max reconnection attempts
  reconnectInterval: null, // Store reconnection interval
  isReconnecting: false // Track if currently reconnecting
};

// Constants
const CONSTANTS = {
  TIMEOUT_DRAFT_CLEAR: 3000, // Clear draft after 3 seconds of inactivity
  MIN_ROOM_ID_LENGTH: 8
};

/**
 * Initialize the application
 */
async function initializeApp() {
  try {
    console.log('=== APP START ===');
    console.log('Starting application initialization...');
    console.log('Initial localStorage check:');
    console.log('- userName:', localStorage.getItem('userName'));
    console.log('- userId:', localStorage.getItem('userId'));
    console.log('- currentRoomId:', localStorage.getItem('currentRoomId'));

    // Initialize theme preference
    initializeTheme();

    // Load WASM module first
    await loadWasmModule();
    createSafeWasmProxies();

    console.log('WASM loaded, restoring user state...');

    // Restore user state
    await restoreUserState();

    // Connect UI elements
    connectNewUIWithWasm();

    // Initialize event handlers
    setupEventHandlers();

    const roomId = getCurrentRoomId();
    updateConnectionStatus(Boolean(roomId));

    // Ensure chat is scrolled to bottom after full initialization
    if (roomId) {
      scrollChatToBottom('auto', 500);
    }

    log('Application initialized successfully');
  } catch (error) {
    console.error('Failed to initialize application:', error);
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
    AppState.wasmModule = initialized;
    
    updateDebugOutput('WASM module loaded successfully!');
    console.log('WASM module loaded successfully!');
    return true;
  } catch (err) {
    updateDebugOutput(`Error loading WASM module: ${err.message}`);
    console.error('Error loading WASM module:', err);
    throw err;
  }
}

/**
 * Create safe proxy functions to handle WebAssembly calls
 */
function createSafeWasmProxies() {
  if (!AppState.wasmModule) {
    console.warn("WASM module not loaded, cannot create safe proxies");
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
      console.log(`Safe ${funcName} proxy called with:`, ...args);
      
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
      console.log(`Safe ${funcName} calling original with:`, safeArgs);
      const result = AppState.wasmModule[funcName](...safeArgs);
      
      // Special handling for get_messages result
      if (funcName === 'get_messages') {
        if (Array.isArray(result)) {
          console.warn(`Detected memory pointer, returning empty array ${result}`);
          return "[]";
        }
      }
      
      return result;
    } catch (error) {
      console.error(`Error in ${funcName}:`, error);
      throw error;
    }
  };
}

/**
 * Generate a UUID v4
 * @returns {string} Generated UUID
 */
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
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
      console.log(`Loaded ${parsed.messages?.length || 0} messages for room ${roomId}`);
      return parsed.messages || [];
    } else {
      AppState.chatHistory.set(roomId, {
        messages: [],
        lastSync: 0
      });
      return [];
    }
  } catch (error) {
    console.error('Error loading chat history:', error);
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
    console.log(`Saved ${roomHistory.messages.length} messages for room ${roomId}`);
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
  const roomHistory = AppState.chatHistory.get(roomId);
  if (!roomHistory) {
    AppState.chatHistory.set(roomId, {
      messages: [message],
      lastSync: 0
    });
  } else {
    // Check if message already exists (avoid duplicates)
    const exists = roomHistory.messages.some(msg => msg.id === message.id);
    if (!exists) {
      roomHistory.messages.push(message);
      // Sort messages by timestamp
      roomHistory.messages.sort((a, b) => a.timestamp - b.timestamp);
    }
  }

  // Save to localStorage
  saveChatHistory(roomId);
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
 * Display chat history in the UI
 * @param {Array} messages - Array of message objects
 */
function displayChatHistory(messages) {
  const chatArea = document.getElementById('chatArea');
  const welcomeMessage = document.getElementById('welcomeMessage');

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
      const isMe = message.senderId === document.getElementById('userId').textContent;
      displayMessage(message.content, isMe, message.sender, false); // false = don't scroll yet
    });

    // Scroll to bottom after all messages are displayed - use immediate scroll for page load
    scrollChatToBottom('auto', 100);
  }

  // Ensure draft area is ready (it's now in HTML, not dynamically created)
  const draftsArea = document.getElementById('draftsArea');
  if (draftsArea) {
    draftsArea.style.display = 'none'; // Hidden by default
  }
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

  console.log(`Requesting message sync for room ${roomId}, lastSync: ${lastSync}, messageCount: ${messageCount}`);

  const syncRequest = {
    type: 'sync-request',
    roomId: roomId,
    lastSync: lastSync,
    messageCount: messageCount,
    requesterId: document.getElementById('userId').textContent,
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

  console.log(`Received sync request from ${peerId} for room ${roomId}`);

  const roomHistory = AppState.chatHistory.get(roomId);
  if (!roomHistory) {
    console.log('No history for this room, ignoring sync request');
    return;
  }

  // Find messages that peer might be missing (newer than their lastSync)
  const missingMessages = roomHistory.messages.filter(msg =>
    msg.timestamp > peerLastSync
  );

  console.log(`Found ${missingMessages.length} potentially missing messages for peer`);

  if (missingMessages.length > 0) {
    const syncResponse = {
      type: 'sync-response',
      roomId: roomId,
      messages: missingMessages,
      senderId: document.getElementById('userId').textContent,
      timestamp: Date.now()
    };

    if (AppState.p2pConnection) {
      AppState.p2pConnection.sendToPeer(peerId, syncResponse);
    }
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

  console.log(`Received sync response from ${peerId} with ${newMessages.length} messages`);

  if (newMessages.length === 0) {
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
      const isMe = msg.senderId === document.getElementById('userId').textContent;
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
 * Get the current room ID safely
 * @returns {string|null} Current room ID or null
 */
function getCurrentRoomId() {
  // First try localStorage
  let roomId = localStorage.getItem('currentRoomId');
  
  // If not in localStorage, try the UI element
  if (!roomId) {
    const roomElement = document.getElementById('currentRoom');
    if (roomElement && roomElement.textContent !== 'None') {
      roomId = roomElement.textContent;
    }
  }
  
  // Validate the room ID format
  if (!isValidRoomId(roomId)) {
    if (roomId) {
      console.warn(`Invalid room ID format: ${roomId}`);
    }
    return null;
  }
  
  return roomId;
}

/**
 * Restore user state from localStorage
 */
async function restoreUserState() {
  console.log('=== restoreUserState called ===');

  if (!window.safeWasm) {
    console.warn("Safe WASM proxies not created yet, cannot restore state safely");
    return;
  }

  console.log('Safe WASM available, proceeding with user restoration...');

  // Check what's in localStorage
  console.log('Current localStorage contents:');
  console.log('- userName:', localStorage.getItem('userName'));
  console.log('- userId:', localStorage.getItem('userId'));
  console.log('- currentRoomId:', localStorage.getItem('currentRoomId'));

  // Initialize user if needed
  restoreUserInfo();

  // Restore room connection
  await restoreRoomConnection();
}

/**
 * Restore user information from localStorage
 */
function restoreUserInfo() {
  const userIdElement = document.getElementById('userId');
  const userIdText = userIdElement.textContent.trim();

  console.log('Current userId element text:', userIdText);

  // Check if user needs initialization (handle HTML whitespace)
  const needsInitialization = userIdText.includes('Not') && userIdText.includes('initialized');
  console.log('needsInitialization:', needsInitialization);

  if (needsInitialization) {
    try {
      // Restore both username and user ID from localStorage
      const savedUserName = localStorage.getItem('userName');
      const savedUserId = localStorage.getItem('userId');

      console.log('Saved userName:', savedUserName);
      console.log('Saved userId:', savedUserId);

      if (savedUserName && savedUserId) {
        // Restore saved user data
        window.safeWasm.initialize(savedUserName, savedUserId);
        document.getElementById('userId').textContent = savedUserId;
        document.getElementById('userName').value = savedUserName;

        log(`Restored user: ${savedUserName} with ID: ${savedUserId}`);
        return;
      }

      // No saved data, initialize with current values or defaults
      const userName = document.getElementById('userName').value || 'Anonymous';
      const userId = generateUUID();

      window.safeWasm.initialize(userName, userId);
      document.getElementById('userId').textContent = userId;

      // Store both username and user ID
      localStorage.setItem('userName', userName);
      localStorage.setItem('userId', userId);

      log(`Initialized new user: ${userName} with ID: ${userId}`);
    } catch (error) {
      console.error("Could not initialize user:", error);
      log(`Error initializing user: ${error.message}`);
    }
  } else {
    console.log('User already initialized, skipping restoration');
  }
}

/**
 * Restore room connection from localStorage
 */
async function restoreRoomConnection() {
  const savedRoomId = localStorage.getItem('currentRoomId');
  console.log("Restoring room ID from localStorage:", savedRoomId);

  if (!savedRoomId || !isValidRoomId(savedRoomId)) {
    updateConnectionStatus(false);
    return;
  }

  document.getElementById('currentRoom').textContent = savedRoomId;
  document.getElementById('roomIdInput').value = savedRoomId;

  try {
    // Try to join the room in WASM
    const connectionToken = window.safeWasm.join_room(savedRoomId, "{}");
    console.log("Room joined successfully, token:", connectionToken);

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

    updateConnectionStatus(true);
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

      updateConnectionStatus(true);
      log(`Created room with previous ID: ${savedRoomId}`);
    } catch (createError) {
      console.error("Failed to create room as fallback:", createError);
      log(`Failed to create room: ${createError.message}`);
      updateConnectionStatus(false);
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

    // Create the room in the WASM module
    window.safeWasm.create_room_with_id(roomId);

    // Initialize P2P connection
    await initializeP2P(roomId);

    // Load and display chat history
    const messages = loadChatHistory(roomId);
    displayChatHistory(messages);

    // Update UI and localStorage
    document.getElementById('currentRoom').textContent = roomId;
    document.getElementById('roomIdInput').value = roomId;
    localStorage.setItem('currentRoomId', roomId);

    // Update connection status
    updateConnectionStatus(true);

    // Scroll to bottom after room creation
    scrollChatToBottom('auto', 200);

    log(`Created and joined room: ${roomId}`);
    return roomId;
  } catch (error) {
    log(`Error creating room: ${error.message}`);
    updateConnectionStatus(false);
    return null;
  }
}

/**
 * Join an existing chat room
 * @param {string} roomId - Room ID to join
 * @returns {string|null} The room ID or null if failed
 */
async function joinRoom(roomId) {
  if (!roomId) {
    log('Please enter a room ID to join');
    return null;
  }

  // Basic ID validation
  if (!isValidRoomId(roomId)) {
    log(`Room ID must be at least ${CONSTANTS.MIN_ROOM_ID_LENGTH} alphanumeric characters (can include dashes and underscores)`);
    return null;
  }

  try {
    // Join the room
    const connectionToken = window.safeWasm.join_room(roomId, '{}');

    // Initialize P2P connection
    await initializeP2P(roomId);

    // Load and display chat history
    const messages = loadChatHistory(roomId);
    displayChatHistory(messages);

    // Update UI and localStorage
    document.getElementById('currentRoom').textContent = roomId;
    localStorage.setItem('currentRoomId', roomId);

    // Update connection status
    updateConnectionStatus(true);

    // Scroll to bottom after joining room
    scrollChatToBottom('auto', 200);

    log(`Joined room: ${roomId}`);
    return roomId;
  } catch (error) {
    log(`Error joining room: ${error.message}`);
    updateConnectionStatus(false);
    return null;
  }
}

/**
 * Attempt to reconnect P2P connection
 */
async function attemptReconnect() {
  const roomId = getCurrentRoomId();
  if (!roomId || AppState.isReconnecting) {
    return;
  }

  AppState.isReconnecting = true;
  AppState.reconnectAttempts++;

  log(`Reconnection attempt ${AppState.reconnectAttempts}/${AppState.maxReconnectAttempts}...`);

  // Update status to show reconnecting
  const statusElement = document.getElementById('connectionStatus');
  statusElement.textContent = `Reconnecting... (${AppState.reconnectAttempts}/${AppState.maxReconnectAttempts})`;
  statusElement.className = 'status status-reconnecting';

  try {
    // Wait a bit before trying to reconnect
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Try to reinitialize P2P connection
    await initializeP2P(roomId);

    // If successful, reset reconnection state
    AppState.reconnectAttempts = 0;
    AppState.isReconnecting = false;
    if (AppState.reconnectInterval) {
      clearInterval(AppState.reconnectInterval);
      AppState.reconnectInterval = null;
    }

    log('Reconnection successful!');
  } catch (error) {
    console.error('Reconnection failed:', error);
    AppState.isReconnecting = false;

    if (AppState.reconnectAttempts >= AppState.maxReconnectAttempts) {
      // Give up after max attempts
      log(`Reconnection failed after ${AppState.maxReconnectAttempts} attempts`);
      statusElement.textContent = 'Connection failed';
      statusElement.className = 'status status-disconnected';

      if (AppState.reconnectInterval) {
        clearInterval(AppState.reconnectInterval);
        AppState.reconnectInterval = null;
      }
    } else {
      // Schedule next attempt
      log(`Reconnection attempt ${AppState.reconnectAttempts} failed, will retry...`);
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
  const userId = document.getElementById('userId').textContent;
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
    console.log('P2P connection established with peer:', peerId);
    updatePeerCount();

    // Request message synchronization from new peer
    setTimeout(() => {
      requestMessageSync(roomId);
    }, 1000); // Small delay to ensure connection is stable

    // Send brief connection notification to peers
    setTimeout(() => {
      console.log('Sending connection notification to peers...');
      const userName = document.getElementById('userName').value || 'Anonymous';
      const connectMessage = {
        type: 'user-connected',
        senderId: document.getElementById('userId').textContent,
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
    const existingTimeout = AppState.draftTimeouts.get(peerId);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
      AppState.draftTimeouts.delete(peerId);
    }
    // Update draft messages display
    updateDraftMessages();
    updatePeerCount();
  });

  AppState.p2pConnection.onConnectionLost((reason) => {
    log(`Connection lost: ${reason}`);
    console.log('Connection lost, starting reconnection attempts...');

    // Update status immediately
    updateConnectionStatus(false);

    // Start reconnection if not already trying
    if (!AppState.isReconnecting && AppState.reconnectAttempts < AppState.maxReconnectAttempts) {
      // Start immediate first attempt, then schedule interval for subsequent attempts
      setTimeout(attemptReconnect, 1000);
      AppState.reconnectInterval = setInterval(attemptReconnect, 5000);
    }
  });

  // Connect to signaling server
  try {
    await AppState.p2pConnection.connect();
    log('Connected to P2P network');
    console.log('P2P connection initialized for room:', roomId);

    // Log connection status every 5 seconds for debugging
    const connectionLogger = setInterval(() => {
      const connectedPeers = AppState.p2pConnection.getConnectedPeers();
      console.log('Current connected peers:', connectedPeers.length, connectedPeers);
    }, 5000);

    // Store interval reference for cleanup
    AppState.connectionLogger = connectionLogger;
  } catch (error) {
    console.error('Failed to connect to P2P network:', error);
    log('Failed to connect to P2P network. Starting reconnection...');

    // Start reconnection attempts if not already reconnecting
    if (!AppState.isReconnecting && AppState.reconnectAttempts < AppState.maxReconnectAttempts) {
      AppState.reconnectInterval = setInterval(attemptReconnect, 5000); // Try every 5 seconds
    }
  }
}

/**
 * Handle incoming P2P messages
 */
function handleIncomingP2PMessage(message, peerId) {
  console.log('handleIncomingP2PMessage received:', message.type, 'from peer:', peerId);

  // For draft messages, we don't need to prevent duplicates since they should update in real-time
  if (message.type !== 'draft' && message.type !== 'clear-draft' && AppState.messageHistory.has(message.id)) {
    console.log('Ignoring duplicate message:', message.id);
    return;
  }

  // Only store chat messages in history, not draft messages
  if (message.type === 'chat') {
    AppState.messageHistory.set(message.id, message);
  }

  switch (message.type) {
    case 'chat':
      // Display chat message
      displayReceivedMessage(message);
      // Store in WASM for persistence
      try {
        const roomId = getCurrentRoomId();
        window.safeWasm.send_message(roomId, message.content, message.id);
        // Add to persistent chat history
        addMessageToHistory(roomId, message);
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
  const messageInput = document.getElementById('messageInput');
  const message = messageInput.value.trim();

  if (!message) return;

  // Get the current room ID safely
  const roomId = getCurrentRoomId();
  if (!roomId) {
    log('Please create or join a room first');
    return;
  }

  try {
    // Generate message ID on client side
    const messageId = generateUUID();
    const userName = document.getElementById('userName').value || 'Anonymous';

    // Create message object
    const messageObj = {
      id: messageId,
      type: 'chat',
      content: message,
      sender: userName,
      senderId: document.getElementById('userId').textContent,
      timestamp: Date.now()
    };

    // Send via P2P if connected
    if (AppState.p2pConnection) {
      AppState.p2pConnection.broadcast(messageObj);
    }

    // Store locally in WASM
    window.safeWasm.send_message(roomId, message, messageId);

    // Store in history to prevent duplicates
    AppState.messageHistory.set(messageId, messageObj);

    // Add to persistent chat history
    addMessageToHistory(roomId, messageObj);

    // Clear input and send clear-draft message
    messageInput.value = '';

    // Send clear draft message to peers
    if (AppState.p2pConnection) {
      AppState.p2pConnection.broadcast({
        type: 'clear-draft',
        senderId: document.getElementById('userId').textContent,
        timestamp: Date.now()
      });
    }

    // Display the message in chat
    displayMessage(message, true, userName);

    // Ensure chat stays scrolled to bottom after sending
    scrollChatToBottom('smooth', 50);

    // Retrieve messages for debugging
    setTimeout(retrieveMessages, 500, roomId);
  } catch (error) {
    log(`Error sending message: ${error.message}`);
  }
}

/**
 * Retrieve messages from the current room
 * @param {string} roomId - Room ID to get messages from
 */
function retrieveMessages(roomId) {
  try {
    // Get messages from the WASM module
    console.log("Retrieving messages for room:", roomId);
    const messagesResult = window.safeWasm.get_messages(roomId);
    console.log("Retrieved messages:", messagesResult);
    
    // Parse the JSON string
    if (typeof messagesResult === 'string') {
      try {
        const messages = JSON.parse(messagesResult);
        log(`Retrieved ${messages.length} messages from room ${roomId}`);
        
        // In a real app, we would update the chat UI with all messages
      } catch (jsonError) {
        console.error("Failed to parse messages JSON:", jsonError, "Raw JSON:", messagesResult);
      }
    } else {
      console.warn(`Unexpected type from get_messages: ${typeof messagesResult}`);
    }
  } catch (error) {
    console.error('Error retrieving messages:', error);
  }
}

/**
 * Update connection status indicator
 * @param {boolean} isConnected - Whether connected to a room
 */
function updateConnectionStatus(isConnected) {
  const statusElement = document.getElementById('connectionStatus');
  if (isConnected) {
    statusElement.textContent = 'Connected';
    statusElement.className = 'status status-connected';
  } else {
    statusElement.textContent = 'Disconnected';
    statusElement.className = 'status status-disconnected';
  }
}

/**
 * Setup all event handlers for the UI
 */
function setupEventHandlers() {
  // Theme toggle functionality
  document.getElementById('themeToggleBtn').addEventListener('click', toggleTheme);
  
  // Initialize user
  document.getElementById('initializeBtn').addEventListener('click', handleInitializeUser);
  
  // Room management
  document.getElementById('createRoomBtn').addEventListener('click', async () => await createRoom());
  document.getElementById('joinRoomBtn').addEventListener('click', async () => {
    const roomId = document.getElementById('roomIdInput').value;
    await joinRoom(roomId);
  });
  
  // Message sending
  document.getElementById('sendBtn').addEventListener('click', sendMessage);
  document.getElementById('messageInput').addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      sendMessage();
    }
  });
  
  // Real-time draft messages
  document.getElementById('messageInput').addEventListener('input', handleDraftMessage);
  
  // Debug controls
  document.getElementById('clearLogBtn').addEventListener('click', () => {
    document.getElementById('debugOutput').textContent = '';
    log('Debug log cleared');
  });
}

/**
 * Handle user initialization
 */
function handleInitializeUser() {
  const userName = document.getElementById('userName').value || 'Anonymous';
  try {
    // Generate user ID client-side
    const userId = generateUUID();

    console.log('=== handleInitializeUser ===');
    console.log('userName:', userName);
    console.log('generated userId:', userId);

    // Initialize user in WASM module
    window.safeWasm.initialize(userName, userId);

    // Update UI
    document.getElementById('userId').textContent = userId;

    // Store both username and user ID
    localStorage.setItem('userName', userName);
    localStorage.setItem('userId', userId);

    console.log('Stored to localStorage:');
    console.log('- userName:', localStorage.getItem('userName'));
    console.log('- userId:', localStorage.getItem('userId'));

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
    console.log('No room ID, skipping draft message');
    return;
  }

  // Skip if not connected
  const statusElement = document.getElementById('connectionStatus');
  if (!statusElement.textContent.startsWith('Connected')) {
    console.log('Not connected, skipping draft message');
    return;
  }

  const messageInput = document.getElementById('messageInput');
  const content = messageInput.value;

  console.log('handleDraftMessage called with content:', content);

  try {
    if (AppState.p2pConnection) {
      const connectedPeers = AppState.p2pConnection.getConnectedPeers();
      console.log('Connected peers:', connectedPeers.length);

      if (content.trim()) {
        // Send draft content to peers
        const draftMessage = {
          type: 'draft',
          content: content,
          senderId: document.getElementById('userId').textContent,
          senderName: document.getElementById('userName').value || 'Anonymous',
          timestamp: Date.now()
        };

        console.log('Sending draft message:', draftMessage);
        const delivered = AppState.p2pConnection.broadcast(draftMessage);
        const connectedPeersList = AppState.p2pConnection.getConnectedPeers();
        console.log('Draft message delivered to', delivered, 'of', connectedPeersList.length, 'connected peers:', connectedPeersList);
      } else {
        // Send clear draft message when input is empty
        const clearMessage = {
          type: 'clear-draft',
          senderId: document.getElementById('userId').textContent,
          timestamp: Date.now()
        };

        console.log('Sending clear draft message:', clearMessage);
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
 * Scroll chat area to bottom
 * @param {string} behavior - 'smooth' or 'auto'
 * @param {number} delay - Delay in milliseconds
 */
function scrollChatToBottom(behavior = 'smooth', delay = 50) {
  setTimeout(() => {
    const chatArea = document.getElementById('chatArea');
    if (chatArea) {
      chatArea.scrollTo({
        top: chatArea.scrollHeight,
        behavior: behavior
      });
    }
  }, delay);
}

/**
 * Log message to debug output
 * @param {string} message - Message to log
 */
function log(message) {
  console.log(message);
  updateDebugOutput(`${new Date().toLocaleTimeString()} - ${message}`);
}

/**
 * Update debug output area
 * @param {string} message - Message to display
 */
function updateDebugOutput(message) {
  const debugOutput = document.getElementById('debugOutput');
  debugOutput.textContent = `${message}\n${debugOutput.textContent}`;
}


/**
 * Toggle between light and dark themes
 */
function toggleTheme() {
  const body = document.body;
  const isDarkMode = AppState.darkMode;
  
  if (isDarkMode) {
    body.classList.remove('dark-mode');
    body.classList.add('light-mode');
    AppState.darkMode = false;
    localStorage.setItem('theme', 'light');
  } else {
    body.classList.remove('light-mode');
    body.classList.add('dark-mode');
    AppState.darkMode = true;
    localStorage.setItem('theme', 'dark');
  }
}

/**
 * Initialize theme based on user preference
 */
function initializeTheme() {
  const savedTheme = localStorage.getItem('theme');
  const prefersDarkMode = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  
  if (savedTheme === 'dark' || (savedTheme === null && prefersDarkMode)) {
    document.body.classList.remove('light-mode');
    document.body.classList.add('dark-mode');
    AppState.darkMode = true;
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

  // Theme toggle functionality
  document.getElementById('themeToggleBtn').addEventListener('click', () => {
    document.body.classList.toggle('dark');
    const isDark = document.body.classList.contains('dark');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
  });

  // Initialize theme based on preference
  const savedTheme = localStorage.getItem('theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

  if (savedTheme === 'dark' || (savedTheme === null && prefersDark)) {
    document.body.classList.add('dark');
  }

  // Connect Create Room button
  document.getElementById('createRoomBtn').addEventListener('click', async () => {
    await createRoom();
  });

  // Connect Join Room button
  document.getElementById('joinRoomBtn').addEventListener('click', async () => {
    const roomId = document.getElementById('roomIdInput').value;
    await joinRoom(roomId);
  });

  // Connect Send Message button
  document.getElementById('sendBtn').addEventListener('click', () => {
    sendMessage();
  });

  // Connect Enter key on message input
  document.getElementById('messageInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      sendMessage();
    }
  });

  // Connect clear debug log button
  document.getElementById('clearLogBtn').addEventListener('click', () => {
    document.getElementById('debugOutput').textContent = '';
    log('Debug log cleared');
  });

  // Connect initialize user button
  document.getElementById('initializeBtn').addEventListener('click', () => {
    handleInitializeUser();
  });

  // Connect real-time draft messages
  document.getElementById('messageInput').addEventListener('input', handleDraftMessage);

  log('New UI successfully connected to WASM functionality');

  // Add debug function to window for testing multi-user connections
  window.debugConnections = () => {
    if (AppState.p2pConnection) {
      const connectedPeers = AppState.p2pConnection.getConnectedPeers();
      console.log('=== CONNECTION DEBUG ===');
      console.log('My client ID:', document.getElementById('userId').textContent);
      console.log('Connected peers:', connectedPeers.length, connectedPeers);
      console.log('Draft messages in state:', AppState.draftMessages.size);
      AppState.draftMessages.forEach((draft, peerId) => {
        console.log(`  - ${peerId}: "${draft.content}" (${draft.senderName})`);
      });
      console.log('=======================');
      return {
        myId: document.getElementById('userId').textContent,
        connectedPeers,
        draftCount: AppState.draftMessages.size
      };
    }
  };
}

// Override display message function to work with the new UI
function displayMessage(message, isMe = true, senderName = null, shouldScroll = true) {
  const chatArea = document.getElementById('chatArea');
  const welcomeMessage = document.getElementById('welcomeMessage');

  // Hide welcome message when first message is displayed
  if (welcomeMessage) {
    welcomeMessage.style.display = 'none';
  }

  const messageElement = document.createElement('div');

  if (isMe) {
    messageElement.className = 'ml-auto max-w-[75%] mb-4 p-3 bg-primary/20 dark:bg-primary-dark/30 border-2 border-black dark:border-white shadow-md rounded-lg';
  } else {
    messageElement.className = 'mr-auto max-w-[75%] mb-4 p-3 bg-gray-200 dark:bg-gray-700 border-2 border-black dark:border-white shadow-md rounded-lg';
  }

  // Add sender name if provided
  if (senderName) {
    const nameElement = document.createElement('div');
    nameElement.className = 'font-bold text-sm mb-1 text-primary dark:text-primary-dark';
    nameElement.textContent = senderName;
    messageElement.appendChild(nameElement);
  }

  const contentElement = document.createElement('div');
  contentElement.textContent = message;
  contentElement.className = 'break-words';
  messageElement.appendChild(contentElement);

  chatArea.appendChild(messageElement);

  // Smooth scroll to bottom if requested
  if (shouldScroll) {
    chatArea.scrollTo({
      top: chatArea.scrollHeight,
      behavior: 'smooth'
    });
  }
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

    // Log for debugging multi-user issues
    console.log('Peer count updated:', peerCount, 'peers:', connectedPeers);
  }
}

// Handle peer draft message
function handlePeerDraft(message, peerId) {
  console.log('handlePeerDraft called with message:', message, 'from peer:', peerId);

  const senderName = message.senderName || message.senderId || peerId;

  // Store the draft message
  AppState.draftMessages.set(peerId, {
    content: message.content,
    senderName: senderName,
    lastUpdate: Date.now()
  });

  console.log('Stored draft message for peer:', peerId, 'content:', message.content);

  // Clear any existing timeout for this peer
  const existingTimeout = AppState.draftTimeouts.get(peerId);
  if (existingTimeout) {
    clearTimeout(existingTimeout);
  }

  // Set a timeout to automatically clear draft after inactivity
  const timeout = setTimeout(() => {
    console.log('Clearing draft message for peer:', peerId, 'due to timeout');
    AppState.draftMessages.delete(peerId);
    AppState.draftTimeouts.delete(peerId);
    updateDraftMessages();
  }, CONSTANTS.TIMEOUT_DRAFT_CLEAR);

  AppState.draftTimeouts.set(peerId, timeout);

  // Update the draft messages display
  updateDraftMessages();
}

// Clear peer's draft message
function clearPeerDraft(peerId) {
  console.log('clearPeerDraft called for peer:', peerId);

  AppState.draftMessages.delete(peerId);

  // Clear timeout for this peer
  const existingTimeout = AppState.draftTimeouts.get(peerId);
  if (existingTimeout) {
    clearTimeout(existingTimeout);
    AppState.draftTimeouts.delete(peerId);
  }

  updateDraftMessages();
}

// Update draft messages display
function updateDraftMessages() {
  console.log('updateDraftMessages called, draft messages count:', AppState.draftMessages.size);

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
    console.log('No active drafts, hiding draft area');
    return;
  }

  // Show draft area
  draftsArea.style.display = 'block';
  console.log('Showing draft area with', activeDrafts.length, 'drafts');

  // Add header showing how many people are typing
  if (activeDrafts.length > 1) {
    const headerElement = document.createElement('div');
    headerElement.className = 'text-xs font-bold text-yellow-700 dark:text-yellow-300 mb-1 px-1';
    headerElement.textContent = `${activeDrafts.length} people are typing:`;
    draftsArea.appendChild(headerElement);
  }

  // Display each peer's draft message
  AppState.draftMessages.forEach((draft, peerId) => {
    console.log('Processing draft for peer:', peerId, 'content:', draft.content);

    if (draft.content.trim()) {
      console.log('Creating draft element for peer:', peerId);

      const draftElement = document.createElement('div');
      draftElement.className = 'draft-message mb-2 p-2 bg-yellow-100 dark:bg-yellow-900/50 border border-yellow-400 dark:border-yellow-500 rounded opacity-90';

      // Add sender name and content in one line for compact display
      const contentElement = document.createElement('div');
      contentElement.className = 'text-xs text-gray-800 dark:text-gray-200';
      contentElement.innerHTML = `<span class="font-bold italic text-yellow-800 dark:text-yellow-200">${draft.senderName} is typing:</span> <span class="italic text-gray-700 dark:text-gray-300">"${draft.content}"</span>`;
      draftElement.appendChild(contentElement);

      draftsArea.appendChild(draftElement);
      console.log('Draft element added to DOM');
    } else {
      console.log('Draft content is empty, skipping');
    }
  });

  console.log('Finished updating draft messages, DOM children count:', draftsArea.children.length);

  // Scroll draft area to bottom if it has overflow
  draftsArea.scrollTop = draftsArea.scrollHeight;
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  // Clear reconnection attempts
  if (AppState.reconnectInterval) {
    clearInterval(AppState.reconnectInterval);
  }

  // Clear connection logger
  if (AppState.connectionLogger) {
    clearInterval(AppState.connectionLogger);
  }

  if (AppState.p2pConnection) {
    AppState.p2pConnection.disconnect();
  }
});

// Initialize the application when DOM is loaded
document.addEventListener('DOMContentLoaded', initializeApp);