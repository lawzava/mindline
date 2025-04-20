import '../css/styles.css';

/**
 * Mindline Chat Application
 * Enterprise-ready implementation of a P2P encrypted chat application
 */

// Application state
const AppState = {
  wasmModule: null,
  typingTimeout: null,
  initialized: false,
  darkMode: false
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
    // Initialize theme preference
    initializeTheme();

    await loadWasmModule();
    createSafeWasmProxies();
    restoreUserState();
    
    const roomId = getCurrentRoomId();
    updateConnectionStatus(Boolean(roomId));
    
    // Initialize event handlers
    setupEventHandlers();
    
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
function restoreUserState() {
  if (!window.safeWasm) {
    console.warn("Safe WASM proxies not created yet, cannot restore state safely");
    return;
  }
  
  // Initialize user if needed
  restoreUserInfo();
  
  // Restore room connection
  restoreRoomConnection();
}

/**
 * Restore user information from localStorage
 */
function restoreUserInfo() {
  if (document.getElementById('userId').textContent === 'Not initialized') {
    try {
      const savedUserName = localStorage.getItem('userName');
      const savedUserId = localStorage.getItem('userId');
      
      // If we have both values, use them
      if (savedUserId && savedUserName) {
        window.safeWasm.initialize(savedUserName, savedUserId);
        document.getElementById('userId').textContent = savedUserId;
        document.getElementById('userName').value = savedUserName;
        log(`Restored user: ${savedUserName}`);
        return;
      }
      
      // Otherwise initialize with new values
      const userName = document.getElementById('userName').value || 'Anonymous';
      const userId = generateUUID();
      
      window.safeWasm.initialize(userName, userId);
      document.getElementById('userId').textContent = userId;
      
      localStorage.setItem('userId', userId);
      localStorage.setItem('userName', userName);
      
      log(`Initialized user: ${userName} with ID: ${userId}`);
    } catch (error) {
      console.error("Could not initialize user:", error);
      log(`Error initializing user: ${error.message}`);
    }
  }
}

/**
 * Restore room connection from localStorage
 */
function restoreRoomConnection() {
  const savedRoomId = localStorage.getItem('currentRoomId');
  console.log("Restoring room ID from localStorage:", savedRoomId);
  
  if (!savedRoomId || !isValidRoomId(savedRoomId)) {
    updateConnectionStatus(false);
    return;
  }
  
  document.getElementById('currentRoom').textContent = savedRoomId;
  document.getElementById('roomIdInput').value = savedRoomId;
  
  try {
    // Try to join the room
    const connectionToken = window.safeWasm.join_room(savedRoomId, "{}");
    console.log("Room joined successfully, token:", connectionToken);
    updateConnectionStatus(true);
    log(`Restored previous room: ${savedRoomId}`);
  } catch (error) {
    console.warn("Could not join saved room:", error);
    log(`Could not rejoin room: ${error.message}`);
    
    // Try creating the room instead
    try {
      window.safeWasm.create_room_with_id(savedRoomId);
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
function createRoom() {
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
function joinRoom(roomId) {
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
    
    // Send the message
    window.safeWasm.send_message(roomId, message, messageId);
    messageInput.value = '';
    
    // Display the message in chat
    displayMessage(message, true);
    
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
    const messagesResult = window.safeWasm.get_messages(roomId);
    
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
  document.getElementById('createRoomBtn').addEventListener('click', () => createRoom());
  document.getElementById('joinRoomBtn').addEventListener('click', () => {
    const roomId = document.getElementById('roomIdInput').value;
    joinRoom(roomId);
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
    
    // Initialize user in WASM module
    window.safeWasm.initialize(userName, userId);
    
    // Update UI
    document.getElementById('userId').textContent = userId;
    
    // Store in localStorage
    localStorage.setItem('userId', userId);
    localStorage.setItem('userName', userName);
    
    log(`Initialized user: ${userName} with ID: ${userId}`);
  } catch (error) {
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
  if (statusElement.textContent !== 'Connected') return;
  
  try {
    // Send typing indicator
    window.safeWasm.send_typing_indicator(roomId, true);
    
    // Show typing indicator in UI
    showTypingIndicator(true);
    
    // Clear existing timeout and set a new one
    clearTimeout(AppState.typingTimeout);
    AppState.typingTimeout = setTimeout(() => {
      try {
        window.safeWasm.send_typing_indicator(roomId, false);
        showTypingIndicator(false);
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

// Initialize the application
document.addEventListener('DOMContentLoaded', initializeApp);

// Add this to the end of your existing index.js file

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
  document.getElementById('createRoomBtn').addEventListener('click', () => {
    createRoom();
  });
  
  // Connect Join Room button
  document.getElementById('joinRoomBtn').addEventListener('click', () => {
    const roomId = document.getElementById('roomIdInput').value;
    joinRoom(roomId);
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
function displayMessage(message, isMe = true) {
  const chatArea = document.getElementById('chatArea');
  const messageElement = document.createElement('div');
  
  if (isMe) {
    messageElement.className = 'ml-auto max-w-[75%] mb-4 p-3 bg-primary/20 dark:bg-primary-dark/30 border-2 border-black dark:border-white shadow-md';
  } else {
    messageElement.className = 'mr-auto max-w-[75%] mb-4 p-3 bg-gray-200 dark:bg-gray-700 border-2 border-black dark:border-white shadow-md';
  }
  
  messageElement.textContent = message;
  chatArea.appendChild(messageElement);
  chatArea.scrollTop = chatArea.scrollHeight;
}

// Override show typing indicator function
function showTypingIndicator(isTyping) {
  document.getElementById('typingIndicator').style.display = isTyping ? 'block' : 'none';
}

// Add this to your initialization code
document.addEventListener('DOMContentLoaded', () => {
  // First load WASM module as usual
  loadWasmModule().then(() => {
    createSafeWasmProxies();
    restoreUserState();
    
    // Then connect the UI elements
    connectNewUIWithWasm();
    
    const roomId = getCurrentRoomId();
    updateConnectionStatus(Boolean(roomId));
  }).catch(error => {
    console.error('Failed to initialize application:', error);
    updateDebugOutput(`Error initializing application: ${error.message}`);
  });
});