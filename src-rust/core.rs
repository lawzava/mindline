// src/core.rs
// Core WASM functions and utilities

use crate::state::{APP_STATE, CHAT_MANAGER};
use crate::types::{Message, MessageType, RoomHistory, RoomMetadata, UserSession};
use wasm_bindgen::prelude::*;

// Configure the WASM crate
#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = console)]
    pub fn log(s: &str);
}

// Simple macro for logging to browser console
#[macro_export]
macro_rules! console_log {
    ($($t:tt)*) => ($crate::core::log(&format!($($t)*)))
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

    // Update old CHAT_MANAGER for compatibility
    CHAT_MANAGER.with(|cm| {
        let mut manager = cm
            .lock()
            .map_err(|_| JsValue::from_str("Failed to lock chat manager"))?;

        manager.user_name = user_name.to_string();
        manager.user_id = user_id.to_string();
        Ok::<(), JsValue>(())
    })?;

    // Also update the new APP_STATE
    APP_STATE.with(|state| {
        let mut state = state
            .lock()
            .map_err(|_| JsValue::from_str("Failed to lock app state"))?;

        let now = js_sys::Date::now() as u64;
        let session = UserSession {
            id: user_id.to_string(),
            name: user_name.to_string(),
            current_room_id: state.current_room_id.clone(),
            last_activity: now,
            is_typing: false,
            created_at: now,
        };

        state.user_session = Some(session);
        console_log!("User initialized in APP_STATE: {} ({})", user_name, user_id);
        Ok::<(), JsValue>(())
    })?;

    console_log!(
        "User initialized with name: {} and ID: {}",
        user_name,
        user_id
    );
    Ok(())
}

// Validates a string parameter from JS
pub fn validate_js_string_param(param: &JsValue, param_name: &str) -> Result<String, JsValue> {
    let value = param.as_string().ok_or_else(|| {
        console_log!("Failed to convert {} to string", param_name);
        JsValue::from_str(&format!("Invalid {}", param_name))
    })?;

    if value.is_empty() {
        return Err(JsValue::from_str(&format!(
            "{} cannot be empty",
            param_name
        )));
    }

    Ok(value)
}

// DEPRECATED: Use send_message_enhanced instead
// Send a message to the current room (legacy function - will be removed)
#[wasm_bindgen]
pub fn send_message(
    room_id: &JsValue,
    content: &JsValue,
    message_id: &JsValue,
) -> Result<(), JsValue> {
    let room_id = validate_js_string_param(room_id, "room ID")?;
    let content = validate_js_string_param(content, "message content")?;
    let message_id = validate_js_string_param(message_id, "message ID")?;

    console_log!(
        "Sending message to room: {} with content: {} and message ID: {}",
        room_id,
        content,
        message_id
    );

    // Use new APP_STATE system for better user data
    APP_STATE.with(|state| {
        let mut state = state
            .lock()
            .map_err(|_| JsValue::from_str("Failed to lock app state"))?;

        // Get user data from session, fallback to reasonable defaults
        let (user_id, user_name) = if let Some(ref session) = state.user_session {
            (session.id.clone(), session.name.clone())
        } else {
            // Better fallback - don't use message_id as user_id
            ("unknown-user".to_string(), "Anonymous".to_string())
        };

        // Create message
        let message = Message {
            id: message_id.clone(),
            sender_id: user_id,
            sender_name: user_name,
            message_type: MessageType::Text,
            content,
            timestamp: js_sys::Date::now() as u64,
            room_id: room_id.clone(),
        };

        // Store in message history for deduplication
        state.message_history.insert(message_id, message.clone());

        // Add to room history
        let peer_count = state.p2p_connected_peers.len();
        let now = js_sys::Date::now() as u64;
        let room_history = state
            .room_histories
            .entry(room_id.clone())
            .or_insert_with(|| RoomHistory {
                messages: Vec::new(),
                last_sync: 0,
                room_metadata: RoomMetadata {
                    id: room_id.clone(),
                    created_at: now,
                    last_joined: now,
                    display_name: room_id.clone(),
                    peer_count,
                    total_messages: 0,
                },
            });

        room_history.messages.push(message);
        room_history.room_metadata.total_messages = room_history.messages.len();

        console_log!("Message stored in APP_STATE successfully");
        Ok(())
    })
}

// DEPRECATED: Use get_room_messages instead
// Get messages from a room (legacy function - will be removed)
#[wasm_bindgen]
pub fn get_messages(room_id: &JsValue) -> JsValue {
    let room_id = match room_id.as_string() {
        Some(id) if !id.is_empty() => id,
        _ => {
            console_log!("Invalid room ID provided for get_messages");
            return JsValue::from_str("[]"); // Return empty array for invalid input
        }
    };

    log(format!("Getting messages for room: {}", room_id).as_str());

    // Use new APP_STATE system for message retrieval
    APP_STATE.with(|state| {
        let state = state
            .lock()
            .map_err(|_| JsValue::from_str("Failed to lock app state"))
            .unwrap();

        // Get messages from room history
        let messages = match state.room_histories.get(&room_id) {
            Some(room_history) => &room_history.messages,
            None => {
                console_log!(
                    "Room {} not found in APP_STATE, returning empty array",
                    room_id
                );
                return JsValue::from_str("[]");
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
        let mut manager = cm
            .lock()
            .map_err(|_| JsValue::from_str("Failed to lock chat manager"))?;

        // Set as current room
        manager.current_room_id = Some(room_id.to_string());
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

    // Room creation is now handled by the enhanced message system
    console_log!("Room creation logged for: '{}'", room_id);
    Ok(())
}
