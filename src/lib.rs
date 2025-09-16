// src/lib.rs
use getrandom::getrandom;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use wasm_bindgen::prelude::*;

// Include sanitizer module
mod sanitizer;
use sanitizer::with_sanitizer;

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

// Enhanced state structures for Phase 1 migration
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AppConfig {
    pub min_room_id_length: usize,
    pub max_message_length: usize,
    pub max_username_length: usize,
    pub reconnect_delay: u32,
    pub max_reconnect_attempts: u32,
    pub message_sync_timeout: u32,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            min_room_id_length: 8,
            max_message_length: 2000,
            max_username_length: 32,
            reconnect_delay: 2000,
            max_reconnect_attempts: 5,
            message_sync_timeout: 5000,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct UserSession {
    pub id: String,
    pub name: String,
    pub current_room_id: Option<String>,
    pub last_activity: u64,
    pub is_typing: bool,
    pub created_at: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct DraftMessage {
    pub content: String,
    pub sender_name: String,
    pub sender_id: String,
    pub last_update: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct RoomHistory {
    pub messages: Vec<Message>,
    pub last_sync: u64,
    pub room_metadata: RoomMetadata,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct RoomMetadata {
    pub id: String,
    pub created_at: u64,
    pub last_joined: u64,
    pub display_name: String,
    pub peer_count: usize,
    pub total_messages: usize,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AppState {
    pub config: AppConfig,
    pub user_session: Option<UserSession>,
    pub current_room_id: Option<String>,
    pub room_histories: HashMap<String, RoomHistory>,
    pub draft_messages: HashMap<String, DraftMessage>, // peer_id -> draft
    pub message_history: HashMap<String, Message>, // message_id -> message (for deduplication)
    pub p2p_connected_peers: Vec<String>,
    pub is_wasm_loaded: bool,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            config: AppConfig::default(),
            user_session: None,
            current_room_id: None,
            room_histories: HashMap::new(),
            draft_messages: HashMap::new(),
            message_history: HashMap::new(),
            p2p_connected_peers: Vec::new(),
            is_wasm_loaded: true, // Will be true when this code runs
        }
    }
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

// Global state manager
thread_local! {
    static APP_STATE: Arc<Mutex<AppState>> = Arc::new(Mutex::new(AppState::default()));
}

// Our chat manager singleton (kept for compatibility during transition)
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

    // Update both old CHAT_MANAGER and new APP_STATE for compatibility
    CHAT_MANAGER.with(|cm| {
        let mut manager = cm.lock().map_err(|_|
            JsValue::from_str("Failed to lock chat manager"))?;

        manager.user.name = user_name.to_string();
        manager.user.id = user_id.to_string();
        Ok::<(), JsValue>(())
    })?;

    // Also update the new APP_STATE
    APP_STATE.with(|state| {
        let mut state = state.lock().map_err(|_|
            JsValue::from_str("Failed to lock app state"))?;

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

    // Use new APP_STATE system for better user data
    APP_STATE.with(|state| {
        let mut state = state.lock().map_err(|_|
            JsValue::from_str("Failed to lock app state"))?;

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
        let room_history = state.room_histories.entry(room_id.clone())
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

    // Use new APP_STATE system for message retrieval
    APP_STATE.with(|state| {
        let state = state.lock().map_err(|_|
            JsValue::from_str("Failed to lock app state")).unwrap();

        // Get messages from room history
        let messages = match state.room_histories.get(&room_id) {
            Some(room_history) => &room_history.messages,
            None => {
                console_log!(
                    "Room {} not found in APP_STATE, returning empty array",
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

// ========== Phase 1: Enhanced State Management Functions ==========

// Core state management functions

#[wasm_bindgen]
pub fn get_app_state() -> JsValue {
    APP_STATE.with(|state| {
        let state = state.lock().unwrap();
        serde_wasm_bindgen::to_value(&*state).unwrap_or(JsValue::NULL)
    })
}

#[wasm_bindgen]
pub fn get_app_config() -> JsValue {
    APP_STATE.with(|state| {
        let state = state.lock().unwrap();
        serde_wasm_bindgen::to_value(&state.config).unwrap_or(JsValue::NULL)
    })
}

#[wasm_bindgen]
pub fn get_current_user_id() -> String {
    APP_STATE.with(|state| {
        let state = state.lock().unwrap();
        state.user_session.as_ref()
            .map(|session| session.id.clone())
            .unwrap_or_else(|| String::new())
    })
}

#[wasm_bindgen]
pub fn get_current_room_id() -> String {
    APP_STATE.with(|state| {
        let state = state.lock().unwrap();
        state.current_room_id.clone().unwrap_or_else(|| String::new())
    })
}

#[wasm_bindgen]
pub fn set_current_room_id(room_id: &str) -> Result<(), JsValue> {
    APP_STATE.with(|state| {
        let mut state = state.lock().map_err(|_|
            JsValue::from_str("Failed to lock app state"))?;

        state.current_room_id = if room_id.is_empty() {
            None
        } else {
            Some(room_id.to_string())
        };

        // Update user session if exists
        let current_room = state.current_room_id.clone();
        if let Some(ref mut session) = state.user_session {
            session.current_room_id = current_room;
            session.last_activity = js_sys::Date::now() as u64;
        }

        console_log!("Current room ID set to: {:?}", state.current_room_id);
        Ok(())
    })
}

#[wasm_bindgen]
pub fn update_user_session(name: &str, user_id: &str) -> Result<(), JsValue> {
    if name.is_empty() || user_id.is_empty() {
        return Err(JsValue::from_str("Name and user ID cannot be empty"));
    }

    APP_STATE.with(|state| {
        let mut state = state.lock().map_err(|_|
            JsValue::from_str("Failed to lock app state"))?;

        let now = js_sys::Date::now() as u64;

        let session = UserSession {
            id: user_id.to_string(),
            name: name.to_string(),
            current_room_id: state.current_room_id.clone(),
            last_activity: now,
            is_typing: false,
            created_at: state.user_session.as_ref()
                .map(|s| s.created_at)
                .unwrap_or(now),
        };

        state.user_session = Some(session);
        console_log!("User session updated: {} ({})", name, user_id);
        Ok(())
    })
}

#[wasm_bindgen]
pub fn set_typing_status(is_typing: bool) -> Result<(), JsValue> {
    APP_STATE.with(|state| {
        let mut state = state.lock().map_err(|_|
            JsValue::from_str("Failed to lock app state"))?;

        if let Some(ref mut session) = state.user_session {
            session.is_typing = is_typing;
            session.last_activity = js_sys::Date::now() as u64;
            console_log!("Typing status set to: {}", is_typing);
        }

        Ok(())
    })
}

// Room history management

#[wasm_bindgen]
pub fn get_room_history_list() -> JsValue {
    APP_STATE.with(|state| {
        let state = state.lock().unwrap();

        // Convert room histories to a simplified list for JavaScript
        let room_list: Vec<_> = state.room_histories
            .values()
            .map(|history| &history.room_metadata)
            .collect();

        serde_wasm_bindgen::to_value(&room_list).unwrap_or(JsValue::NULL)
    })
}

#[wasm_bindgen]
pub fn add_room_to_history(room_id: &str, display_name: Option<String>) -> Result<(), JsValue> {
    if room_id.is_empty() {
        return Err(JsValue::from_str("Room ID cannot be empty"));
    }

    APP_STATE.with(|state| {
        let mut state = state.lock().map_err(|_|
            JsValue::from_str("Failed to lock app state"))?;

        let now = js_sys::Date::now() as u64;
        let display_name = display_name.unwrap_or_else(|| room_id.to_string());

        // Update existing or create new room history
        let room_history = state.room_histories.entry(room_id.to_string())
            .or_insert_with(|| RoomHistory {
                messages: Vec::new(),
                last_sync: 0,
                room_metadata: RoomMetadata {
                    id: room_id.to_string(),
                    created_at: now,
                    last_joined: now,
                    display_name: display_name.clone(),
                    peer_count: 0,
                    total_messages: 0,
                },
            });

        // Update metadata
        room_history.room_metadata.last_joined = now;
        room_history.room_metadata.display_name = display_name;

        console_log!("Added room to history: {}", room_id);
        Ok(())
    })
}

#[wasm_bindgen]
pub fn remove_room_from_history(room_id: &str) -> Result<(), JsValue> {
    APP_STATE.with(|state| {
        let mut state = state.lock().map_err(|_|
            JsValue::from_str("Failed to lock app state"))?;

        state.room_histories.remove(room_id);
        console_log!("Removed room from history: {}", room_id);
        Ok(())
    })
}

#[wasm_bindgen]
pub fn get_room_metadata(room_id: &str) -> JsValue {
    APP_STATE.with(|state| {
        let state = state.lock().unwrap();

        state.room_histories
            .get(room_id)
            .map(|history| &history.room_metadata)
            .map(|metadata| serde_wasm_bindgen::to_value(metadata).unwrap_or(JsValue::NULL))
            .unwrap_or(JsValue::NULL)
    })
}

// Draft messages management

#[wasm_bindgen]
pub fn get_draft_messages() -> JsValue {
    APP_STATE.with(|state| {
        let state = state.lock().unwrap();
        serde_wasm_bindgen::to_value(&state.draft_messages).unwrap_or(JsValue::NULL)
    })
}

#[wasm_bindgen]
pub fn set_draft_message(peer_id: &str, content: &str, sender_name: &str) -> Result<(), JsValue> {
    if peer_id.is_empty() {
        return Err(JsValue::from_str("Peer ID cannot be empty"));
    }

    APP_STATE.with(|state| {
        let mut state = state.lock().map_err(|_|
            JsValue::from_str("Failed to lock app state"))?;

        if content.trim().is_empty() {
            // Remove draft if content is empty
            state.draft_messages.remove(peer_id);
        } else {
            let draft = DraftMessage {
                content: content.to_string(),
                sender_name: sender_name.to_string(),
                sender_id: peer_id.to_string(),
                last_update: js_sys::Date::now() as u64,
            };
            state.draft_messages.insert(peer_id.to_string(), draft);
        }

        Ok(())
    })
}

#[wasm_bindgen]
pub fn clear_draft_message(peer_id: &str) -> Result<(), JsValue> {
    APP_STATE.with(|state| {
        let mut state = state.lock().map_err(|_|
            JsValue::from_str("Failed to lock app state"))?;

        state.draft_messages.remove(peer_id);
        Ok(())
    })
}

#[wasm_bindgen]
pub fn clear_all_draft_messages() -> Result<(), JsValue> {
    APP_STATE.with(|state| {
        let mut state = state.lock().map_err(|_|
            JsValue::from_str("Failed to lock app state"))?;

        state.draft_messages.clear();
        console_log!("All draft messages cleared");
        Ok(())
    })
}

// P2P state management

#[wasm_bindgen]
pub fn get_connected_peers() -> JsValue {
    APP_STATE.with(|state| {
        let state = state.lock().unwrap();
        serde_wasm_bindgen::to_value(&state.p2p_connected_peers).unwrap_or(JsValue::NULL)
    })
}

#[wasm_bindgen]
pub fn add_connected_peer(peer_id: &str) -> Result<(), JsValue> {
    if peer_id.is_empty() {
        return Err(JsValue::from_str("Peer ID cannot be empty"));
    }

    APP_STATE.with(|state| {
        let mut state = state.lock().map_err(|_|
            JsValue::from_str("Failed to lock app state"))?;

        if !state.p2p_connected_peers.contains(&peer_id.to_string()) {
            state.p2p_connected_peers.push(peer_id.to_string());

            // Update room metadata if in a room
            let peer_count = state.p2p_connected_peers.len();
            if let Some(room_id) = state.current_room_id.clone() {
                if let Some(room_history) = state.room_histories.get_mut(&room_id) {
                    room_history.room_metadata.peer_count = peer_count;
                }
            }

            console_log!("Added connected peer: {}", peer_id);
        }

        Ok(())
    })
}

#[wasm_bindgen]
pub fn remove_connected_peer(peer_id: &str) -> Result<(), JsValue> {
    APP_STATE.with(|state| {
        let mut state = state.lock().map_err(|_|
            JsValue::from_str("Failed to lock app state"))?;

        state.p2p_connected_peers.retain(|p| p != peer_id);

        // Clear any draft messages from this peer
        state.draft_messages.remove(peer_id);

        // Update room metadata if in a room
        let peer_count = state.p2p_connected_peers.len();
        if let Some(room_id) = state.current_room_id.clone() {
            if let Some(room_history) = state.room_histories.get_mut(&room_id) {
                room_history.room_metadata.peer_count = peer_count;
            }
        }

        console_log!("Removed connected peer: {}", peer_id);
        Ok(())
    })
}

#[wasm_bindgen]
pub fn clear_all_connected_peers() -> Result<(), JsValue> {
    APP_STATE.with(|state| {
        let mut state = state.lock().map_err(|_|
            JsValue::from_str("Failed to lock app state"))?;

        state.p2p_connected_peers.clear();
        state.draft_messages.clear();

        // Update room metadata if in a room
        if let Some(room_id) = state.current_room_id.clone() {
            if let Some(room_history) = state.room_histories.get_mut(&room_id) {
                room_history.room_metadata.peer_count = 0;
            }
        }

        console_log!("All connected peers cleared");
        Ok(())
    })
}

// URL and utility functions

#[wasm_bindgen]
pub fn generate_uuid() -> JsValue {
    // Use serde-wasm-bindgen for cross-browser compatibility
    use uuid::Uuid;
    let uuid_string = Uuid::new_v4().to_string();
    serde_wasm_bindgen::to_value(&uuid_string).unwrap_or_else(|_| JsValue::from_str(&uuid_string))
}

#[wasm_bindgen]
pub fn get_room_from_url() -> String {
    let window = match web_sys::window() {
        Some(w) => w,
        None => return String::new(),
    };

    let location = window.location();
    let search = match location.search() {
        Ok(s) => s,
        Err(_) => return String::new(),
    };

    if search.is_empty() {
        return String::new();
    }

    // Parse URL parameters manually
    let params = search.strip_prefix('?').unwrap_or(&search);
    for param in params.split('&') {
        if let Some((key, value)) = param.split_once('=') {
            if key == "r" {
                // URL decode the value
                if let Ok(decoded) = js_sys::decode_uri_component(value) {
                    return String::from(decoded);
                }
            }
        }
    }

    String::new()
}

#[wasm_bindgen]
pub fn update_url_with_room(room_id: &str) -> Result<(), JsValue> {
    let window = web_sys::window().ok_or_else(||
        JsValue::from_str("No window object"))?;
    let location = window.location();
    let history = window.history().map_err(|_|
        JsValue::from_str("No history object"))?;

    let pathname = location.pathname().map_err(|_|
        JsValue::from_str("Failed to get pathname"))?;

    let new_url = if room_id.is_empty() {
        pathname
    } else {
        let encoded_room_id = js_sys::encode_uri_component(room_id);
        format!("{}?r={}", pathname, encoded_room_id)
    };

    history.replace_state_with_url(&JsValue::NULL, "", Some(&new_url))
        .map_err(|_| JsValue::from_str("Failed to update URL"))?;

    console_log!("URL updated with room ID: {}", room_id);
    Ok(())
}

// ========== Phase 2: Input Sanitization and Validation ==========

#[wasm_bindgen]
pub fn validate_room_id(room_id: &str) -> String {
    console_log!("WASM validate_room_id called with: {}", room_id);

    // Simple validation without using the sanitizer to isolate the issue
    if room_id.is_empty() {
        console_log!("Room ID is empty, returning empty string");
        return String::new();
    }

    if room_id.len() < 3 || room_id.len() > 64 {
        console_log!("Room ID length invalid: {}, returning empty string", room_id.len());
        return String::new();
    }

    // Simple character validation
    let sanitized: String = room_id
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_')
        .collect();

    console_log!("WASM returning sanitized room ID: {}", sanitized);
    sanitized
}

#[wasm_bindgen]
pub fn validate_username(username: &str) -> String {
    match with_sanitizer(|s| s.validate_username(username)) {
        Ok(Some(valid_name)) => valid_name,
        Ok(None) => String::new(),
        Err(e) => {
            console_log!("Error validating username: {:?}", e);
            String::new()
        }
    }
}

#[wasm_bindgen]
pub fn validate_message(message: &str) -> String {
    match with_sanitizer(|s| s.validate_message(message)) {
        Ok(Some(valid_message)) => valid_message,
        Ok(None) => String::new(),
        Err(e) => {
            console_log!("Error validating message: {:?}", e);
            String::new()
        }
    }
}

#[wasm_bindgen]
pub fn sanitize_html_content(html: &str) -> String {
    with_sanitizer(|s| s.sanitize_html(html))
        .unwrap_or_else(|_| html.to_string())
}

#[wasm_bindgen]
pub fn validate_url_param(param: &str) -> JsValue {
    match with_sanitizer(|s| s.validate_url_param(param)) {
        Ok(Some(valid_param)) => JsValue::from_str(&valid_param),
        Ok(None) => JsValue::NULL,
        Err(e) => {
            console_log!("Error validating URL param: {:?}", e);
            JsValue::NULL
        }
    }
}

#[wasm_bindgen]
pub fn generate_secure_room_id() -> Result<String, JsValue> {
    with_sanitizer(|s| s.generate_secure_room_id())?
}

#[wasm_bindgen]
pub fn check_rate_limit(key: &str, max_attempts: u32, window_ms: u32) -> bool {
    // Simplified rate limiting that doesn't use localStorage to avoid errors
    // For production, implement proper rate limiting in a separate system
    console_log!("Rate limit check for key: {}, attempts: {}, window: {}", key, max_attempts, window_ms);

    // For now, always allow (rate limiting can be implemented later without WASM complexity)
    true
}

#[wasm_bindgen]
pub fn validate_file(file_name: &str, file_size: f64, mime_type: &str) -> bool {
    with_sanitizer(|s| s.validate_file(file_name, file_size as u64, mime_type))
        .unwrap_or(false)
}

#[wasm_bindgen]
pub fn detect_attack_patterns(input: &str) -> JsValue {
    let patterns = with_sanitizer(|s| s.detect_attack_patterns(input))
        .unwrap_or_default();
    serde_wasm_bindgen::to_value(&patterns).unwrap_or(JsValue::NULL)
}

#[wasm_bindgen]
pub fn validate_json_input(json_str: &str, max_size: u32) -> JsValue {
    match with_sanitizer(|s| s.validate_json(json_str, max_size as usize)) {
        Ok(Some(valid_json)) => JsValue::from_str(&valid_json),
        Ok(None) => JsValue::NULL,
        Err(_) => JsValue::NULL,
    }
}

// Utility function for batch validation
#[wasm_bindgen]
pub fn validate_input_batch(input_type: &str, values: &JsValue) -> JsValue {
    let values: Vec<String> = serde_wasm_bindgen::from_value(values.clone())
        .unwrap_or_default();

    let results: Vec<Option<String>> = values
        .iter()
        .map(|value| {
            match input_type {
                "room_id" => with_sanitizer(|s| s.validate_room_id(value)).unwrap_or(None),
                "username" => with_sanitizer(|s| s.validate_username(value)).unwrap_or(None),
                "message" => with_sanitizer(|s| s.validate_message(value)).unwrap_or(None),
                "url_param" => with_sanitizer(|s| s.validate_url_param(value)).unwrap_or(None),
                _ => None,
            }
        })
        .collect();

    serde_wasm_bindgen::to_value(&results).unwrap_or(JsValue::NULL)
}