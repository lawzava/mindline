// src/crypto.rs - Enhanced encryption system with real AES-256-GCM via Web Crypto API

use js_sys::{Promise, Uint8Array};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::JsFuture;

// Import Web Crypto API bridge functions from JavaScript
#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = window, js_name = webcryptoEncrypt)]
    fn js_webcrypto_encrypt(plaintext: &Uint8Array, key: &Uint8Array, iv: &Uint8Array) -> Promise;

    #[wasm_bindgen(js_namespace = window, js_name = webcryptoDecrypt)]
    fn js_webcrypto_decrypt(ciphertext: &Uint8Array, key: &Uint8Array, iv: &Uint8Array) -> Promise;

    #[wasm_bindgen(js_namespace = window, js_name = webcryptoDeriveKey)]
    fn js_webcrypto_derive_key(password: &str, salt: &Uint8Array, iterations: u32) -> Promise;

    #[wasm_bindgen(js_namespace = window, js_name = webcryptoRandomBytes)]
    fn js_webcrypto_random_bytes(length: u32) -> Uint8Array;
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct EncryptionKey {
    pub id: String,
    pub key_data: Vec<u8>,
    pub algorithm: String,
    pub created_at: u64,
    pub expires_at: Option<u64>,
    pub usage: KeyUsage,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub enum KeyUsage {
    MessageEncryption,
    RoomKey,
    UserIdentity,
    FileEncryption,
    P2PSignaling,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct EncryptedData {
    pub ciphertext: Vec<u8>,
    pub nonce: Vec<u8>,
    pub algorithm: String,
    pub key_id: String,
    pub timestamp: u64,
    pub integrity_hash: String,
}

pub struct EncryptionManager {
    keys: HashMap<String, EncryptionKey>,
    default_room_key: Option<String>,
    user_identity_key: Option<String>,
}

#[allow(dead_code)]
impl EncryptionManager {
    pub fn new() -> Self {
        Self {
            keys: HashMap::new(),
            default_room_key: None,
            user_identity_key: None,
        }
    }

    pub fn generate_room_key(&mut self, room_id: &str) -> Result<String, JsValue> {
        let key_id = format!("room_key_{}", room_id);

        // Use Web Crypto API for secure random key generation
        let random_bytes = js_webcrypto_random_bytes(32);
        let key_data = random_bytes.to_vec();

        let encryption_key = EncryptionKey {
            id: key_id.clone(),
            key_data,
            algorithm: "AES-256-GCM".to_string(),
            created_at: js_sys::Date::now() as u64,
            expires_at: None,
            usage: KeyUsage::RoomKey,
        };

        self.keys.insert(key_id.clone(), encryption_key);
        self.default_room_key = Some(key_id.clone());

        // Note: Removed logging of room key for security
        Ok(key_id)
    }

    /// Encrypt a message using AES-256-GCM via Web Crypto API
    /// This is an async function that returns a Promise
    pub async fn encrypt_message_async(
        &self,
        message: &str,
        key_id: Option<&str>,
    ) -> Result<EncryptedData, JsValue> {
        let key_id = key_id
            .or(self.default_room_key.as_deref())
            .ok_or_else(|| JsValue::from_str("No encryption key specified or available"))?;

        let key = self
            .keys
            .get(key_id)
            .ok_or_else(|| JsValue::from_str("Encryption key not found"))?;

        // Generate 12-byte nonce using Web Crypto
        let nonce_js = js_webcrypto_random_bytes(12);
        let nonce_data = nonce_js.to_vec();

        // Convert data to Uint8Array for JavaScript
        let plaintext_js = Uint8Array::from(message.as_bytes());
        let key_js = Uint8Array::from(key.key_data.as_slice());
        let iv_js = Uint8Array::from(nonce_data.as_slice());

        // Call Web Crypto API for real AES-256-GCM encryption
        let promise = js_webcrypto_encrypt(&plaintext_js, &key_js, &iv_js);
        let result = JsFuture::from(promise).await?;

        // Convert result back to Vec<u8>
        let ciphertext_js: Uint8Array = result.dyn_into()?;
        let ciphertext = ciphertext_js.to_vec();

        // AES-GCM includes authentication tag - no separate integrity hash needed
        // But we keep it for backward compatibility and additional verification
        let integrity_input = format!("{}:{}", hex::encode(&ciphertext), hex::encode(&nonce_data));
        let integrity_hash = self.calculate_hash(&integrity_input);

        Ok(EncryptedData {
            ciphertext,
            nonce: nonce_data,
            algorithm: key.algorithm.clone(),
            key_id: key_id.to_string(),
            timestamp: js_sys::Date::now() as u64,
            integrity_hash,
        })
    }

    /// Decrypt a message using AES-256-GCM via Web Crypto API
    /// This is an async function that returns a Promise
    pub async fn decrypt_message_async(
        &self,
        encrypted_data: &EncryptedData,
    ) -> Result<String, JsValue> {
        // Verify integrity hash first (additional check on top of GCM auth tag)
        let integrity_input = format!(
            "{}:{}",
            hex::encode(&encrypted_data.ciphertext),
            hex::encode(&encrypted_data.nonce)
        );
        let calculated_hash = self.calculate_hash(&integrity_input);

        if calculated_hash != encrypted_data.integrity_hash {
            return Err(JsValue::from_str("Integrity check failed"));
        }

        let key = self
            .keys
            .get(&encrypted_data.key_id)
            .ok_or_else(|| JsValue::from_str("Decryption key not found"))?;

        // Convert data to Uint8Array for JavaScript
        let ciphertext_js = Uint8Array::from(encrypted_data.ciphertext.as_slice());
        let key_js = Uint8Array::from(key.key_data.as_slice());
        let iv_js = Uint8Array::from(encrypted_data.nonce.as_slice());

        // Call Web Crypto API for real AES-256-GCM decryption
        // This will fail if the auth tag is invalid (tampering detected)
        let promise = js_webcrypto_decrypt(&ciphertext_js, &key_js, &iv_js);
        let result = JsFuture::from(promise).await.map_err(|_| {
            JsValue::from_str("Decryption failed - message may have been tampered with")
        })?;

        // Convert result back to String
        let plaintext_js: Uint8Array = result.dyn_into()?;
        let plaintext = plaintext_js.to_vec();

        String::from_utf8(plaintext)
            .map_err(|_| JsValue::from_str("Invalid UTF-8 in decrypted data"))
    }

    // Note: Synchronous encrypt_message/decrypt_message have been removed.
    // Use encrypt_message_async/decrypt_message_async instead for real AES-256-GCM.

    /// Export key to JSON string
    /// Note: Password-protected export has been removed. Keys are serialized as JSON.
    pub fn export_key(&self, key_id: &str) -> Result<String, JsValue> {
        let key = self
            .keys
            .get(key_id)
            .ok_or_else(|| JsValue::from_str("Key not found"))?;

        serde_json::to_string(key).map_err(|_| JsValue::from_str("Key serialization failed"))
    }

    /// Import key from JSON string
    /// Note: Password-protected import has been removed.
    pub fn import_key(&mut self, exported_key: &str) -> Result<String, JsValue> {
        let key: EncryptionKey = serde_json::from_str(exported_key)
            .map_err(|_| JsValue::from_str("Key deserialization failed"))?;

        let key_id = key.id.clone();
        self.keys.insert(key_id.clone(), key);
        Ok(key_id)
    }

    #[allow(dead_code)]
    fn generate_random_key(&self, length: usize) -> Result<Vec<u8>, JsValue> {
        // Use Web Crypto API for secure random generation
        let bytes = js_webcrypto_random_bytes(length as u32);
        Ok(bytes.to_vec())
    }

    fn calculate_hash(&self, input: &str) -> String {
        use sha2::{Digest, Sha256};
        let mut hasher = Sha256::new();
        hasher.update(input.as_bytes());
        let result = hasher.finalize();
        hex::encode(result)
    }

    pub fn list_keys(&self) -> Vec<String> {
        self.keys.keys().cloned().collect()
    }

    pub fn delete_key(&mut self, key_id: &str) -> bool {
        if self.keys.remove(key_id).is_some() {
            if self.default_room_key.as_deref() == Some(key_id) {
                self.default_room_key = None;
            }
            if self.user_identity_key.as_deref() == Some(key_id) {
                self.user_identity_key = None;
            }
            true
        } else {
            false
        }
    }

    /// Save room encryption key to localStorage
    pub fn save_room_key_to_storage(&self, room_id: &str) -> Result<(), JsValue> {
        use web_sys::window;

        let window = window().ok_or_else(|| JsValue::from_str("No window object"))?;
        let storage = window
            .local_storage()
            .map_err(|_| JsValue::from_str("No localStorage"))?
            .ok_or_else(|| JsValue::from_str("localStorage not available"))?;

        let key_id = format!("room_key_{}", room_id);

        if let Some(key) = self.keys.get(&key_id) {
            let serialized = serde_json::to_string(key)
                .map_err(|e| JsValue::from_str(&format!("Key serialization error: {}", e)))?;

            let storage_key = format!("mindline_encryption_key_{}", room_id);
            storage
                .set_item(&storage_key, &serialized)
                .map_err(|_| JsValue::from_str("Failed to save key to localStorage"))?;
        }

        Ok(())
    }

    /// Load room encryption key from localStorage
    pub fn load_room_key_from_storage(&mut self, room_id: &str) -> Result<bool, JsValue> {
        use web_sys::window;

        let window = window().ok_or_else(|| JsValue::from_str("No window object"))?;
        let storage = window
            .local_storage()
            .map_err(|_| JsValue::from_str("No localStorage"))?
            .ok_or_else(|| JsValue::from_str("localStorage not available"))?;

        let storage_key = format!("mindline_encryption_key_{}", room_id);

        if let Ok(Some(stored_data)) = storage.get_item(&storage_key) {
            match serde_json::from_str::<EncryptionKey>(&stored_data) {
                Ok(key) => {
                    let key_id = key.id.clone();
                    self.keys.insert(key_id.clone(), key);
                    self.default_room_key = Some(key_id);
                    Ok(true)
                }
                Err(_) => {
                    // Clear corrupted key data
                    let _ = storage.remove_item(&storage_key);
                    Ok(false)
                }
            }
        } else {
            Ok(false)
        }
    }

    /// Check if room has a key in storage
    pub fn has_room_key_in_storage(&self, room_id: &str) -> Result<bool, JsValue> {
        use web_sys::window;

        let window = window().ok_or_else(|| JsValue::from_str("No window object"))?;
        let storage = window
            .local_storage()
            .map_err(|_| JsValue::from_str("No localStorage"))?
            .ok_or_else(|| JsValue::from_str("localStorage not available"))?;

        let storage_key = format!("mindline_encryption_key_{}", room_id);
        Ok(storage.get_item(&storage_key).ok().flatten().is_some())
    }

    /// Get room key ID if one exists
    pub fn get_room_key_id(&self, room_id: &str) -> Option<String> {
        let key_id = format!("room_key_{}", room_id);
        if self.keys.contains_key(&key_id) {
            Some(key_id)
        } else {
            None
        }
    }
}

// Global encryption manager
thread_local! {
    pub static ENCRYPTION_MANAGER: std::cell::RefCell<EncryptionManager> = std::cell::RefCell::new(EncryptionManager::new());
}

pub fn with_encryption_manager<F, R>(f: F) -> Result<R, JsValue>
where
    F: FnOnce(&mut EncryptionManager) -> R,
{
    ENCRYPTION_MANAGER.with(|manager| {
        let mut manager_ref = manager.borrow_mut();
        Ok(f(&mut manager_ref))
    })
}

/// Get key data for encryption/decryption operations
/// Returns (key_data, algorithm) or error if key not found
pub fn get_key_data(key_id: &str) -> Result<(Vec<u8>, String), JsValue> {
    ENCRYPTION_MANAGER.with(|manager| {
        let mgr = manager.borrow();
        match mgr.keys.get(key_id) {
            Some(key) => Ok((key.key_data.clone(), key.algorithm.clone())),
            None => Err(JsValue::from_str("Encryption key not found")),
        }
    })
}

/// Standalone async encryption function that takes owned data
/// This avoids borrow issues when called from WASM async context
pub async fn encrypt_with_key(
    message: String,
    key_data: Vec<u8>,
    key_id: String,
    algorithm: String,
) -> Result<EncryptedData, JsValue> {
    // Generate 12-byte nonce using Web Crypto
    let nonce_js = js_webcrypto_random_bytes(12);
    let nonce_data = nonce_js.to_vec();

    // Convert data to Uint8Array for JavaScript
    let plaintext_js = Uint8Array::from(message.as_bytes());
    let key_js = Uint8Array::from(key_data.as_slice());
    let iv_js = Uint8Array::from(nonce_data.as_slice());

    // Call Web Crypto API for real AES-256-GCM encryption
    let promise = js_webcrypto_encrypt(&plaintext_js, &key_js, &iv_js);
    let result = JsFuture::from(promise).await?;

    // Convert result back to Vec<u8>
    let ciphertext_js: Uint8Array = result.dyn_into()?;
    let ciphertext = ciphertext_js.to_vec();

    // Calculate integrity hash
    use sha2::{Digest, Sha256};
    let integrity_input = format!("{}:{}", hex::encode(&ciphertext), hex::encode(&nonce_data));
    let mut hasher = Sha256::new();
    hasher.update(integrity_input.as_bytes());
    let integrity_hash = hex::encode(hasher.finalize());

    Ok(EncryptedData {
        ciphertext,
        nonce: nonce_data,
        algorithm,
        key_id,
        timestamp: js_sys::Date::now() as u64,
        integrity_hash,
    })
}

/// Standalone async decryption function that takes owned data
/// This avoids borrow issues when called from WASM async context
pub async fn decrypt_with_key(
    encrypted_data: EncryptedData,
    key_data: Vec<u8>,
) -> Result<String, JsValue> {
    // Verify integrity hash first
    use sha2::{Digest, Sha256};
    let integrity_input = format!(
        "{}:{}",
        hex::encode(&encrypted_data.ciphertext),
        hex::encode(&encrypted_data.nonce)
    );
    let mut hasher = Sha256::new();
    hasher.update(integrity_input.as_bytes());
    let calculated_hash = hex::encode(hasher.finalize());

    if calculated_hash != encrypted_data.integrity_hash {
        return Err(JsValue::from_str("Integrity check failed"));
    }

    // Convert data to Uint8Array for JavaScript
    let ciphertext_js = Uint8Array::from(encrypted_data.ciphertext.as_slice());
    let key_js = Uint8Array::from(key_data.as_slice());
    let iv_js = Uint8Array::from(encrypted_data.nonce.as_slice());

    // Call Web Crypto API for real AES-256-GCM decryption
    let promise = js_webcrypto_decrypt(&ciphertext_js, &key_js, &iv_js);
    let result = JsFuture::from(promise).await.map_err(|_| {
        JsValue::from_str("Decryption failed - message may have been tampered with")
    })?;

    // Convert result back to String
    let plaintext_js: Uint8Array = result.dyn_into()?;
    let plaintext = plaintext_js.to_vec();

    String::from_utf8(plaintext).map_err(|_| JsValue::from_str("Invalid UTF-8 in decrypted data"))
}
