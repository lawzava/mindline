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

