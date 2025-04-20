import '../css/styles.css';

// We'll use a dynamic import to load the WASM module after it's been built
let wasmModule;

// Use an async function to load the module
async function loadWasmModule() {
    try {
        // Dynamically import the module
        const wasm = await import('../pkg/mindline.js');
        // Initialize the module
        const initialized = await wasm.default();
        wasmModule = initialized;
        
        document.getElementById('debugOutput').textContent = 'WASM module loaded successfully!';
        console.log('WASM module loaded successfully!');
        // Setup event handlers after module is fully loaded
        setTimeout(() => {
            setupEventHandlers();
            log('Event handlers initialized');
        }, 100);
        return true;
    } catch (err) {
        document.getElementById('debugOutput').textContent = `Error loading WASM module: ${err}`;
        console.error('Error loading WASM module:', err);
        return false;
    }
}

// Helper function to generate a UUID in JavaScript
function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// Helper function to validate alphanumeric ID format (min 8 chars)
function isValidRoomId(id) {
    if (!id || typeof id !== 'string') return false;
    // Allow alphanumeric plus dashes and underscores, minimum 8 characters
    const idRegex = /^[a-zA-Z0-9_-]{8,}$/;
    return idRegex.test(id);
}

// Helper function to safely get the current room ID
function getCurrentRoomId() {
    // First try localStorage
    let roomId = localStorage.getItem('currentRoomId');
    
    // If not in localStorage, try the UI element
    if (!roomId) {
        roomId = document.getElementById('currentRoom').textContent;
        if (roomId === 'None') {
            return null;
        }
    }
    
    // Validate the room ID format
    if (!isValidRoomId(roomId)) {
        log(`Warning: Invalid room ID format: ${roomId}`);
        return null;
    }
    
    return String(roomId);
}

