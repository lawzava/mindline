// src/lib.rs
// Version 1.0.1 - Memory access fix applied
use getrandom::getrandom;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use wasm_bindgen::prelude::*;

// Include sanitizer module
mod sanitizer;
use sanitizer::with_sanitizer;

// Include messages module
mod messages;
use messages::{EnhancedMessage, MessageSyncRequest, SyncRequestType, with_message_manager};

// Include p2p module
mod p2p;
use p2p::{with_p2p_manager, ConnectionDecision, ConnectionState, ConnectionStrategy, PeerRole};

// Include logger module
mod logger;
use logger::{with_logger, LogLevel, LogComponent, LogContext, LogFilter};

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

// DEPRECATED: Use send_message_enhanced instead
// Send a message to the current room (legacy function - will be removed)
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

// DEPRECATED: Use get_room_messages instead
// Get messages from a room (legacy function - will be removed)
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
    match with_sanitizer(|s| s.validate_room_id(room_id)) {
        Ok(Some(valid_id)) => valid_id,
        Ok(None) => {
            console_log!("Room ID validation failed, returning empty string");
            String::new()
        },
        Err(_) => {
            console_log!("Error in room ID validation, returning empty string");
            String::new()
        }
    }
}

#[wasm_bindgen]
pub fn validate_username(username: &str) -> String {
    match with_sanitizer(|s| s.validate_username(username)) {
        Ok(Some(valid_name)) => valid_name,
        Ok(None) => {
            console_log!("Username validation failed, returning empty string");
            String::new()
        },
        Err(_) => {
            console_log!("Error in username validation, returning empty string");
            String::new()
        }
    }
}

