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
        setupEventHandlers();
        return true;
    } catch (err) {
        document.getElementById('debugOutput').textContent = `Error loading WASM module: ${err}`;
        console.error('Error loading WASM module:', err);
        return false;
    }
}

// Function to restore state from localStorage
function restoreState() {
    // Restore room ID if available
    const savedRoomId = localStorage.getItem('currentRoomId');
    if (savedRoomId) {
        document.getElementById('currentRoom').textContent = savedRoomId;
        document.getElementById('roomIdInput').value = savedRoomId;
        log(`Restored previous room ID: ${savedRoomId}`);
    }
}

// Call the function to load the module
loadWasmModule().then(() => {
    // After module is loaded, restore any saved state
    restoreState();
});

// Set up UI event handlers
function setupEventHandlers() {
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
    
    // Create room
    document.getElementById('createRoomBtn').addEventListener('click', () => {
        try {
            const roomId = wasmModule.create_room();
            document.getElementById('currentRoom').textContent = roomId;
            document.getElementById('roomIdInput').value = roomId;
            // Save the room ID to localStorage for persistence
            localStorage.setItem('currentRoomId', roomId);
            log(`Created and joined room: ${roomId}`);
        } catch (error) {
            log(`Error creating room: ${error}`);
        }
    });
    
    // Join room
    document.getElementById('joinRoomBtn').addEventListener('click', () => {
        const roomId = document.getElementById('roomIdInput').value;
        if (!roomId) {
            log('Please enter a room ID to join');
            return;
        }
        
        try {
            // In a real implementation, we would have signal data
            const connectionToken = wasmModule.join_room(roomId, '{}');
            document.getElementById('currentRoom').textContent = roomId;
            // Save the room ID to localStorage for persistence
            localStorage.setItem('currentRoomId', roomId);
            log(`Joined room: ${roomId} with connection token: ${connectionToken}`);
        } catch (error) {
            log(`Error joining room: ${error}`);
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
        const roomId = document.getElementById('currentRoom').textContent;
        if (roomId && roomId !== 'None') {
            try {
                // Try to ensure room exists first
                try {
                    wasmModule.join_room(roomId, '{}');
                } catch (e) {
                    // Ignore errors here, we're just making sure the room exists
                    console.log("Ensuring room exists", e);
                }
                
                wasmModule.send_typing_indicator(roomId, true);
                
                // Clear existing timeout and set a new one
                clearTimeout(typingTimeout);
                typingTimeout = setTimeout(() => {
                    try {
                        wasmModule.send_typing_indicator(roomId, false);
                    } catch (error) {
                        console.log("Error stopping typing indicator:", error);
                    }
                }, 2000);
            } catch (error) {
                console.log(`Error sending typing indicator: ${error}`);
                log(`Note: Typing indicators may not work until you create or join a room`);
            }
        }
    });
}


function sendMessage() {
    const messageInput = document.getElementById('messageInput');
    const message = messageInput.value;
    if (!message) return;
    
    // Get room ID from state storage first, element second
    let roomId = localStorage.getItem('currentRoomId') || document.getElementById('currentRoom').textContent;
    
    if (!roomId || roomId === 'None') {
        log('Please create or join a room first');
        return;
    }
    
    try {
        // Make sure UI is synchronized
        document.getElementById('currentRoom').textContent = roomId;
        
        // Send the message - our updated Rust code will handle room creation if needed
        const messageId = wasmModule.send_message(roomId, message);
        log(`Sent message with ID: ${messageId} to room: ${roomId}`);
        messageInput.value = '';
        
        // Display the message
        const chatArea = document.getElementById('chatArea');
        const messageElement = document.createElement('div');
        messageElement.classList.add('message', 'my-message');
        messageElement.textContent = message;
        chatArea.appendChild(messageElement);
        chatArea.scrollTop = chatArea.scrollHeight;
        
        // In a real app, we would receive messages through WebRTC
        // For this test harness, we'll simulate retrieving our own messages
        setTimeout(() => {
            try {
                const messagesJson = wasmModule.get_messages(roomId);
                log(`Retrieved ${JSON.parse(messagesJson).length} messages from room ${roomId}`);
            } catch (error) {
                log(`Error retrieving messages: ${error}`);
            }
        }, 500);
    } catch (error) {
        log(`Error sending message: ${error}`);
    }
}

function log(message) {
    const debugOutput = document.getElementById('debugOutput');
    debugOutput.textContent = `${new Date().toLocaleTimeString()} - ${message}\n${debugOutput.textContent}`;
}