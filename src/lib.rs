// src/lib.rs
use wasm_bindgen::prelude::*;
use serde::{Serialize, Deserialize};
use getrandom::getrandom;
use uuid::Uuid;
use std::sync::{Arc, Mutex};
use std::collections::HashMap;

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
            id: Uuid::new_v4().to_string(),
            name: "Anonymous".to_string(),
            current_room_id: None,
        },
        rooms: HashMap::new(),
    }));
}

// Generate a random encryption key
fn generate_encryption_key() -> Result<Vec<u8>, JsValue> {
    let mut key = vec![0u8; 32]; // 256 bits
    getrandom(&mut key).map_err(|_| JsValue::from_str("Failed to generate random encryption key"))?;
    Ok(key)
}

// Initialize our chat application
#[wasm_bindgen]
pub fn initialize(user_name: &str) -> Result<String, JsValue> {
    console_error_panic_hook::set_once();
    
    CHAT_MANAGER.with(|cm| {
        let mut manager = cm.lock().unwrap();
        manager.user.name = user_name.to_string();
        console_log!("User initialized with name: {} and ID: {}", user_name, manager.user.id);
        Ok(manager.user.id.clone())
    })
}

// Create a new chat room
#[wasm_bindgen]
pub fn create_room() -> Result<String, JsValue> {
    CHAT_MANAGER.with(|cm| {
        let mut manager = cm.lock().unwrap();
        
        // Generate room ID and encryption key
        let room_id = Uuid::new_v4().to_string();
        let encryption_key = generate_encryption_key()?;
        
        // Create the room
        manager.rooms.insert(
            room_id.clone(),
            Room {
                id: room_id.clone(),
                messages: Vec::new(),
                encryption_key,
            },
        );
        
        // Set as current room
        manager.user.current_room_id = Some(room_id.clone());
        
        console_log!("Created room: {}", room_id);
        Ok(room_id)
    })
}

// Join an existing room
#[wasm_bindgen]
pub fn join_room(room_id: &str, signal_data: &str) -> Result<String, JsValue> {
    console_log!("Joining room: {} with signal data: {}", room_id, signal_data);
    
    CHAT_MANAGER.with(|cm| {
        let mut manager = cm.lock().unwrap();
        
        // Create the room if it doesn't exist yet
        if !manager.rooms.contains_key(room_id) {
            console_log!("Room doesn't exist yet, creating it: {}", room_id);
            
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
        }
        
        // Set as current room
        manager.user.current_room_id = Some(room_id.to_string());
        
        // Return a connection token (in a real implementation, this would be WebRTC connection info)
        let token = Uuid::new_v4().to_string();
        console_log!("Joined room with connection token: {}", token);
        Ok(token)
    })
}

// Send a message to the current room
#[wasm_bindgen]
pub fn send_message(room_id: &str, content: &str) -> Result<String, JsValue> {
    if room_id.is_empty() {
        return Err(JsValue::from_str("Room ID cannot be empty"));
    }

    CHAT_MANAGER.with(|cm| {
        let mut manager = cm.lock().unwrap();
        
        // If room doesn't exist, create it
        if !manager.rooms.contains_key(room_id) {
            console_log!("Room {} not found for sending message, creating it", room_id);
            
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
            id: Uuid::new_v4().to_string(),
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
        if let Some(room) = manager.rooms.get_mut(room_id) {
            room.messages.push(message.clone());
        }
        
        Ok(message.id)
    })
}

// Simplified typing indicator
#[wasm_bindgen]
pub fn send_typing_indicator(room_id: &str, is_typing: bool) -> Result<(), JsValue> {
    // For a simplified demo, we'll just log the typing state and not worry about storing it
    let typing_state = if is_typing { "typing" } else { "stopped typing" };
    console_log!("User is {} in room {}", typing_state, room_id);
    
    // Return success regardless of room existence
    // This makes the demo more forgiving since WebRTC would handle this differently in production
    Ok(())
}

// Helper function to get messages from a room
#[wasm_bindgen]
pub fn get_messages(room_id: &str) -> Result<String, JsValue> {
    CHAT_MANAGER.with(|cm| {
        let manager = cm.lock().unwrap();
        
        // If room doesn't exist, return empty array
        if !manager.rooms.contains_key(room_id) {
            console_log!("Room {} not found for getting messages, returning empty array", room_id);
            return Ok("[]".to_string());
        }
        
        // Get messages
        if let Some(room) = manager.rooms.get(room_id) {
            let messages_json = serde_json::to_string(&room.messages)
                .map_err(|_| JsValue::from_str("Failed to serialize messages"))?;
            return Ok(messages_json);
        }
        
        Ok("[]".to_string())
    })
}

// We'll add more WebRTC connection handling in later iterations
// For now this gives us a basic structure to work with