#[wasm_bindgen]
pub fn validate_message(message: &str) -> String {
    match with_sanitizer(|s| s.validate_message(message)) {
        Ok(Some(valid_message)) => valid_message,
        Ok(None) => {
            console_log!("Message validation failed, returning empty string");
            String::new()
        },
        Err(_) => {
            console_log!("Error in message validation, returning empty string");
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

// ========== Phase 3: Enhanced Message Processing Functions ==========

#[wasm_bindgen]
pub fn set_message_manager_user(user_id: &str) -> Result<(), JsValue> {
    with_message_manager(|manager| {
        manager.set_current_user(user_id.to_string());
        console_log!("Message manager user set to: {}", user_id);
    })
}

#[wasm_bindgen]
pub fn send_message_enhanced(
    room_id: &str,
    content: &str,
    message_id: &str,
) -> Result<JsValue, JsValue> {
    // Get the sender name from APP_STATE
    let sender_name = APP_STATE.with(|state| {
        let state = state.lock().unwrap();
        state.user_session.as_ref()
            .map(|session| session.name.clone())
            .unwrap_or_else(|| "Anonymous".to_string())
    });

    let message = with_message_manager(|manager| {
        manager.send_message(room_id, content, message_id, &sender_name)
    })??;

    serde_wasm_bindgen::to_value(&message)
        .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
}

#[wasm_bindgen]
pub fn receive_message_from_peer(message_data: &JsValue) -> Result<bool, JsValue> {
    let message: EnhancedMessage = serde_wasm_bindgen::from_value(message_data.clone())
        .map_err(|e| JsValue::from_str(&format!("Failed to deserialize message: {}", e)))?;

    with_message_manager(|manager| {
        manager.receive_message(message)
    })
}

#[wasm_bindgen]
pub fn get_room_messages(room_id: &str, limit: Option<u32>) -> JsValue {
    // Debug logging to see what we're receiving
    console_log!("[WASM] get_room_messages called with room_id: {}, limit: {:?}", room_id, limit);

    // Handle the case where wasm-bindgen might pass a sentinel value
    // The JS binding uses 0x100000001 as a sentinel for None
    let safe_limit = if let Some(l) = limit {
        // Check if the value is suspiciously large (likely the sentinel)
        if l > 1000000 {
            console_log!("[WASM] Detected sentinel value {} for None, using None", l);
            None
        } else {
            console_log!("[WASM] Using limit value: {}", l);
            Some(l as usize)
        }
    } else {
        console_log!("[WASM] No limit specified (None)");
        None
    };

    let messages = with_message_manager(|manager| {
        manager.get_messages(room_id, safe_limit)
    }).unwrap_or_default();

    console_log!("[WASM] Returning {} messages", messages.len());
    serde_wasm_bindgen::to_value(&messages).unwrap_or(JsValue::NULL)
}

#[wasm_bindgen]
pub fn edit_message(room_id: &str, message_id: &str, new_content: &str) -> Result<(), JsValue> {
    with_message_manager(|manager| {
        manager.edit_message(room_id, message_id, new_content)
    })?
}

#[wasm_bindgen]
pub fn delete_message(room_id: &str, message_id: &str) -> Result<(), JsValue> {
    with_message_manager(|manager| {
        manager.delete_message(room_id, message_id)
    })?
}

#[wasm_bindgen]
pub fn add_message_reaction(
    room_id: &str,
    message_id: &str,
    emoji: &str,
    user_id: &str,
) -> Result<(), JsValue> {
    with_message_manager(|manager| {
        manager.add_reaction(room_id, message_id, emoji, user_id)
    })?
}

#[wasm_bindgen]
pub fn handle_typing_indicator(room_id: &str, user_id: &str, is_typing: bool) -> Result<(), JsValue> {
    with_message_manager(|manager| {
        manager.handle_typing_indicator(room_id, user_id, is_typing);
        Ok(())
    })?
}

#[wasm_bindgen]
pub fn get_typing_users(room_id: &str) -> JsValue {
    let typing_users = with_message_manager(|manager| {
        manager.get_typing_users(room_id)
    }).unwrap_or_default();

    serde_wasm_bindgen::to_value(&typing_users).unwrap_or(JsValue::NULL)
}

#[wasm_bindgen]
pub fn get_messages_for_sync(
    room_id: &str,
    after_timestamp: f64,
    limit: u32,
) -> JsValue {
    let messages = with_message_manager(|manager| {
        manager.get_messages_for_sync(room_id, after_timestamp as u64, limit as usize)
    }).unwrap_or_default();

    serde_wasm_bindgen::to_value(&messages).unwrap_or(JsValue::NULL)
}

#[wasm_bindgen]
pub fn get_room_message_stats(room_id: &str) -> JsValue {
    let stats = with_message_manager(|manager| {
        manager.get_room_stats(room_id)
    }).unwrap_or_default();

    if let Some((total, unread, last_sync)) = stats {
        let stats_obj = js_sys::Object::new();
        js_sys::Reflect::set(&stats_obj, &"totalMessages".into(), &(total as u32).into()).unwrap();
        js_sys::Reflect::set(&stats_obj, &"unreadCount".into(), &(unread as u32).into()).unwrap();
        js_sys::Reflect::set(&stats_obj, &"lastSync".into(), &(last_sync as f64).into()).unwrap();
        stats_obj.into()
    } else {
        JsValue::NULL
    }
}

// Message synchronization helpers
#[wasm_bindgen]
pub fn create_sync_request(room_id: &str, last_sync: f64, message_count: u32) -> JsValue {
    let sync_request = MessageSyncRequest {
        request_type: SyncRequestType::RequestSync {
            last_sync: last_sync as u64,
            message_count: message_count as usize,
        },
        room_id: room_id.to_string(),
        requester_id: get_current_user_id(),
        timestamp: js_sys::Date::now() as u64,
    };

    serde_wasm_bindgen::to_value(&sync_request).unwrap_or(JsValue::NULL)
}

#[wasm_bindgen]
pub fn handle_sync_request(request_data: &JsValue) -> JsValue {
    let request: MessageSyncRequest = match serde_wasm_bindgen::from_value(request_data.clone()) {
        Ok(req) => req,
        Err(_) => return JsValue::NULL,
    };

    match request.request_type {
        SyncRequestType::RequestSync { last_sync, .. } => {
            let messages = with_message_manager(|manager| {
                manager.get_messages_for_sync(&request.room_id, last_sync, 50)
            }).unwrap_or_default();

            let response = MessageSyncRequest {
                request_type: SyncRequestType::SyncResponse { messages },
                room_id: request.room_id,
                requester_id: get_current_user_id(),
                timestamp: js_sys::Date::now() as u64,
            };

            serde_wasm_bindgen::to_value(&response).unwrap_or(JsValue::NULL)
        },
        _ => JsValue::NULL,
    }
}

#[wasm_bindgen]
pub fn save_room_messages_to_storage(room_id: &str) -> Result<(), JsValue> {
    with_message_manager(|manager| {
        manager.save_room_to_storage(room_id)
    })?
}

#[wasm_bindgen]
pub fn load_room_messages_from_storage(room_id: &str) -> Result<bool, JsValue> {
    with_message_manager(|manager| {
        manager.load_room_from_storage(room_id)
    })?
}

// P2P Network Coordination WASM Bindings

#[wasm_bindgen]
pub fn initialize_p2p_manager(client_id: &str, room_id: &str) -> Result<(), JsValue> {
    if client_id.is_empty() || room_id.is_empty() {
        return Err(JsValue::from_str("Client ID and room ID cannot be empty"));
    }

    p2p::P2P_MANAGER.with(|manager| {
        let mut manager_ref = manager.borrow_mut();
        *manager_ref = Some(p2p::P2PNetworkState::new(client_id.to_string(), room_id.to_string()));
        console_log!("P2P manager initialized for client {} in room {}", client_id, room_id);
    });

    Ok(())
}

#[wasm_bindgen]
pub fn add_known_peer(peer_id: &str) -> Result<bool, JsValue> {
    with_p2p_manager(|manager| {
        manager.add_peer(peer_id.to_string())
    })
}

#[wasm_bindgen]
pub fn remove_peer_from_network(peer_id: &str) -> Result<(), JsValue> {
    with_p2p_manager(|manager| {
        manager.remove_peer(peer_id);
    })?;
    Ok(())
}

#[wasm_bindgen]
pub fn update_peer_connection_state(peer_id: &str, state: &str) -> Result<(), JsValue> {
    let connection_state = match state {
        "connecting" => ConnectionState::Connecting,
        "connected" => ConnectionState::Connected,
        "failed" => ConnectionState::Failed,
        "reconnecting" => ConnectionState::Reconnecting,
        "closing" => ConnectionState::Closing,
        _ => ConnectionState::Disconnected,
    };

    with_p2p_manager(|manager| {
        if let Some(peer) = manager.get_peer_mut(peer_id) {
            peer.update_connection_state(connection_state);
            console_log!("Updated peer {} state to {:?}", peer_id, state);
        } else {
            // Create new peer if doesn't exist
            let mut peer = p2p::PeerConnection::new(peer_id.to_string(), PeerRole::Unknown);
            peer.update_connection_state(connection_state);
            manager.peers.insert(peer_id.to_string(), peer);
        }
    })?;

    Ok(())
}

#[wasm_bindgen]
pub fn should_initiate_connection_to_peer(peer_id: &str) -> bool {
    with_p2p_manager(|manager| {
        manager.should_initiate_connection(peer_id)
    }).unwrap_or(false)
}

#[wasm_bindgen]
pub fn get_connection_decision(peer_id: &str) -> JsValue {
    let decision = with_p2p_manager(|manager| {
        manager.evaluate_connection_decision(peer_id)
    }).unwrap_or_else(|_| ConnectionDecision {
        should_connect: false,
        delay_ms: 0,
        priority: 0,
        reason: "P2P manager not available".to_string(),
    });

    serde_wasm_bindgen::to_value(&decision).unwrap_or(JsValue::NULL)
}

#[wasm_bindgen]
pub fn get_connected_peer_list() -> JsValue {
    let peers = with_p2p_manager(|manager| {
        manager.get_connected_peers()
    }).unwrap_or_default();

    serde_wasm_bindgen::to_value(&peers).unwrap_or(JsValue::NULL)
}

#[wasm_bindgen]
pub fn record_peer_message_sent(peer_id: &str, size_bytes: u32) -> Result<(), JsValue> {
    with_p2p_manager(|manager| {
        if let Some(peer) = manager.get_peer_mut(peer_id) {
            peer.record_message_sent(size_bytes as u64);
        }
    })?;
    Ok(())
}

#[wasm_bindgen]
pub fn record_peer_message_received(peer_id: &str, size_bytes: u32) -> Result<(), JsValue> {
    with_p2p_manager(|manager| {
        if let Some(peer) = manager.get_peer_mut(peer_id) {
            peer.record_message_received(size_bytes as u64);
        }
    })?;
    Ok(())
}

#[wasm_bindgen]
pub fn update_peer_latency(peer_id: &str, latency_ms: u32) -> Result<(), JsValue> {
    with_p2p_manager(|manager| {
        if let Some(peer) = manager.get_peer_mut(peer_id) {
            peer.update_latency(latency_ms);
        }
    })?;
    Ok(())
}

#[wasm_bindgen]
pub fn needs_mesh_repair() -> bool {
    with_p2p_manager(|manager| {
        manager.needs_mesh_repair()
    }).unwrap_or(false)
}

#[wasm_bindgen]
pub fn get_mesh_repair_plan() -> JsValue {
    let plan = with_p2p_manager(|manager| {
        manager.get_mesh_repair_plan()
    }).unwrap_or_default();

    serde_wasm_bindgen::to_value(&plan).unwrap_or(JsValue::NULL)
}

#[wasm_bindgen]
pub fn get_p2p_network_stats() -> JsValue {
    let stats = with_p2p_manager(|manager| {
        let connected_count = manager.get_connected_peers().len();
        let known_count = manager.all_known_peers.len();
        let avg_quality = manager.get_average_connection_quality();

        let stats_obj = js_sys::Object::new();
        js_sys::Reflect::set(&stats_obj, &"connectedPeers".into(), &(connected_count as u32).into()).unwrap();
        js_sys::Reflect::set(&stats_obj, &"knownPeers".into(), &(known_count as u32).into()).unwrap();
        js_sys::Reflect::set(&stats_obj, &"averageQuality".into(), &avg_quality.into()).unwrap();
        js_sys::Reflect::set(&stats_obj, &"connectionStrategy".into(), &format!("{:?}", manager.connection_strategy).into()).unwrap();
        js_sys::Reflect::set(&stats_obj, &"isReconnecting".into(), &manager.is_reconnecting.into()).unwrap();

        stats_obj.into()
    }).unwrap_or_else(|_| JsValue::NULL);

    stats
}

#[wasm_bindgen]
pub fn handle_connection_failure(peer_id: &str) -> JsValue {
    let strategy = with_p2p_manager(|manager| {
        // Mark peer as failed
        if let Some(peer) = manager.get_peer_mut(peer_id) {
            peer.update_connection_state(ConnectionState::Failed);
            peer.connection_attempts += 1;
            peer.last_attempt = js_sys::Date::now() as u64;
        }

        // Return reconnection strategy
        let decision = manager.evaluate_connection_decision(peer_id);
        decision
    }).unwrap_or_else(|_| ConnectionDecision {
        should_connect: false,
        delay_ms: 0,
        priority: 0,
        reason: "P2P manager not available".to_string(),
    });

    serde_wasm_bindgen::to_value(&strategy).unwrap_or(JsValue::NULL)
}

#[wasm_bindgen]
pub fn set_connection_strategy(strategy: &str) -> Result<(), JsValue> {
    let new_strategy = match strategy {
        "full_mesh" => ConnectionStrategy::FullMesh,
        "selective" => ConnectionStrategy::Selective,
        "hub" => ConnectionStrategy::Hub,
        "adaptive" => ConnectionStrategy::Adaptive,
        _ => return Err(JsValue::from_str("Invalid connection strategy")),
    };

    with_p2p_manager(|manager| {
        manager.connection_strategy = new_strategy;
        console_log!("Connection strategy set to: {:?}", manager.connection_strategy);
    })?;

    Ok(())
}

#[wasm_bindgen]
pub fn cleanup_stale_peers(timeout_minutes: u32) -> u32 {
    let timeout_ms = timeout_minutes as u64 * 60 * 1000;
    let mut removed_count = 0;

    if let Ok(()) = with_p2p_manager(|manager| {
        let stale_peers: Vec<String> = manager.peers
            .iter()
            .filter(|(_, peer)| peer.is_stale(timeout_ms))
            .map(|(id, _)| id.clone())
            .collect();

        for peer_id in stale_peers {
            manager.remove_peer(&peer_id);
            removed_count += 1;
        }

        if removed_count > 0 {
            console_log!("Cleaned up {} stale peers", removed_count);
        }
    }) {};

    removed_count
}

#[wasm_bindgen]
pub fn get_best_peers_for_broadcast(max_peers: u32) -> JsValue {
    let peers = with_p2p_manager(|manager| {
        manager.get_best_peers_for_broadcast(max_peers as usize)
    }).unwrap_or_default();

    serde_wasm_bindgen::to_value(&peers).unwrap_or(JsValue::NULL)
}

#[wasm_bindgen]
pub fn should_send_to_peer(peer_id: &str, message_priority: u32) -> bool {
    with_p2p_manager(|manager| {
        manager.should_use_peer_for_message(peer_id, message_priority)
    }).unwrap_or(false)
}

#[wasm_bindgen]
pub fn get_broadcast_plan(redundancy_level: u32) -> JsValue {
    let plan = with_p2p_manager(|manager| {
        manager.get_redundant_broadcast_plan(redundancy_level)
    }).unwrap_or_default();

    serde_wasm_bindgen::to_value(&plan).unwrap_or(JsValue::NULL)
}

// ========== Phase 5: Logging System WASM Bindings ==========

#[wasm_bindgen]
pub fn initialize_logger(is_development: bool, debug_enabled: bool) -> Result<(), JsValue> {
    let config = logger::LoggerConfig {
        is_development,
        debug_enabled,
        ..logger::LoggerConfig::default()
    };

    logger::GLOBAL_LOGGER.with(|logger| {
        let mut logger_ref = logger.borrow_mut();
        *logger_ref = Some(logger::Logger::new(config));
    });

    console_log!("Logger initialized - dev: {}, debug: {}", is_development, debug_enabled);
    Ok(())
}

#[wasm_bindgen]
pub fn set_log_context(user_id: Option<String>, room_id: Option<String>, component: Option<String>) -> Result<(), JsValue> {
    let context = LogContext {
        user_id,
        room_id,
        component: component.map(|c| LogComponent::from_str(&c)),
    };

    with_logger(|logger| {
        logger.set_context(context);
    })?;

    Ok(())
}

#[wasm_bindgen]
pub fn log_debug(component: &str, message: &str) {
    let _ = with_logger(|logger| {
        logger.debug(LogComponent::from_str(component), message);
    });
}

#[wasm_bindgen]
pub fn log_info(component: &str, message: &str) {
    let _ = with_logger(|logger| {
        logger.info(LogComponent::from_str(component), message);
    });
}

#[wasm_bindgen]
pub fn log_warn(component: &str, message: &str) {
    let _ = with_logger(|logger| {
        logger.warn(LogComponent::from_str(component), message);
    });
}

#[wasm_bindgen]
pub fn log_error(component: &str, message: &str) {
    let _ = with_logger(|logger| {
        logger.error(LogComponent::from_str(component), message);
    });
}

#[wasm_bindgen]
pub fn log_with_data(level: &str, component: &str, message: &str, data: &str) -> Result<(), JsValue> {
    let log_level = LogLevel::from_str(level)
        .ok_or_else(|| JsValue::from_str("Invalid log level"))?;

    with_logger(|logger| {
        logger.log_with_data(log_level, LogComponent::from_str(component), message, Some(data));
    })?;

    Ok(())
}

#[wasm_bindgen]
pub fn start_performance_timer(label: &str) -> Result<(), JsValue> {
    with_logger(|logger| {
        logger.start_timer(label);
    })?;
    Ok(())
}

#[wasm_bindgen]
pub fn end_performance_timer(label: &str) -> Option<f64> {
    with_logger(|logger| {
        logger.end_timer(label).map(|duration| duration as f64)
    }).unwrap_or(None)
}

#[wasm_bindgen]
pub fn start_log_group(label: &str) -> Result<(), JsValue> {
    with_logger(|logger| {
        logger.group(label);
    })?;
    Ok(())
}

#[wasm_bindgen]
pub fn end_log_group() -> Result<(), JsValue> {
    with_logger(|logger| {
        logger.group_end();
    })?;
    Ok(())
}

#[wasm_bindgen]
pub fn log_table(data: &JsValue) -> Result<(), JsValue> {
    with_logger(|logger| {
        logger.table(data);
    })?;
    Ok(())
}

#[wasm_bindgen]
pub fn get_log_entries(filter_json: Option<String>) -> JsValue {
    let filter = filter_json
        .and_then(|json| serde_json::from_str::<LogFilter>(&json).ok());

    let logs = with_logger(|logger| {
        logger.get_logs(filter)
    }).unwrap_or_default();

    serde_wasm_bindgen::to_value(&logs).unwrap_or(JsValue::NULL)
}

#[wasm_bindgen]
pub fn clear_log_buffer() -> Result<(), JsValue> {
    with_logger(|logger| {
        logger.clear_logs();
    })?;
    Ok(())
}

#[wasm_bindgen]
pub fn export_logs_json(filter_json: Option<String>) -> String {
    let filter = filter_json
        .and_then(|json| serde_json::from_str::<LogFilter>(&json).ok());

    with_logger(|logger| {
        logger.export_logs(filter)
    }).unwrap_or_else(|_| "[]".to_string())
}

#[wasm_bindgen]
pub fn export_recent_logs_json(count: u32) -> String {
    with_logger(|logger| {
        logger.export_recent_logs(count as usize)
    }).unwrap_or_else(|_| "[]".to_string())
}

#[wasm_bindgen]
pub fn get_log_statistics() -> JsValue {
    let stats = with_logger(|logger| {
        logger.get_log_stats()
    }).unwrap_or_default();

    serde_wasm_bindgen::to_value(&stats).unwrap_or(JsValue::NULL)
}

#[wasm_bindgen]
pub fn enable_debug_logging() -> Result<(), JsValue> {
    with_logger(|logger| {
        logger.config.debug_enabled = true;
        logger.info(LogComponent::Core, "Debug logging enabled");
    })?;
    Ok(())
}

#[wasm_bindgen]
pub fn disable_debug_logging() -> Result<(), JsValue> {
    with_logger(|logger| {
        logger.config.debug_enabled = false;
        logger.info(LogComponent::Core, "Debug logging disabled");
    })?;
    Ok(())
}

#[wasm_bindgen]
pub fn configure_logger(
    max_entries: u32,
    console_output: bool,
    buffer_logs: bool,
    auto_export_errors: bool,
) -> Result<(), JsValue> {
    with_logger(|logger| {
        logger.config.max_log_entries = max_entries as usize;
        logger.config.console_output_enabled = console_output;
        logger.config.buffer_logs = buffer_logs;
        logger.config.auto_export_errors = auto_export_errors;

        logger.info(LogComponent::Core, "Logger configuration updated");
    })?;
    Ok(())
}

#[wasm_bindgen]
pub fn search_logs(query: &str, limit: Option<u32>) -> JsValue {
    let results = with_logger(|logger| {
        logger.search_logs(query, limit.map(|l| l as usize))
    }).unwrap_or_default();

    serde_wasm_bindgen::to_value(&results).unwrap_or(JsValue::NULL)
}

#[wasm_bindgen]
pub fn get_logs_by_component(component: &str, limit: Option<u32>) -> JsValue {
    let comp = LogComponent::from_str(component);
    let results = with_logger(|logger| {
        logger.get_logs_by_component(comp, limit.map(|l| l as usize))
    }).unwrap_or_default();

    serde_wasm_bindgen::to_value(&results).unwrap_or(JsValue::NULL)
}

#[wasm_bindgen]
pub fn get_error_summary(last_n_minutes: u32) -> JsValue {
    let summary = with_logger(|logger| {
        logger.get_error_summary(last_n_minutes)
    }).unwrap_or_else(|_| logger::ErrorSummary {
        total_errors: 0,
        unique_errors: 0,
        error_counts: HashMap::new(),
        component_errors: HashMap::new(),
        time_range_minutes: last_n_minutes,
        first_error_time: None,
        last_error_time: None,
    });

    serde_wasm_bindgen::to_value(&summary).unwrap_or(JsValue::NULL)
}

#[wasm_bindgen]
pub fn create_debug_report() -> String {
    with_logger(|logger| {
        let report = logger.create_debug_report();
        serde_json::to_string_pretty(&report).unwrap_or_else(|_| "Failed to create debug report".to_string())
    }).unwrap_or_else(|_| "Logger not available".to_string())
}