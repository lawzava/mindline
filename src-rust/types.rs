// src/types.rs
// Core types and data structures for the chat application

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

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
    pub id: String,
    pub sender_id: String,
    pub sender_name: String,
    pub message_type: MessageType,
    pub content: String,
    pub timestamp: u64,
    pub room_id: String,
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
    pub message_history: HashMap<String, Message>,     // message_id -> message (for deduplication)
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

// Legacy ChatManager kept for compatibility with some deprecated functions
pub struct ChatManager {
    pub user_id: String,
    pub user_name: String,
    pub current_room_id: Option<String>,
}

impl Default for ChatManager {
    fn default() -> Self {
        Self {
            user_id: "default-user-id".to_string(),
            user_name: "Anonymous".to_string(),
            current_room_id: None,
        }
    }
}

impl ChatManager {
    pub fn new() -> Self {
        Self::default()
    }
}
