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
  typingPeers: new Set(), // Track who is typing
  typingTimeouts: new Map(), // Track timeouts for each typing peer
  chatHistory: new Map() // Store chat history per room: roomId -> {messages: [], lastSync: timestamp}
};

// Constants
const CONSTANTS = {
  TIMEOUT_TYPING: 2000,
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
    send_typing_indicator: safeWasmCall('send_typing_indicator', ['roomId', 'isTyping'], {
      isTyping: Boolean
    }),
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

    // Update UI and localStorage
    document.getElementById('currentRoom').textContent = roomId;
    document.getElementById('roomIdInput').value = roomId;
    localStorage.setItem('currentRoomId', roomId);

    // Update connection status
    updateConnectionStatus(true);

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

    // Update UI and localStorage
    document.getElementById('currentRoom').textContent = roomId;
    localStorage.setItem('currentRoomId', roomId);

    // Update connection status
    updateConnectionStatus(true);

    log(`Joined room: ${roomId}`);
    return roomId;
  } catch (error) {
    log(`Error joining room: ${error.message}`);
    updateConnectionStatus(false);
    return null;
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
    updatePeerCount();
  });

  AppState.p2pConnection.onPeerDisconnected((peerId) => {
    log(`Peer disconnected: ${peerId}`);
    // Clear typing state for disconnected peer
    AppState.typingPeers.delete(peerId);
    // Clear timeout for disconnected peer
    const existingTimeout = AppState.typingTimeouts.get(peerId);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
      AppState.typingTimeouts.delete(peerId);
    }
    // Update typing indicator
    updateTypingIndicator();
    updatePeerCount();
  });

  // Connect to signaling server
  try {
    await AppState.p2pConnection.connect();
    log('Connected to P2P network');
  } catch (error) {
    console.error('Failed to connect to P2P network:', error);
    log('Failed to connect to P2P network. Make sure signaling server is running.');
  }
}

/**
 * Handle incoming P2P messages
 */
function handleIncomingP2PMessage(message, peerId) {
  // Prevent duplicate messages
  if (AppState.messageHistory.has(message.id)) {
    return;
  }

  AppState.messageHistory.set(message.id, message);

  switch (message.type) {
    case 'chat':
      // Display chat message
      displayReceivedMessage(message);
      // Store in WASM for persistence
      try {
        const roomId = getCurrentRoomId();
        window.safeWasm.send_message(roomId, message.content, message.id);
      } catch (error) {
        console.error('Error storing message in WASM:', error);
      }
      break;

    case 'typing':
      // Use sender name instead of peer ID for typing indicator
      const senderName = message.senderName || message.senderId || peerId;
      showPeerTyping(senderName, true);
      break;

    case 'stopped-typing':
      // Use sender name instead of peer ID for typing indicator
      const stopSenderName = message.senderName || message.senderId || peerId;
      showPeerTyping(stopSenderName, false);
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

    messageInput.value = '';

    // Display the message in chat
    displayMessage(message, true, userName);

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
  
  // Typing indicator
  document.getElementById('messageInput').addEventListener('input', handleTypingIndicator);
  
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
 * Handle typing indicator updates
 */
function handleTypingIndicator() {
  const roomId = getCurrentRoomId();
  if (!roomId) return;

  // Skip typing indicator if not connected
  const statusElement = document.getElementById('connectionStatus');
  if (!statusElement.textContent.startsWith('Connected')) return;

  try {
    // Send typing indicator via P2P
    if (AppState.p2pConnection) {
      AppState.p2pConnection.broadcast({
        type: 'typing',
        senderId: document.getElementById('userId').textContent,
        senderName: document.getElementById('userName').value || 'Anonymous',
        timestamp: Date.now()
      });
    }

    // Send typing indicator to WASM (for local tracking)
    window.safeWasm.send_typing_indicator(roomId, true);

    // Clear existing timeout and set a new one
    clearTimeout(AppState.typingTimeout);
    AppState.typingTimeout = setTimeout(() => {
      try {
        // Send stopped typing via P2P
        if (AppState.p2pConnection) {
          AppState.p2pConnection.broadcast({
            type: 'stopped-typing',
            senderId: document.getElementById('userId').textContent,
            senderName: document.getElementById('userName').value || 'Anonymous',
            timestamp: Date.now()
          });
        }
        window.safeWasm.send_typing_indicator(roomId, false);
      } catch (error) {
        console.error("Error stopping typing indicator:", error);
      }
    }, CONSTANTS.TIMEOUT_TYPING);
  } catch (error) {
    console.error("Error handling typing indicator:", error);
  }
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

  // Connect typing indicator
  document.getElementById('messageInput').addEventListener('input', handleTypingIndicator);

  log('New UI successfully connected to WASM functionality');
}

// Override display message function to work with the new UI
function displayMessage(message, isMe = true, senderName = null) {
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

  // Smooth scroll to bottom
  chatArea.scrollTo({
    top: chatArea.scrollHeight,
    behavior: 'smooth'
  });
}

// Display received message from P2P
function displayReceivedMessage(messageObj) {
  displayMessage(messageObj.content, false, messageObj.sender);
}

// Update peer count display
function updatePeerCount() {
  if (AppState.p2pConnection) {
    const peerCount = AppState.p2pConnection.getConnectedPeers().length;
    const statusText = peerCount > 0 ? `Connected (${peerCount} peer${peerCount !== 1 ? 's' : ''})` : 'Connected';
    const statusElement = document.getElementById('connectionStatus');
    if (statusElement.textContent !== 'Disconnected') {
      statusElement.textContent = statusText;
    }
  }
}

// Show peer typing indicator
function showPeerTyping(peerId, isTyping) {
  if (isTyping && peerId) {
    AppState.typingPeers.add(peerId);

    // Clear any existing timeout for this peer
    const existingTimeout = AppState.typingTimeouts.get(peerId);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    // Set a timeout to automatically remove typing indicator after 5 seconds
    const timeout = setTimeout(() => {
      AppState.typingPeers.delete(peerId);
      AppState.typingTimeouts.delete(peerId);
      updateTypingIndicator();
    }, 5000);

    AppState.typingTimeouts.set(peerId, timeout);
  } else if (peerId) {
    AppState.typingPeers.delete(peerId);

    // Clear timeout for this peer
    const existingTimeout = AppState.typingTimeouts.get(peerId);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
      AppState.typingTimeouts.delete(peerId);
    }
  }

  updateTypingIndicator();
}

// Update typing indicator display
function updateTypingIndicator() {
  const typingIndicator = document.getElementById('typingIndicator');
  if (AppState.typingPeers.size > 0) {
    const typingList = Array.from(AppState.typingPeers).slice(0, 3); // Show max 3 names
    const text = typingList.length === 1
      ? `${typingList[0]} is typing...`
      : `${typingList.join(', ')} ${typingList.length > 1 ? 'are' : 'is'} typing...`;
    typingIndicator.textContent = text;
    typingIndicator.style.display = 'block';
  } else {
    typingIndicator.style.display = 'none';
  }
}

// Override show typing indicator function
function showTypingIndicator(isTyping) {
  document.getElementById('typingIndicator').style.display = isTyping ? 'block' : 'none';
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  if (AppState.p2pConnection) {
    AppState.p2pConnection.disconnect();
  }
});

// Initialize the application when DOM is loaded
document.addEventListener('DOMContentLoaded', initializeApp);