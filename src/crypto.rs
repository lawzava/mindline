// src/crypto.rs - Enhanced encryption system for Phase 6

use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;
use std::collections::HashMap;

use crate::console_log;

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
        let key_data = self.generate_random_key(32)?;

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

        console_log!("Generated room key for room: {}", room_id);
        Ok(key_id)
    }

    pub fn generate_user_identity_key(&mut self, user_id: &str, password: Option<&str>) -> Result<String, JsValue> {
        let key_id = format!("user_identity_{}", user_id);

        let key_data = if let Some(password) = password {
            // For WASM compatibility, we'll use a simpler key derivation
            self.derive_key_from_password(password, user_id.as_bytes())?
        } else {
            self.generate_random_key(32)?
        };

        let encryption_key = EncryptionKey {
            id: key_id.clone(),
            key_data,
            algorithm: "AES-256-GCM".to_string(),
            created_at: js_sys::Date::now() as u64,
            expires_at: None,
            usage: KeyUsage::UserIdentity,
        };

        self.keys.insert(key_id.clone(), encryption_key);
        self.user_identity_key = Some(key_id.clone());

        console_log!("Generated user identity key for user: {}", user_id);
        Ok(key_id)
    }

    pub fn encrypt_message(&self, message: &str, key_id: Option<&str>) -> Result<EncryptedData, JsValue> {
        let key_id = key_id
            .or(self.default_room_key.as_deref())
            .ok_or_else(|| JsValue::from_str("No encryption key specified or available"))?;

        let key = self.keys.get(key_id)
            .ok_or_else(|| JsValue::from_str("Encryption key not found"))?;

        // Generate nonce
        let nonce_data = self.generate_random_key(12)?;

        // For WASM compatibility, we'll use XOR encryption as a placeholder
        // In production, you'd use the Web Crypto API via JS interop
        let ciphertext = self.simple_xor_encrypt(message.as_bytes(), &key.key_data, &nonce_data);

        // Calculate integrity hash
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

    pub fn decrypt_message(&self, encrypted_data: &EncryptedData) -> Result<String, JsValue> {
        // Verify integrity
        let integrity_input = format!("{}:{}", hex::encode(&encrypted_data.ciphertext), hex::encode(&encrypted_data.nonce));
        let calculated_hash = self.calculate_hash(&integrity_input);

        if calculated_hash != encrypted_data.integrity_hash {
            return Err(JsValue::from_str("Integrity check failed"));
        }

        let key = self.keys.get(&encrypted_data.key_id)
            .ok_or_else(|| JsValue::from_str("Decryption key not found"))?;

        // Decrypt using simple XOR (placeholder for WASM compatibility)
        let plaintext = self.simple_xor_decrypt(&encrypted_data.ciphertext, &key.key_data, &encrypted_data.nonce);

        String::from_utf8(plaintext)
            .map_err(|_| JsValue::from_str("Invalid UTF-8 in decrypted data"))
    }

    pub fn export_key(&self, key_id: &str, password: Option<&str>) -> Result<String, JsValue> {
        let key = self.keys.get(key_id)
            .ok_or_else(|| JsValue::from_str("Key not found"))?;

        if let Some(password) = password {
            // Encrypt key with password
            let derived_key = self.derive_key_from_password(password, key_id.as_bytes())?;
            let nonce_data = self.generate_random_key(12)?;

            let encrypted_key = self.simple_xor_encrypt(&key.key_data, &derived_key, &nonce_data);

            let export_data = serde_json::json!({
                "encrypted_key": hex::encode(encrypted_key),
                "nonce": hex::encode(nonce_data),
                "key_info": {
                    "id": key.id,
                    "algorithm": key.algorithm,
                    "created_at": key.created_at,
                    "usage": key.usage
                }
            });

            Ok(export_data.to_string())
        } else {
            serde_json::to_string(key)
                .map_err(|_| JsValue::from_str("Key serialization failed"))
        }
    }

    pub fn import_key(&mut self, exported_key: &str, password: Option<&str>) -> Result<String, JsValue> {
        if let Some(password) = password {
            let export_data: serde_json::Value = serde_json::from_str(exported_key)
                .map_err(|_| JsValue::from_str("Invalid export format"))?;

            let encrypted_key = hex::decode(export_data["encrypted_key"].as_str()
                .ok_or_else(|| JsValue::from_str("Missing encrypted_key"))?)
                .map_err(|_| JsValue::from_str("Invalid encrypted_key format"))?;

            let nonce_data = hex::decode(export_data["nonce"].as_str()
                .ok_or_else(|| JsValue::from_str("Missing nonce"))?)
                .map_err(|_| JsValue::from_str("Invalid nonce format"))?;

            let key_info = &export_data["key_info"];
            let key_id = key_info["id"].as_str()
                .ok_or_else(|| JsValue::from_str("Missing key ID"))?;

            let derived_key = self.derive_key_from_password(password, key_id.as_bytes())?;
            let decrypted_key_data = self.simple_xor_decrypt(&encrypted_key, &derived_key, &nonce_data);

            let encryption_key = EncryptionKey {
                id: key_id.to_string(),
                key_data: decrypted_key_data,
                algorithm: key_info["algorithm"].as_str().unwrap_or("AES-256-GCM").to_string(),
                created_at: key_info["created_at"].as_u64().unwrap_or(js_sys::Date::now() as u64),
                expires_at: None,
                usage: serde_json::from_value(key_info["usage"].clone()).unwrap_or(KeyUsage::MessageEncryption),
            };

            self.keys.insert(key_id.to_string(), encryption_key);
            Ok(key_id.to_string())
        } else {
            let key: EncryptionKey = serde_json::from_str(exported_key)
                .map_err(|_| JsValue::from_str("Key deserialization failed"))?;

            let key_id = key.id.clone();
            self.keys.insert(key_id.clone(), key);
            Ok(key_id)
        }
    }

    fn generate_random_key(&self, length: usize) -> Result<Vec<u8>, JsValue> {
        // Use getrandom which is already a dependency and works with WASM
        let mut key = vec![0u8; length];
        getrandom::getrandom(&mut key)
            .map_err(|_| JsValue::from_str("Failed to generate random bytes"))?;
        Ok(key)
    }

    fn derive_key_from_password(&self, password: &str, salt: &[u8]) -> Result<Vec<u8>, JsValue> {
        // Simple key derivation for WASM compatibility
        // In production, use Web Crypto API via JS interop for proper PBKDF2
        use sha2::{Sha256, Digest};

        let mut hasher = Sha256::new();
        hasher.update(password.as_bytes());
        hasher.update(salt);

        // Simple iteration for key strengthening
        let mut key = hasher.finalize().to_vec();
        for _ in 0..1000 {
            let mut hasher = Sha256::new();
            hasher.update(&key);
            hasher.update(salt);
            key = hasher.finalize().to_vec();
        }

        Ok(key)
    }

    fn calculate_hash(&self, input: &str) -> String {
        use sha2::{Sha256, Digest};
        let mut hasher = Sha256::new();
        hasher.update(input.as_bytes());
        let result = hasher.finalize();
        hex::encode(result)
    }

    // Simple XOR encryption for WASM compatibility (placeholder)
    fn simple_xor_encrypt(&self, plaintext: &[u8], key: &[u8], nonce: &[u8]) -> Vec<u8> {
        let mut ciphertext = Vec::new();
        let key_nonce: Vec<u8> = key.iter().chain(nonce.iter()).cloned().collect();

        for (i, byte) in plaintext.iter().enumerate() {
            let key_byte = key_nonce[i % key_nonce.len()];
            ciphertext.push(byte ^ key_byte);
        }

        ciphertext
    }

    fn simple_xor_decrypt(&self, ciphertext: &[u8], key: &[u8], nonce: &[u8]) -> Vec<u8> {
        // XOR encryption is symmetric
        self.simple_xor_encrypt(ciphertext, key, nonce)
    }

    pub fn get_key_info(&self, key_id: &str) -> Option<&EncryptionKey> {
        self.keys.get(key_id)
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
}

// Global encryption manager
thread_local! {
    static ENCRYPTION_MANAGER: std::cell::RefCell<EncryptionManager> = std::cell::RefCell::new(EncryptionManager::new());
}

pub fn with_encryption_manager<F, R>(f: F) -> Result<R, JsValue>
where
    F: FnOnce(&mut EncryptionManager) -> R,
{
    ENCRYPTION_MANAGER.with(|manager| {
        let mut manager_ref = manager.borrow_mut();
        Ok(f(&mut *manager_ref))
    })
}