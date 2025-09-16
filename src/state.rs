// src/state.rs
// Global state management for the chat application

use crate::types::{AppState, ChatManager};
use std::sync::{Arc, Mutex};

// Global state manager
thread_local! {
    pub static APP_STATE: Arc<Mutex<AppState>> = Arc::new(Mutex::new(AppState::default()));
}

// Our chat manager singleton (kept for compatibility during transition)
thread_local! {
    pub static CHAT_MANAGER: Arc<Mutex<ChatManager>> = Arc::new(Mutex::new(ChatManager::new()));
}