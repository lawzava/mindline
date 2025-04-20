// src/lib.rs
use getrandom::getrandom;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use wasm_bindgen::prelude::*;

// Configure the WASM crate
#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = console)]
    fn log(s: &str);
}

// Simple macro for logging to browser console
macro_rules! console_log {
    ($($t:tt)*) => (log(&format!($($t)*)))
}

// Message types for our chat application
#[derive(Serialize, Deserialize, Debug, Clone)]
enum MessageType {
    Text,
    Typing,
    StoppedTyping,
    Edit,
    Delete,
    Media,
}

// Message structure
#[derive(Serialize, Deserialize, Debug, Clone)]
struct Message {
    id: String,
    sender_id: String,
    sender_name: String,
    message_type: MessageType,
    content: String,
    timestamp: u64,
    room_id: String,
}

// Room structure
#[allow(dead_code)]
struct Room {
    id: String,
    messages: Vec<Message>,
    encryption_key: Vec<u8>,
}

// User structure
struct User {
    id: String,
    name: String,
    current_room_id: Option<String>,
}

// Chat manager to handle rooms and connections
struct ChatManager {
    user: User,
    rooms: HashMap<String, Room>,
}

// Our chat manager singleton
thread_local! {
    static CHAT_MANAGER: Arc<Mutex<ChatManager>> = Arc::new(Mutex::new(ChatManager {
        user: User {
            id: "default-user-id".to_string(), // Will be set by initialize
            name: "Anonymous".to_string(),
            current_room_id: None,
        },
        rooms: HashMap::new(),
    }));
}

// Generate a random encryption key
fn generate_encryption_key() -> Result<Vec<u8>, JsValue> {
    let mut key = vec![0u8; 32]; // 256 bits
    getrandom(&mut key)
        .map_err(|_| JsValue::from_str("Failed to generate random encryption key"))?;
    Ok(key)
}

// Initialize our chat application with a client-provided user ID
#[wasm_bindgen]
pub fn initialize(user_name: &str, user_id: &str) -> Result<(), JsValue> {
    console_error_panic_hook::set_once();

    if user_id.is_empty() {
        return Err(JsValue::from_str("User ID cannot be empty"));
    }

    CHAT_MANAGER.with(|cm| {
        let mut manager = cm.lock().unwrap();
        manager.user.name = user_name.to_string();
        manager.user.id = user_id.to_string();
        console_log!(
            "User initialized with name: {} and ID: {}",
            user_name,
            manager.user.id
        );
        Ok(())
    })
}

// Send a message to the current room
#[wasm_bindgen]
pub fn send_message(room_id: &JsValue, content: &JsValue, message_id: &JsValue) -> Result<(), JsValue> {
    let room_id = room_id.as_string().ok_or_else(|| {
        console_log!("Failed to convert room_id to string");
        JsValue::from_str("Invalid room ID")
    })?;

    let content = content.as_string().ok_or_else(|| {
        console_log!("Failed to convert content to string");
        JsValue::from_str("Invalid message content")
    })?;

    let message_id = message_id.as_string().ok_or_else(|| {
        console_log!("Failed to convert message_id to string");
        JsValue::from_str("Invalid message ID")
    })?;

    // Safety check - make sure room_id is valid
    if room_id.is_empty() {
        return Err(JsValue::from_str("Room ID cannot be empty"));
    }

    if message_id.is_empty() {
        return Err(JsValue::from_str("Message ID cannot be empty"));
    }

    console_log!(
        "Sending message to room: {} with content: {} and message ID: {}",
        room_id,
        content,
        message_id
    );

    CHAT_MANAGER.with(|cm| {
        let mut manager = cm.lock().unwrap();

        // If room doesn't exist, create it
        if !manager.rooms.contains_key(&room_id) {
            console_log!(
                "Room {} not found for sending message, creating it",
                room_id
            );

            // Generate encryption key
            let encryption_key = generate_encryption_key()?;

            // Create the room
            manager.rooms.insert(
                room_id.to_string(),
                Room {
                    id: room_id.to_string(),
                    messages: Vec::new(),
                    encryption_key,
                },
            );

            // Also set as current room
            manager.user.current_room_id = Some(room_id.to_string());
        }

        // Create message
        let message = Message {
            id: message_id.to_string(),
            sender_id: manager.user.id.clone(),
            sender_name: manager.user.name.clone(),
            message_type: MessageType::Text,
            content: content.to_string(),
            timestamp: js_sys::Date::now() as u64,
            room_id: room_id.to_string(),
        };

        // Serialize the message for logging
        let message_json = serde_json::to_string(&message)
            .map_err(|_| JsValue::from_str("Failed to serialize message"))?;

        console_log!("Message to send: {}", message_json);

        // Store in local history
        if let Some(room) = manager.rooms.get_mut(&room_id) {
            room.messages.push(message.clone());
        }

        Ok(())
    })
}

