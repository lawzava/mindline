// src/message_api.rs
// Phase 3: Enhanced Message Processing WASM Bindings

use crate::console_log;
use crate::messages::{with_message_manager, EnhancedMessage, MessageSyncRequest, SyncRequestType};
use crate::state::APP_STATE;
use crate::state_api::get_current_user_id;
use wasm_bindgen::prelude::*;

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
        state
            .user_session
            .as_ref()
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

    with_message_manager(|manager| manager.receive_message(message))
}

#[wasm_bindgen]
pub fn get_room_messages(room_id: &str, limit: Option<u32>) -> JsValue {
    // Debug logging to see what we're receiving
    console_log!(
        "[WASM] get_room_messages called with room_id: {}, limit: {:?}",
        room_id,
        limit
    );

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

    let messages = with_message_manager(|manager| manager.get_messages(room_id, safe_limit))
        .unwrap_or_default();

    console_log!("[WASM] Returning {} messages", messages.len());
    serde_wasm_bindgen::to_value(&messages).unwrap_or(JsValue::NULL)
}

#[wasm_bindgen]
pub fn get_room_message_stats(room_id: &str) -> JsValue {
    let stats = with_message_manager(|manager| manager.get_room_stats(room_id)).unwrap_or_default();

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
            })
            .unwrap_or_default();

            let response = MessageSyncRequest {
                request_type: SyncRequestType::SyncResponse { messages },
                room_id: request.room_id,
                requester_id: get_current_user_id(),
                timestamp: js_sys::Date::now() as u64,
            };

            serde_wasm_bindgen::to_value(&response).unwrap_or(JsValue::NULL)
        }
        _ => JsValue::NULL,
    }
}

#[wasm_bindgen]
pub fn save_room_messages_to_storage(room_id: &str) -> Result<(), JsValue> {
    with_message_manager(|manager| manager.save_room_to_storage(room_id))?
}

#[wasm_bindgen]
pub fn load_room_messages_from_storage(room_id: &str) -> Result<bool, JsValue> {
    with_message_manager(|manager| manager.load_room_from_storage(room_id))?
}
