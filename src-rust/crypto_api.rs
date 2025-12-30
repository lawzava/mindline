// src/crypto_api.rs
// Encryption Key Persistence WASM Bindings

use crate::console_log;
use crate::crypto::{
    decrypt_with_key, encrypt_with_key, get_key_data, with_encryption_manager, EncryptedData,
};
use js_sys::Promise;
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::future_to_promise;

// ========== Encryption Key Persistence Functions ==========
// Note: generate_room_encryption_key, list_encryption_keys, delete_encryption_key
// are already defined in advanced_api.rs

/// Save room encryption key to localStorage
#[wasm_bindgen]
pub fn save_room_key_to_storage(room_id: &str) -> Result<(), JsValue> {
    with_encryption_manager(|manager| manager.save_room_key_to_storage(room_id))?
}

/// Load room encryption key from localStorage
/// Returns true if key was loaded, false if no key exists
#[wasm_bindgen]
pub fn load_room_key_from_storage(room_id: &str) -> Result<bool, JsValue> {
    with_encryption_manager(|manager| manager.load_room_key_from_storage(room_id))?
}

/// Check if room has a key in localStorage
#[wasm_bindgen]
pub fn has_room_key_in_storage(room_id: &str) -> Result<bool, JsValue> {
    with_encryption_manager(|manager| manager.has_room_key_in_storage(room_id))?
}

/// Check if room has a key in memory
#[wasm_bindgen]
pub fn has_room_key(room_id: &str) -> bool {
    with_encryption_manager(|manager| manager.get_room_key_id(room_id).is_some()).unwrap_or(false)
}

/// Initialize room encryption - loads from storage or generates new key
#[wasm_bindgen]
pub fn initialize_room_encryption(room_id: &str) -> Result<bool, JsValue> {
    console_log!("[WASM] Initializing room encryption for room: {}", room_id);

    // First, try to load existing key from localStorage
    let key_loaded =
        with_encryption_manager(|manager| manager.load_room_key_from_storage(room_id))??;

    if key_loaded {
        console_log!(
            "[WASM] Loaded existing encryption key for room: {}",
            room_id
        );
        return Ok(true);
    }

    // No key in storage, generate a new one
    console_log!(
        "[WASM] No existing key found, generating new key for room: {}",
        room_id
    );
    let key_id = with_encryption_manager(|manager| manager.generate_room_key(room_id))??;
    console_log!("[WASM] Generated new key: {}", key_id);

    // Save the new key to localStorage
    with_encryption_manager(|manager| manager.save_room_key_to_storage(room_id))??;
    console_log!("[WASM] Saved new key to localStorage for room: {}", room_id);

    Ok(false) // false = new key was created (not loaded from storage)
}

/// Encrypt message content using room key (async - returns Promise)
/// Uses real AES-256-GCM via Web Crypto API
#[wasm_bindgen]
pub fn encrypt_message_content(room_id: String, content: String) -> Promise {
    future_to_promise(async move {
        let key_id = format!("room_key_{}", room_id);

        // Get key data synchronously before async operation
        let (key_data, algorithm) = get_key_data(&key_id)?;

        // Call standalone async encryption function with owned data
        let result = encrypt_with_key(content, key_data, key_id, algorithm).await?;

        // Serialize the encrypted data to JSON for transmission
        let json = serde_json::to_string(&result)
            .map_err(|e| JsValue::from_str(&format!("Encryption serialization error: {}", e)))?;

        Ok(JsValue::from_str(&json))
    })
}

/// Decrypt message content using room key (async - returns Promise)
/// Uses real AES-256-GCM via Web Crypto API
#[wasm_bindgen]
pub fn decrypt_message_content(encrypted_json: String) -> Promise {
    future_to_promise(async move {
        // Deserialize the encrypted data from JSON
        let encrypted_data: EncryptedData = serde_json::from_str(&encrypted_json)
            .map_err(|e| JsValue::from_str(&format!("Decryption deserialization error: {}", e)))?;

        // Get key data synchronously before async operation
        let (key_data, _algorithm) = get_key_data(&encrypted_data.key_id)?;

        // Call standalone async decryption function with owned data
        let result = decrypt_with_key(encrypted_data, key_data).await?;

        Ok(JsValue::from_str(&result))
    })
}