// Fixed version of send_typing_indicator that handles missing rooms
#[wasm_bindgen]
pub fn send_typing_indicator(room_id: &JsValue, is_typing: JsValue) -> Result<(), JsValue> {
    let room_id = room_id.as_string().ok_or_else(|| {
        console_log!("Failed to convert room_id to string");
        JsValue::from_str("Invalid room ID")
    })?;

    let is_typing = is_typing.as_bool().ok_or_else(|| {
        console_log!("Failed to convert is_typing to boolean");
        JsValue::from_str("Invalid typing indicator")
    })?;
    console_log!(
        "send_typing_indicator called with room_id: '{}' and is_typing: {}",
        room_id,
        is_typing
    );

    // Safety check - make sure room_id is valid
    if room_id.is_empty() {
        console_log!("Empty room ID provided for typing indicator");
        return Err(JsValue::from_str("Room ID cannot be empty"));
    }

    CHAT_MANAGER.with(|cm| {
        let mut manager = match cm.lock() {
            Ok(manager) => manager,
            Err(_) => {
                console_log!("Failed to lock chat manager mutex");
                return Err(JsValue::from_str("Internal error: failed to lock chat manager"));
            }
        };
        
        // If room doesn't exist, create it instead of returning an error
        if !manager.rooms.contains_key(&room_id) {
            console_log!("Room {} not found for typing indicator, creating it", room_id);
            
            // Generate encryption key - handle potential errors
            let encryption_key = match generate_encryption_key() {
                Ok(key) => key,
                Err(e) => {
                    console_log!("Failed to generate encryption key: {:?}", e);
                    return Err(JsValue::from_str("Failed to generate encryption key"));
                }
            };
            
            // Create the room
            manager.rooms.insert(
                room_id.to_string(),
                Room {
                    id: room_id.to_string(),
                    messages: Vec::new(),
                    encryption_key,
                },
            );
            
            // Also set as current room
            manager.user.current_room_id = Some(room_id.to_string());
        }

        // Log the typing state
        let typing_state = if is_typing { "typing" } else { "stopped typing" };
        console_log!("User is {} in room {}", typing_state, room_id);

        Ok(())
    })
}

#[wasm_bindgen]
pub fn get_messages(room_id: &JsValue) -> String {
    let room_id = match room_id.as_string() {
        Some(id) => id,
        None => {
            console_log!("Failed to convert room_id to string");
            return "[]".to_string(); // Return empty array instead of error
        }
    };

    // Safety check - make sure room_id is valid
    if room_id.is_empty() {
        console_log!("Empty room ID provided for get_messages");
        return "[]".to_string(); // Return empty array instead of error
    }

    CHAT_MANAGER.with(|cm| {
        let manager = match cm.lock() {
            Ok(manager) => manager,
            Err(_) => {
                console_log!("Failed to lock chat manager mutex");
                return "[]".to_string(); // Return empty array on error
            }
        };

        // If room doesn't exist, return empty array
        if !manager.rooms.contains_key(&room_id) {
            console_log!(
                "Room {} not found for getting messages, returning empty array",
                room_id
            );
            return "[]".to_string();
        }

        // Get messages with proper error handling
        match manager.rooms.get(&room_id) {
            Some(room) => {
                // Serialize with proper error handling
                match serde_json::to_string(&room.messages) {
                    Ok(messages_json) => {
                        console_log!("Successfully serialized {} messages from room {}", 
                                     room.messages.len(), room_id);
                        
                        // Debug: Log the JSON
                        console_log!("JSON output: {}", messages_json);
                        
                        // Return the string directly
                        messages_json
                    },
                    Err(e) => {
                        console_log!("Failed to serialize messages: {}", e);
                        // Return empty array instead of error
                        "[]".to_string()
                    }
                }
            },
            None => {
                console_log!("Room not found after check, this shouldn't happen");
                "[]".to_string()
            }
        }
    })
}

