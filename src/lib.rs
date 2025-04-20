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
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub enum MessageType {
    Text,
    Typing,
    StoppedTyping,
    Edit,
    Delete,
    Media,
}

// Message structure
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Message {
    id: String,
    sender_id: String,
    sender_name: String,
    message_type: MessageType,
    content: String,
    timestamp: u64,
    room_id: String,
}

// Room structure
#[derive(Clone)]
#[allow(dead_code)]
struct Room {
    id: String,
    messages: Vec<Message>,
    encryption_key: Vec<u8>,
}

// User structure
#[derive(Clone)]
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
    static CHAT_MANAGER: Arc<Mutex<ChatManager>> = Arc::new(Mutex::new(ChatManager::new()));
}

impl ChatManager {
    fn new() -> Self {
        Self {
            user: User {
                id: "default-user-id".to_string(),
                name: "Anonymous".to_string(),
                current_room_id: None,
            },
            rooms: HashMap::new(),
        }
    }

    fn get_or_create_room(&mut self, room_id: &str) -> Result<&mut Room, JsValue> {
        if !self.rooms.contains_key(room_id) {
            let encryption_key = generate_encryption_key()?;
            
            self.rooms.insert(
                room_id.to_string(),
                Room {
                    id: room_id.to_string(),
                    messages: Vec::new(),
                    encryption_key,
                },
            );
            
            // Set as current room
            self.user.current_room_id = Some(room_id.to_string());
            console_log!("Created new room: '{}'", room_id);
        }
        
        Ok(self.rooms.get_mut(room_id).unwrap())
    }
}

// Generate a random encryption key
fn generate_encryption_key() -> Result<Vec<u8>, JsValue> {
    let mut key = vec![0u8; 32]; // 256 bits
    getrandom(&mut key)
        .map_err(|e| JsValue::from_str(&format!("Failed to generate random encryption key: {:?}", e)))?;
    Ok(key)
}