// Fixed restoreState function that uses the safe proxies
function restoreState() {
    // Check if WASM module is loaded
    if (!wasmModule) {
        console.warn("WASM module not loaded yet, cannot restore state");
        return;
    }
    
    // Make sure safe proxies are available
    if (!window.safeWasm) {
        console.warn("Safe WASM proxies not created yet, cannot restore state safely");
        return;
    }
    
    // Initialize with default username if not yet initialized
    if (document.getElementById('userId').textContent === 'Not initialized') {
        try {
            const userName = document.getElementById('userName').value || 'Anonymous';
            // Generate user ID client-side
            const userId = generateUUID();
            
            // Initialize user in WASM module using safe proxy
            window.safeWasm.initialize(userName, userId);
            
            // Update UI
            document.getElementById('userId').textContent = userId;
            
            // Store in localStorage
            localStorage.setItem('userId', userId);
            localStorage.setItem('userName', userName);
            
            log(`Auto-initialized user: ${userName} with ID: ${userId}`);
        } catch (error) {
            console.warn("Could not auto-initialize user:", error);
            log(`Error initializing user: ${error.message}`);
        }
    }
    
    // Restore room ID if available
    const savedRoomId = localStorage.getItem('currentRoomId');
    console.log("Restoring room ID from localStorage:", savedRoomId);
    
    // Check if it's a valid room ID
    if (savedRoomId && isValidRoomId(savedRoomId)) {
        document.getElementById('currentRoom').textContent = savedRoomId;
        document.getElementById('roomIdInput').value = savedRoomId;
        
        // Try to join the room automatically - using safe proxy
        try {
            console.log("Joining room with safe proxy:", savedRoomId);
            
            // Call join_room with the safe proxy
            const connectionToken = window.safeWasm.join_room(savedRoomId, "{}");
            
            // If we get here, the join was successful
            console.log("Join succeeded, token:", connectionToken);
            updateConnectionStatus(true);
            log(`Restored and rejoined previous room: ${savedRoomId}`);
        } catch (error) {
            // Actually handle the error this time!
            console.warn("Could not join saved room:", error);
            log(`Could not rejoin room: ${error.message}`);
            
            // Try a different approach - create the room instead
            try {
                console.log("Attempting to create room instead:", savedRoomId);
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
}


// Create proxy functions instead of trying to replace the original functions
// This avoids the "read-only" property error

// Create safe proxy functions for WASM calls
function createSafeWasmProxies() {
    // Only proceed if WASM module is loaded
    if (!wasmModule) {
        console.warn("WASM module not loaded, cannot create safe proxies");
        return;
    }
    
    console.log("Creating safe WASM function proxies");
    
    // Create safe proxy functions - these don't modify the original functions
    window.safeWasm = {
        // Safe join_room proxy
        join_room: function(roomId, signalData) {
            console.log("Safe join_room proxy called with:", roomId);
            
            // Ensure parameters are strings
            const safeRoomId = String(roomId || "");
            const safeSignalData = String(signalData || "{}");
            
            // Check for empty room ID
            if (!safeRoomId) {
                throw new Error("Room ID cannot be empty");
            }
            
            console.log(`Safe join_room calling original with: "${safeRoomId}", "${safeSignalData}"`);
            return wasmModule.join_room(safeRoomId, safeSignalData);
        },
        
        // Safe create_room_with_id proxy
        create_room_with_id: function(roomId) {
            console.log("Safe create_room_with_id proxy called with:", roomId);
            
            // Ensure parameter is a string
            const safeRoomId = String(roomId || "");
            
            // Check for empty room ID
            if (!safeRoomId) {
                throw new Error("Room ID cannot be empty");
            }
            
            console.log(`Safe create_room_with_id calling original with: "${safeRoomId}"`);
            return wasmModule.create_room_with_id(safeRoomId);
        },
        
        // Safe send_message proxy
        send_message: function(roomId, content, messageId) {
            console.log("Safe send_message proxy called with:", roomId, content, messageId);
            
            // Ensure parameters are strings
            const safeRoomId = String(roomId || "");
            const safeContent = String(content || "");
            const safeMessageId = String(messageId || "");
            
            // Check for empty room ID
            if (!safeRoomId) {
                throw new Error("Room ID cannot be empty");
            }
            
            // Check for empty message ID
            if (!safeMessageId) {
                throw new Error("Message ID cannot be empty");
            }
            
            console.log(`Safe send_message calling original with: "${safeRoomId}", "${safeContent}", "${safeMessageId}"`);
            return wasmModule.send_message(safeRoomId, safeContent, safeMessageId);
        },
        
        // Safe send_typing_indicator proxy
        send_typing_indicator: function(roomId, isTyping) {
            console.log("Safe send_typing_indicator proxy called with:", roomId, isTyping);
            
            // Ensure room ID is a string
            const safeRoomId = String(roomId || "");
            
            // Make sure isTyping is a boolean
            const safeIsTyping = Boolean(isTyping);
            
            // Check for empty room ID
            if (!safeRoomId) {
                throw new Error("Room ID cannot be empty");
            }
            
            console.log(`Safe send_typing_indicator calling original with: "${safeRoomId}", ${safeIsTyping}`);
            return wasmModule.send_typing_indicator(safeRoomId, safeIsTyping);
        },
        
        // Add other WASM functions as needed
        initialize: function(userName, userId) {
            console.log("Safe initialize proxy called with:", userName, userId);
            
            // Ensure parameters are strings
            const safeUserName = String(userName || "");
            const safeUserId = String(userId || "");
            
            // Check for empty user ID
            if (!safeUserId) {
                throw new Error("User ID cannot be empty");
            }
            
            console.log(`Safe initialize calling original with: "${safeUserName}", "${safeUserId}"`);
            return wasmModule.initialize(safeUserName, safeUserId);
        },
        
        // Safe get_messages proxy (if you decide to keep using it)
        get_messages: function(roomId) {
            console.log("Safe get_messages proxy called with:", roomId);
            
            // Ensure parameter is a string
            const safeRoomId = String(roomId || "");
            
            // Check for empty room ID
            if (!safeRoomId) {
                console.log("Room ID is empty, returning empty array");
                return "[]";
            }
            
            console.log(`Safe get_messages calling original with: "${safeRoomId}"`);
            try {
                const result = wasmModule.get_messages(safeRoomId);
                console.log("get_messages result type:", typeof result);
                
                // Handle the memory pointer array issue
                if (Array.isArray(result)) {
                    console.log("Detected memory pointer, returning empty array");
                    return "[]";
                }
                
                return result;
            } catch (error) {
                console.error("Error in get_messages:", error);
                return "[]";
            }
        }
    };
    
    log("Created safe WASM function proxies in window.safeWasm");
}

// Call this after WASM module is loaded
loadWasmModule().then(() => {
    // After module is loaded, create safe proxies first
    createSafeWasmProxies();
    
    // Then restore state and update connection status
    restoreState();
    
    // Make sure connection status is updated based on current room
    const roomId = getCurrentRoomId();
    if (roomId) {
        updateConnectionStatus(true);
    } else {
        updateConnectionStatus(false);
    }
});

// Create room function (client-side ID generation)
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
            log("Room ID must be at least 8 alphanumeric characters (can include dashes and underscores)");
            return null;
        }
        
        // Create the room in the WASM module
        wasmModule.create_room_with_id(roomId);
        
        // Update UI and localStorage
        document.getElementById('currentRoom').textContent = roomId;
        document.getElementById('roomIdInput').value = roomId;
        localStorage.setItem('currentRoomId', roomId);
        
        // Update connection status
        updateConnectionStatus(true);
        
        log(`Created and joined room: ${roomId}`);
        return roomId;
    } catch (error) {
        log(`Error creating room: ${error}`);
        updateConnectionStatus(false);
        return null;
    }
}

