// src/state_api.rs
// Phase 1: Enhanced State Management WASM Bindings

use crate::types::{DraftMessage, RoomHistory, RoomMetadata, UserSession};
use crate::state::APP_STATE;
use crate::console_log;
use wasm_bindgen::prelude::*;

// ========== Phase 1: Enhanced State Management Functions ==========

// Core state management functions


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