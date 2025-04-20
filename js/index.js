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

// Function to restore state from localStorage
function restoreState() {
    // Check if WASM module is loaded
    if (!wasmModule) {
        console.warn("WASM module not loaded yet, cannot restore state");
        return;
    }
    
    // Initialize with default username if not yet initialized
    if (document.getElementById('userId').textContent === 'Not initialized') {
        try {
            const userName = document.getElementById('userName').value || 'Anonymous';
            const userId = wasmModule.initialize(userName);
            document.getElementById('userId').textContent = userId;
            log(`Auto-initialized user: ${userName} with ID: ${userId}`);
        } catch (error) {
            console.warn("Could not auto-initialize user:", error);
        }
    }
    
    // Restore room ID if available
    const savedRoomId = localStorage.getItem('currentRoomId');
    if (savedRoomId && isValidUUID(savedRoomId)) {
        document.getElementById('currentRoom').textContent = savedRoomId;
        document.getElementById('roomIdInput').value = savedRoomId;
        
        // Try to join the room automatically
        try {
            wasmModule.join_room(savedRoomId, '{}');
            updateConnectionStatus(true);
            log(`Restored and rejoined previous room: ${savedRoomId}`);
        } catch (error) {
            console.warn("Could not auto-join saved room:", error);
            log(`Restored previous room ID: ${savedRoomId} (not connected)`);
            updateConnectionStatus(false);
        }
    }
}

// Call the function to load the module
loadWasmModule().then(() => {
    // After module is loaded, restore any saved state
    restoreState();
    
    // Make sure connection status is updated based on current room
    const roomId = getCurrentRoomId();
    if (roomId) {
        updateConnectionStatus(true);
    } else {
        updateConnectionStatus(false);
    }
});

// Helper function to validate UUID format
function isValidUUID(uuid) {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return uuidRegex.test(uuid);
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
    if (!isValidUUID(roomId)) {
        log(`Warning: Invalid room ID format: ${roomId}`);
        return null;
    }
    
    return roomId;
}

// Set up UI event handlers
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
            const userId = wasmModule.initialize(userName);
            document.getElementById('userId').textContent = userId;
            log(`Initialized user: ${userName} with ID: ${userId}`);
        } catch (error) {
            log(`Error initializing user: ${error}`);
        }
    });
    
    document.getElementById('createRoomBtn').addEventListener('click', () => {
        try {
            const roomId = wasmModule.create_room();
            
            // Update UI and localStorage
            document.getElementById('currentRoom').textContent = roomId;
            document.getElementById('roomIdInput').value = roomId;
            localStorage.setItem('currentRoomId', roomId);
            
            // Update connection status
            updateConnectionStatus(true);
            
            log(`Created and joined room: ${roomId}`);
        } catch (error) {
            log(`Error creating room: ${error}`);
            updateConnectionStatus(false);
        }
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
    
    // Typing indicator
    let typingTimeout;
    document.getElementById('messageInput').addEventListener('input', () => {
        const roomId = getCurrentRoomId();
        if (!roomId) {
            log('Please create or join a room first');
            return;
        }
        
        try {
            wasmModule.send_typing_indicator(roomId, true);
            
            // Show typing indicator in UI (in a real app, this would come from WebRTC)
            showTypingIndicator(true);
            
            // Clear existing timeout and set a new one
            clearTimeout(typingTimeout);
            typingTimeout = setTimeout(() => {
                try {
                    wasmModule.send_typing_indicator(roomId, false);
                    showTypingIndicator(false);
                } catch (error) {
                    console.error("Error stopping typing indicator:", error);
                }
            }, 2000);
        } catch (error) {
            console.error(`Error sending typing indicator:`, error);
            // Don't spam the user with this message on every keystroke
        }
    });
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
        
        // Send the message
        const messageId = wasmModule.send_message(roomId, message);
        log(`Sent message with ID: ${messageId} to room: ${roomId}`);
        messageInput.value = '';
        
        // Display the message in chat
        displayMessage(message, true);
        
        // Retrieve messages from the room
        setTimeout(() => {
            try {
                const messagesJson = wasmModule.get_messages(roomId);
                // Parse JSON safely
                try {
                    const messages = JSON.parse(messagesJson);
                    log(`Retrieved ${messages.length} messages from room ${roomId}`);
                    
                    // In a real app, we would update the UI with all messages
                    // For now, we're just logging the count
                } catch (jsonError) {
                    log(`Error parsing messages JSON: ${jsonError}`);
                }
            } catch (error) {
                log(`Error retrieving messages: ${error}`);
            }
        }, 500);
    } catch (error) {
        log(`Error sending message: ${error}`);
    }
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