// Join room function (client-side validation)
function joinRoom(roomId) {
    if (!roomId) {
        log('Please enter a room ID to join');
        return null;
    }
    
    // Basic ID validation
    if (!isValidRoomId(roomId)) {
        log("Room ID must be at least 8 alphanumeric characters (can include dashes and underscores)");
        return null;
    }
    
    try {
        // Join the room
        const connectionToken = wasmModule.join_room(roomId, '{}');
        
        // Update UI and localStorage
        document.getElementById('currentRoom').textContent = roomId;
        localStorage.setItem('currentRoomId', roomId);
        
        // Update connection status
        updateConnectionStatus(true);
        
        log(`Joined room: ${roomId}`);
        return roomId;
    } catch (error) {
        log(`Error joining room: ${error}`);
        updateConnectionStatus(false);
        return null;
    }
}

// Update connection status when room changes
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

// Fix for the typing indicator error (handle errors better)
function setupEventHandlers() {
    // Check if WASM module is available
    if (!wasmModule) {
        console.error("WASM module not loaded yet, cannot setup event handlers");
        log("Error: WASM module not loaded yet. Please refresh the page.");
        return;
    }
    
    // Initialize user
    document.getElementById('initializeBtn').addEventListener('click', () => {
        const userName = document.getElementById('userName').value || 'Anonymous';
        try {
            // Generate user ID client-side
            const userId = generateUUID();
            
            // Initialize user in WASM module
            wasmModule.initialize(userName, userId);
            
            // Update UI
            document.getElementById('userId').textContent = userId;
            
            // Store in localStorage
            localStorage.setItem('userId', userId);
            localStorage.setItem('userName', userName);
            
            log(`Initialized user: ${userName} with ID: ${userId}`);
        } catch (error) {
            log(`Error initializing user: ${error}`);
        }
    });
    
    // Create room
    document.getElementById('createRoomBtn').addEventListener('click', () => {
        createRoom();
    });
    
    // Join room
    document.getElementById('joinRoomBtn').addEventListener('click', () => {
        const roomId = document.getElementById('roomIdInput').value;
        joinRoom(roomId);
    });
    
    // Send message
    document.getElementById('sendBtn').addEventListener('click', () => {
        sendMessage();
    });
    
    // Send on Enter key
    document.getElementById('messageInput').addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            sendMessage();
        }
    });
    
    // Clear debug log
    document.getElementById('clearLogBtn').addEventListener('click', () => {
        document.getElementById('debugOutput').textContent = '';
        log('Debug log cleared');
    });
    
    // Typing indicator - FIXED VERSION
    let typingTimeout;
    document.getElementById('messageInput').addEventListener('input', () => {
        const roomId = getCurrentRoomId();
        if (!roomId) {
            // Don't log to avoid spam, just return silently
            return;
        }
        
        // Skip typing indicator if not connected
        const statusElement = document.getElementById('connectionStatus');
        if (statusElement.textContent !== 'Connected') {
            return;
        }
        
        try {
            // First make sure the room exists by attempting to join it
            try {
                // This should be a safe operation if the room already exists
                wasmModule.join_room(roomId, '{}');
            } catch (joinError) {
                console.warn("Could not ensure room exists:", joinError);
            }
            
            // Now try to send the typing indicator
            try {
                wasmModule.send_typing_indicator(roomId, true);
                
                // Show typing indicator in UI
                showTypingIndicator(true);
                
                // Clear existing timeout and set a new one
                clearTimeout(typingTimeout);
                typingTimeout = setTimeout(() => {
                    try {
                        wasmModule.send_typing_indicator(roomId, false);
                        showTypingIndicator(false);
                    } catch (error) {
                        // Just log to console, don't display to user
                        console.error("Error stopping typing indicator:", error);
                    }
                }, 2000);
            } catch (typingError) {
                console.error("Error with typing indicator:", typingError);
            }
        } catch (error) {
            // Just log to console to avoid UI spam during typing
            console.error(`Error handling typing input:`, error);
        }
    });
}



