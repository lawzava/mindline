// src/utils.rs
// URL and utility functions

use crate::console_log;
use wasm_bindgen::prelude::*;

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