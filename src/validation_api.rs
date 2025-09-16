// src/validation_api.rs
// Phase 2: Input Sanitization and Validation WASM Bindings

use crate::sanitizer::with_sanitizer;
use crate::console_log;
use wasm_bindgen::prelude::*;

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