// Initialize our chat application with a client-provided user ID and name
#[wasm_bindgen]
pub fn initialize(user_name: &str, user_id: &str) -> Result<(), JsValue> {
    console_error_panic_hook::set_once();

    if user_id.is_empty() {
        return Err(JsValue::from_str("User ID cannot be empty"));
    }

    if user_name.is_empty() {
        return Err(JsValue::from_str("User name cannot be empty"));
    }

    CHAT_MANAGER.with(|cm| {
        let mut manager = cm.lock().map_err(|_| 
            JsValue::from_str("Failed to lock chat manager"))?;
            
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

// Validates a string parameter from JS
fn validate_js_string_param(param: &JsValue, param_name: &str) -> Result<String, JsValue> {
    let value = param.as_string().ok_or_else(|| {
        console_log!("Failed to convert {} to string", param_name);
        JsValue::from_str(&format!("Invalid {}", param_name))
    })?;

    if value.is_empty() {
        return Err(JsValue::from_str(&format!("{} cannot be empty", param_name)));
    }

    Ok(value)
}

// Send a message to the current room
#[wasm_bindgen]
pub fn send_message(room_id: &JsValue, content: &JsValue, message_id: &JsValue) -> Result<(), JsValue> {
    let room_id = validate_js_string_param(room_id, "room ID")?;
    let content = validate_js_string_param(content, "message content")?;
    let message_id = validate_js_string_param(message_id, "message ID")?;

    console_log!(
        "Sending message to room: {} with content: {} and message ID: {}",
        room_id,
        content,
        message_id
    );

    CHAT_MANAGER.with(|cm| {
        let mut manager = cm.lock().map_err(|_| 
            JsValue::from_str("Failed to lock chat manager"))?;

        // Get or create the room
        let user_id = manager.user.id.clone();
        let user_name = manager.user.name.clone();
        let room = manager.get_or_create_room(&room_id)?;

        // Create message
        let message = Message {
            id: message_id,
            sender_id: user_id,
            sender_name: user_name,
            message_type: MessageType::Text,
            content,
            timestamp: js_sys::Date::now() as u64,
            room_id: room_id.clone(),
        };

        // Store in local history
        room.messages.push(message);
        Ok(())
    })
}

// Send typing indicator for real-time typing display
#[wasm_bindgen]
pub fn send_typing_indicator(room_id: &JsValue, is_typing: JsValue) -> Result<(), JsValue> {
    let room_id = validate_js_string_param(room_id, "room ID")?;
    
    let is_typing = is_typing.as_bool().ok_or_else(|| {
        console_log!("Failed to convert is_typing to boolean");
        JsValue::from_str("Invalid typing indicator")
    })?;
    
    console_log!(
        "send_typing_indicator called with room_id: '{}' and is_typing: {}",
        room_id,
        is_typing
    );

    CHAT_MANAGER.with(|cm| {
        let mut manager = cm.lock().map_err(|_| 
            JsValue::from_str("Failed to lock chat manager"))?;
        
        // Get or create the room
        let _room = manager.get_or_create_room(&room_id)?;

        // In a real implementation, this would broadcast to other users
        // Log the typing state for debugging
        let typing_state = if is_typing { "typing" } else { "stopped typing" };
        console_log!("User is {} in room {}", typing_state, room_id);

        Ok(())
    })
}

// Get messages from a room
#[wasm_bindgen]
pub fn get_messages(room_id: &JsValue) -> JsValue {
    let room_id = match room_id.as_string() {
        Some(id) if !id.is_empty() => id,
        _ => {
            console_log!("Invalid room ID provided for get_messages");
            return JsValue::from_str(&"[]".to_string()); // Return empty array for invalid input
        }
    };

    log(format!("Getting messages for room: {}", room_id).as_str());

    CHAT_MANAGER.with(|cm| {
        let manager = cm.lock().map_err(|_| 
            JsValue::from_str("Failed to lock chat manager")).unwrap();

        // If room doesn't exist, return empty array
        let messages = match manager.rooms.get(&room_id) {
            Some(room) => &room.messages,
            None => {
                console_log!(
                    "Room {} not found for getting messages, returning empty array",
                    room_id
                );
                return JsValue::from_str(&"[]".to_string());
            }
        };

        // Convert messages to stringified json
        let messages: String = messages
            .iter()
            .map(|msg| {
                serde_json::to_string(msg).unwrap_or_else(|_| {
                    console_log!("Failed to serialize message: {:?}", msg);
                    String::new()
                })
            })
            .filter(|msg| !msg.is_empty())
            .collect::<Vec<String>>()
            .join(", ");

        let messages = format!("[{}]", messages);

        log(format!("Messages for room {}: {}", room_id, messages).as_str());
        JsValue::from_str(&messages)
    })
}

// Join an existing room or create it if it doesn't exist
#[wasm_bindgen]
pub fn join_room(room_id: &JsValue, signal_data: &str) -> Result<String, JsValue> {
    let room_id = validate_js_string_param(room_id, "room ID")?;

    console_log!(
        "Joining room: '{}' with signal data: '{}'",
        room_id,
        signal_data
    );

    CHAT_MANAGER.with(|cm| {
        let mut manager = cm.lock().map_err(|_| 
            JsValue::from_str("Failed to lock chat manager"))?;

        // Get or create the room
        let _room = manager.get_or_create_room(&room_id)?;
        
        // Set as current room
        manager.user.current_room_id = Some(room_id.to_string());
        console_log!("Successfully joined room: '{}'", room_id);

        // Return a connection token (in a real implementation, this would be WebRTC connection info)
        Ok("connected".to_string())
    })
}

// Create a new room with a specific ID
#[wasm_bindgen]
pub fn create_room_with_id(room_id: &JsValue) -> Result<(), JsValue> {
    let room_id = validate_js_string_param(room_id, "room ID")?;

    console_log!("Creating room with ID: '{}'", room_id);

    CHAT_MANAGER.with(|cm| {
        let mut manager = cm.lock().map_err(|_| 
            JsValue::from_str("Failed to lock chat manager"))?;

        // Get or create the room
        let _room = manager.get_or_create_room(&room_id)?;
        Ok(())
    })
}