// Helper function to display messages in the chat area
function displayMessage(message, isMe = true) {
    const chatArea = document.getElementById('chatArea');
    const messageElement = document.createElement('div');
    messageElement.classList.add('message', isMe ? 'my-message' : 'their-message');
    messageElement.textContent = message;
    chatArea.appendChild(messageElement);
    chatArea.scrollTop = chatArea.scrollHeight;
}

// Show or hide the typing indicator
function showTypingIndicator(isTyping) {
    const indicator = document.getElementById('typingIndicator');
    if (isTyping) {
        indicator.style.display = 'block';
    } else {
        indicator.style.display = 'none';
    }
}

function log(message) {
    console.log(message); // Also log to console for debugging
    const debugOutput = document.getElementById('debugOutput');
    debugOutput.textContent = `${new Date().toLocaleTimeString()} - ${message}\n${debugOutput.textContent}`;
}

// Modified sendMessage function to handle WASM memory pointers
function sendMessage() {
    const messageInput = document.getElementById('messageInput');
    const message = messageInput.value;
    if (!message) return;
    
    // Get the current room ID safely
    const roomId = getCurrentRoomId();
    if (!roomId) {
        log('Please create or join a room first');
        return;
    }
    
    try {
        // Make sure UI is synchronized
        document.getElementById('currentRoom').textContent = roomId;
        
        // Generate message ID on client side
        const messageId = generateUUID();
        
        // Send the message
        wasmModule.send_message(roomId, message, messageId);
        log(`Sent message to room: ${roomId}`);
        messageInput.value = '';
        
        // Display the message in chat
        displayMessage(message, true);
        
        // For debugging only - we'll try to work with the raw WASM module
        try {
            // Access the internal __wbg_get_messages function if available
            if (wasmModule.__wbg_get_messages) {
                console.log("Found internal WASM binding function");
            }
        } catch (e) {
            console.log("No internal WASM binding function found", e);
        }
        
        // Special handling for WASM string returns
        setTimeout(() => {
            try {
                // Get messages from the WASM module
                const messagesResult = wasmModule.get_messages(roomId);
                console.log("Raw get_messages return:", messagesResult);
                
                // Check if we have an array that looks like a WASM pointer
                if (Array.isArray(messagesResult) && messagesResult.length >= 2) {
                    console.log("Detected WASM memory pointer. Need to rebuild WASM module.");
                    log("WASM binding issue detected. Please rebuild with proper string return type.");
                    return;
                }
                
                // If we get here, we should have a proper string
                if (typeof messagesResult === 'string') {
                    try {
                        // Parse the JSON string
                        const messages = JSON.parse(messagesResult);
                        log(`Retrieved ${messages.length} messages from room ${roomId}`);
                        
                        // In a real app, we would update the chat UI with all messages
                    } catch (jsonError) {
                        log(`Error parsing messages JSON: ${jsonError}`);
                        console.error("Raw JSON that failed to parse:", messagesResult);
                    }
                } else {
                    log(`Unexpected type from get_messages: ${typeof messagesResult}`);
                }
            } catch (error) {
                log(`Error retrieving messages: ${error}`);
                console.error(error);
            }
        }, 500);
    } catch (error) {
        log(`Error sending message: ${error}`);
    }
}