#[wasm_bindgen]
pub fn join_room(room_id: &JsValue, signal_data: &str) -> Result<String, JsValue> {
    let room_id = room_id.as_string().ok_or_else(|| {
        console_log!("Failed to convert room_id to string");
        JsValue::from_str("Invalid room ID")
    })?;

    // Enhanced debugging for parameters
    console_log!("join_room called with room_id: '{}'", room_id);
    console_log!("join_room room_id length: {}", room_id.len());
    console_log!("join_room signal_data: '{}'", signal_data);
    
    // Safety check - make sure room_id is valid
    if room_id.is_empty() {
        console_log!("Empty room ID provided for join_room");
        return Err(JsValue::from_str("Room ID cannot be empty"));
    }

    // Additional logging
    console_log!(
        "Joining room: '{}' with signal data: '{}'",
        room_id,
        signal_data
    );

    CHAT_MANAGER.with(|cm| {
        let mut manager = match cm.lock() {
            Ok(manager) => manager,
            Err(_) => {
                console_log!("Failed to lock chat manager mutex");
                return Err(JsValue::from_str("Internal error: failed to lock chat manager"));
            }
        };

        // Create the room if it doesn't exist yet
        if !manager.rooms.contains_key(&room_id) {
            console_log!("Room doesn't exist yet, creating it: '{}'", room_id);

            // Generate encryption key with better error handling
            let encryption_key = match generate_encryption_key() {
                Ok(key) => key,
                Err(e) => {
                    console_log!("Failed to generate encryption key: {:?}", e);
                    return Err(JsValue::from_str("Failed to generate encryption key"));
                }
            };

            // Create the room
            manager.rooms.insert(
                room_id.to_string(),
                Room {
                    id: room_id.to_string(),
                    messages: Vec::new(),
                    encryption_key,
                },
            );
        }

        // Set as current room
        manager.user.current_room_id = Some(room_id.to_string());
        console_log!("Successfully joined room: '{}'", room_id);

        // Return a connection token (in a real implementation, this would be WebRTC connection info)
        Ok("connected".to_string())
    })
}

// Similarly enhanced create_room_with_id function
#[wasm_bindgen]
pub fn create_room_with_id(room_id: &JsValue) -> Result<(), JsValue> {
    let room_id = room_id.as_string().ok_or_else(|| {
        console_log!("Failed to convert room_id to string");
        JsValue::from_str("Invalid room ID")
    })?;

    // Enhanced debugging for parameters
    console_log!("create_room_with_id called with room_id: '{}'", room_id);
    console_log!("create_room_with_id room_id length: {}", room_id.len());
    
    if room_id.is_empty() {
        console_log!("Empty room ID provided for create_room_with_id");
        return Err(JsValue::from_str("Room ID cannot be empty"));
    }

    CHAT_MANAGER.with(|cm| {
        let mut manager = cm.lock().unwrap();

        // Check if room already exists
        if manager.rooms.contains_key(&room_id) {
            console_log!("Room with ID '{}' already exists", room_id);
            manager.user.current_room_id = Some(room_id.to_string());
            return Ok(());
        }

        // Generate encryption key
        let encryption_key = generate_encryption_key()?;

        // Create the room
        manager.rooms.insert(
            room_id.to_string(),
            Room {
                id: room_id.to_string(),
                messages: Vec::new(),
                encryption_key,
            },
        );

        // Set as current room
        manager.user.current_room_id = Some(room_id.to_string());

        console_log!("Created room with ID: '{}'", room_id);
        Ok(())
    })
}