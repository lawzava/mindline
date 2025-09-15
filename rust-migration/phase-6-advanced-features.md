# Phase 6: Advanced Features and Optimizations

## Overview
Implement advanced features that are uniquely enabled by Rust/WASM, including enhanced encryption, IndexedDB persistence, performance monitoring, and new capabilities that would be difficult or impossible to implement efficiently in JavaScript alone.

## Goals
- **Enhanced Security**: Advanced encryption and cryptographic operations
- **Persistent Storage**: Efficient IndexedDB integration for message persistence
- **Performance Monitoring**: Real-time performance metrics and profiling
- **Advanced Networking**: Message compression, routing optimization
- **Future-Ready Architecture**: Foundation for desktop/server deployment

## Implementation Plan

### 6.1 Enhanced Encryption System

```rust
// Create src/crypto.rs

use aes_gcm::{Aes256Gcm, Key, Nonce, aead::{Aead, NewAead}};
use argon2::{Argon2, password_hash::{PasswordHasher, SaltString}};
use rand::rngs::OsRng;
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;
use ring::{digest, pbkdf2, rand};
use std::collections::HashMap;

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
            // Derive key from password using Argon2
            self.derive_key_from_password(password, user_id.as_bytes())?
        } else {
            // Generate random key
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

        let cipher = Aes256Gcm::new(Key::from_slice(&key.key_data));
        let nonce_data = self.generate_random_key(12)?; // 96-bit nonce for GCM
        let nonce = Nonce::from_slice(&nonce_data);

        let ciphertext = cipher.encrypt(nonce, message.as_bytes())
            .map_err(|_| JsValue::from_str("Encryption failed"))?;

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

        let cipher = Aes256Gcm::new(Key::from_slice(&key.key_data));
        let nonce = Nonce::from_slice(&encrypted_data.nonce);

        let plaintext = cipher.decrypt(nonce, encrypted_data.ciphertext.as_ref())
            .map_err(|_| JsValue::from_str("Decryption failed"))?;

        String::from_utf8(plaintext)
            .map_err(|_| JsValue::from_str("Invalid UTF-8 in decrypted data"))
    }

    pub fn export_key(&self, key_id: &str, password: Option<&str>) -> Result<String, JsValue> {
        let key = self.keys.get(key_id)
            .ok_or_else(|| JsValue::from_str("Key not found"))?;

        if let Some(password) = password {
            // Encrypt key with password
            let derived_key = self.derive_key_from_password(password, key_id.as_bytes())?;
            let cipher = Aes256Gcm::new(Key::from_slice(&derived_key));
            let nonce_data = self.generate_random_key(12)?;
            let nonce = Nonce::from_slice(&nonce_data);

            let encrypted_key = cipher.encrypt(nonce, &key.key_data)
                .map_err(|_| JsValue::from_str("Key encryption failed"))?;

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
            // Export in plain format (should be used carefully)
            serde_json::to_string(key)
                .map_err(|_| JsValue::from_str("Key serialization failed"))
        }
    }

    pub fn import_key(&mut self, exported_key: &str, password: Option<&str>) -> Result<String, JsValue> {
        if let Some(password) = password {
            // Decrypt encrypted key
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
            let cipher = Aes256Gcm::new(Key::from_slice(&derived_key));
            let nonce = Nonce::from_slice(&nonce_data);

            let decrypted_key_data = cipher.decrypt(nonce, encrypted_key.as_ref())
                .map_err(|_| JsValue::from_str("Key decryption failed"))?;

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
            // Import plain key
            let key: EncryptionKey = serde_json::from_str(exported_key)
                .map_err(|_| JsValue::from_str("Key deserialization failed"))?;

            let key_id = key.id.clone();
            self.keys.insert(key_id.clone(), key);
            Ok(key_id)
        }
    }

    fn generate_random_key(&self, length: usize) -> Result<Vec<u8>, JsValue> {
        let mut key = vec![0u8; length];
        let window = web_sys::window().ok_or_else(|| JsValue::from_str("No window object"))?;
        let crypto = window.crypto().map_err(|_| JsValue::from_str("No crypto object"))?;

        crypto.get_random_values_with_u8_array(&mut key)
            .map_err(|_| JsValue::from_str("Failed to generate random bytes"))?;

        Ok(key)
    }

    fn derive_key_from_password(&self, password: &str, salt: &[u8]) -> Result<Vec<u8>, JsValue> {
        let salt_string = SaltString::encode_b64(salt)
            .map_err(|_| JsValue::from_str("Salt encoding failed"))?;

        let argon2 = Argon2::default();
        let password_hash = argon2.hash_password(password.as_bytes(), &salt_string)
            .map_err(|_| JsValue::from_str("Password hashing failed"))?;

        // Extract the hash bytes (32 bytes for AES-256)
        let hash_string = password_hash.hash.ok_or_else(|| JsValue::from_str("No hash generated"))?;
        let hash_bytes = hash_string.as_bytes();

        if hash_bytes.len() >= 32 {
            Ok(hash_bytes[..32].to_vec())
        } else {
            Err(JsValue::from_str("Generated hash too short"))
        }
    }

    fn calculate_hash(&self, input: &str) -> String {
        let digest = digest::digest(&digest::SHA256, input.as_bytes());
        hex::encode(digest.as_ref())
    }

    pub fn get_key_info(&self, key_id: &str) -> Option<&EncryptionKey> {
        self.keys.get(key_id)
    }

    pub fn list_keys(&self) -> Vec<String> {
        self.keys.keys().cloned().collect()
    }

    pub fn delete_key(&mut self, key_id: &str) -> bool {
        if self.keys.remove(key_id).is_some() {
            // Clear references if this was a default key
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

fn with_encryption_manager<F, R>(f: F) -> Result<R, JsValue>
where
    F: FnOnce(&mut EncryptionManager) -> R,
{
    ENCRYPTION_MANAGER.with(|manager| {
        let mut manager_ref = manager.borrow_mut();
        Ok(f(&mut *manager_ref))
    })
}
```

### 6.2 IndexedDB Persistence System

```rust
// Create src/storage.rs

use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::JsFuture;
use web_sys::{IdbFactory, IdbDatabase, IdbObjectStore, IdbTransaction, IdbRequest};
use std::collections::HashMap;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct StoredMessage {
    pub id: String,
    pub room_id: String,
    pub content: String,
    pub timestamp: u64,
    pub sender_id: String,
    pub sender_name: String,
    pub encrypted: bool,
    pub message_type: String,
    pub metadata: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct StoredRoom {
    pub id: String,
    pub name: String,
    pub created_at: u64,
    pub last_activity: u64,
    pub message_count: u32,
    pub encryption_enabled: bool,
    pub key_id: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct StorageConfig {
    pub database_name: String,
    pub version: u32,
    pub max_messages_per_room: u32,
    pub auto_cleanup_days: u32,
    pub compression_enabled: bool,
}

pub struct IndexedDBManager {
    config: StorageConfig,
    db: Option<IdbDatabase>,
}

impl IndexedDBManager {
    pub fn new(config: StorageConfig) -> Self {
        Self {
            config,
            db: None,
        }
    }

    pub async fn initialize(&mut self) -> Result<(), JsValue> {
        let window = web_sys::window().ok_or_else(|| JsValue::from_str("No window object"))?;
        let idb_factory = window.indexed_db()
            .map_err(|_| JsValue::from_str("IndexedDB not supported"))?
            .ok_or_else(|| JsValue::from_str("IndexedDB not available"))?;

        let open_request = idb_factory.open_with_u32(&self.config.database_name, self.config.version)
            .map_err(|_| JsValue::from_str("Failed to open database"))?;

        // Set up upgrade handler
        let upgrade_handler = Closure::wrap(Box::new(move |event: web_sys::Event| {
            let target = event.target().unwrap();
            let request: IdbRequest = target.dyn_into().unwrap();
            let db: IdbDatabase = request.result().unwrap().dyn_into().unwrap();

            // Create object stores
            if !db.object_store_names().contains("messages") {
                let messages_store = db.create_object_store("messages").unwrap();
                messages_store.create_index("room_id", &"room_id".into()).unwrap();
                messages_store.create_index("timestamp", &"timestamp".into()).unwrap();
            }

            if !db.object_store_names().contains("rooms") {
                db.create_object_store("rooms").unwrap();
            }

            if !db.object_store_names().contains("keys") {
                db.create_object_store("keys").unwrap();
            }

            if !db.object_store_names().contains("metadata") {
                db.create_object_store("metadata").unwrap();
            }
        }) as Box<dyn FnMut(_)>);

        open_request.set_onupgradeneeded(Some(upgrade_handler.as_ref().unchecked_ref()));
        upgrade_handler.forget();

        let db_future = JsFuture::from(open_request);
        let db_result = db_future.await?;
        self.db = Some(db_result.dyn_into()?);

        console_log!("IndexedDB initialized: {}", self.config.database_name);
        Ok(())
    }

    pub async fn store_message(&self, message: &StoredMessage) -> Result<(), JsValue> {
        let db = self.db.as_ref().ok_or_else(|| JsValue::from_str("Database not initialized"))?;

        let transaction = db.transaction_with_str_and_mode("messages", web_sys::IdbTransactionMode::Readwrite)
            .map_err(|_| JsValue::from_str("Failed to create transaction"))?;

        let store = transaction.object_store("messages")
            .map_err(|_| JsValue::from_str("Failed to get object store"))?;

        let message_value = serde_wasm_bindgen::to_value(message)?;
        let add_request = store.put_with_key(&message_value, &message.id.clone().into())
            .map_err(|_| JsValue::from_str("Failed to store message"))?;

        JsFuture::from(add_request).await?;

        // Update room statistics
        self.update_room_stats(&message.room_id, 1).await?;

        console_log!("Message stored: {}", message.id);
        Ok(())
    }

    pub async fn get_messages(&self, room_id: &str, limit: Option<u32>, before_timestamp: Option<u64>) -> Result<Vec<StoredMessage>, JsValue> {
        let db = self.db.as_ref().ok_or_else(|| JsValue::from_str("Database not initialized"))?;

        let transaction = db.transaction_with_str("messages")
            .map_err(|_| JsValue::from_str("Failed to create transaction"))?;

        let store = transaction.object_store("messages")
            .map_err(|_| JsValue::from_str("Failed to get object store"))?;

        let index = store.index("room_id")
            .map_err(|_| JsValue::from_str("Failed to get index"))?;

        let range = web_sys::IdbKeyRange::only(&room_id.into())
            .map_err(|_| JsValue::from_str("Failed to create key range"))?;

        let cursor_request = index.open_cursor_with_range(&range)
            .map_err(|_| JsValue::from_str("Failed to open cursor"))?;

        let mut messages = Vec::new();
        let limit = limit.unwrap_or(50) as usize;

        // This is a simplified version - in practice, you'd use proper cursor iteration
        let cursor_future = JsFuture::from(cursor_request);
        let cursor_result = cursor_future.await?;

        if !cursor_result.is_null() {
            // Process cursor results
            // (Implementation details depend on specific cursor handling)
        }

        // Sort by timestamp and apply limits
        messages.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));

        if let Some(before) = before_timestamp {
            messages.retain(|msg| msg.timestamp < before);
        }

        messages.truncate(limit);
        Ok(messages)
    }

    pub async fn store_room(&self, room: &StoredRoom) -> Result<(), JsValue> {
        let db = self.db.as_ref().ok_or_else(|| JsValue::from_str("Database not initialized"))?;

        let transaction = db.transaction_with_str_and_mode("rooms", web_sys::IdbTransactionMode::Readwrite)
            .map_err(|_| JsValue::from_str("Failed to create transaction"))?;

        let store = transaction.object_store("rooms")
            .map_err(|_| JsValue::from_str("Failed to get object store"))?;

        let room_value = serde_wasm_bindgen::to_value(room)?;
        let add_request = store.put_with_key(&room_value, &room.id.clone().into())
            .map_err(|_| JsValue::from_str("Failed to store room"))?;

        JsFuture::from(add_request).await?;

        console_log!("Room stored: {}", room.id);
        Ok(())
    }

    pub async fn get_room(&self, room_id: &str) -> Result<Option<StoredRoom>, JsValue> {
        let db = self.db.as_ref().ok_or_else(|| JsValue::from_str("Database not initialized"))?;

        let transaction = db.transaction_with_str("rooms")
            .map_err(|_| JsValue::from_str("Failed to create transaction"))?;

        let store = transaction.object_store("rooms")
            .map_err(|_| JsValue::from_str("Failed to get object store"))?;

        let get_request = store.get(&room_id.into())
            .map_err(|_| JsValue::from_str("Failed to get room"))?;

        let result = JsFuture::from(get_request).await?;

        if result.is_null() || result.is_undefined() {
            Ok(None)
        } else {
            let room: StoredRoom = serde_wasm_bindgen::from_value(result)?;
            Ok(Some(room))
        }
    }

    pub async fn list_rooms(&self) -> Result<Vec<StoredRoom>, JsValue> {
        let db = self.db.as_ref().ok_or_else(|| JsValue::from_str("Database not initialized"))?;

        let transaction = db.transaction_with_str("rooms")
            .map_err(|_| JsValue::from_str("Failed to create transaction"))?;

        let store = transaction.object_store("rooms")
            .map_err(|_| JsValue::from_str("Failed to get object store"))?;

        let cursor_request = store.open_cursor()
            .map_err(|_| JsValue::from_str("Failed to open cursor"))?;

        let mut rooms = Vec::new();

        // Simplified cursor handling - in practice, you'd iterate through all results
        let cursor_future = JsFuture::from(cursor_request);
        let _cursor_result = cursor_future.await?;

        // Sort by last activity
        rooms.sort_by(|a, b| b.last_activity.cmp(&a.last_activity));

        Ok(rooms)
    }

    pub async fn delete_room(&self, room_id: &str) -> Result<(), JsValue> {
        let db = self.db.as_ref().ok_or_else(|| JsValue::from_str("Database not initialized"))?;

        // Delete room data
        let room_transaction = db.transaction_with_str_and_mode("rooms", web_sys::IdbTransactionMode::Readwrite)
            .map_err(|_| JsValue::from_str("Failed to create transaction"))?;

        let room_store = room_transaction.object_store("rooms")
            .map_err(|_| JsValue::from_str("Failed to get object store"))?;

        let delete_request = room_store.delete(&room_id.into())
            .map_err(|_| JsValue::from_str("Failed to delete room"))?;

        JsFuture::from(delete_request).await?;

        // Delete associated messages
        self.delete_room_messages(room_id).await?;

        console_log!("Room deleted: {}", room_id);
        Ok(())
    }

    async fn delete_room_messages(&self, room_id: &str) -> Result<(), JsValue> {
        let db = self.db.as_ref().ok_or_else(|| JsValue::from_str("Database not initialized"))?;

        let transaction = db.transaction_with_str_and_mode("messages", web_sys::IdbTransactionMode::Readwrite)
            .map_err(|_| JsValue::from_str("Failed to create transaction"))?;

        let store = transaction.object_store("messages")
            .map_err(|_| JsValue::from_str("Failed to get object store"))?;

        let index = store.index("room_id")
            .map_err(|_| JsValue::from_str("Failed to get index"))?;

        let range = web_sys::IdbKeyRange::only(&room_id.into())
            .map_err(|_| JsValue::from_str("Failed to create key range"))?;

        let cursor_request = index.open_cursor_with_range(&range)
            .map_err(|_| JsValue::from_str("Failed to open cursor"))?;

        // Delete all messages for this room
        // (Simplified - in practice, you'd iterate through cursor and delete each message)

        Ok(())
    }

    async fn update_room_stats(&self, room_id: &str, message_increment: u32) -> Result<(), JsValue> {
        if let Some(mut room) = self.get_room(room_id).await? {
            room.message_count += message_increment;
            room.last_activity = js_sys::Date::now() as u64;
            self.store_room(&room).await?;
        }
        Ok(())
    }

    pub async fn cleanup_old_data(&self, days_old: u32) -> Result<u32, JsValue> {
        let cutoff_time = (js_sys::Date::now() as u64).saturating_sub(days_old as u64 * 24 * 60 * 60 * 1000);
        let mut deleted_count = 0;

        // Clean up old messages
        // (Implementation would iterate through messages and delete old ones)

        console_log!("Cleaned up {} old records", deleted_count);
        Ok(deleted_count)
    }

    pub async fn export_room_data(&self, room_id: &str) -> Result<String, JsValue> {
        let room = self.get_room(room_id).await?;
        let messages = self.get_messages(room_id, None, None).await?;

        let export_data = serde_json::json!({
            "room": room,
            "messages": messages,
            "exported_at": js_sys::Date::now() as u64,
            "version": "1.0"
        });

        Ok(export_data.to_string())
    }

    pub async fn import_room_data(&self, import_data: &str) -> Result<String, JsValue> {
        let data: serde_json::Value = serde_json::from_str(import_data)
            .map_err(|_| JsValue::from_str("Invalid import data format"))?;

        if let Some(room_data) = data.get("room") {
            let room: StoredRoom = serde_json::from_value(room_data.clone())
                .map_err(|_| JsValue::from_str("Invalid room data"))?;
            self.store_room(&room).await?;

            if let Some(messages_data) = data.get("messages") {
                let messages: Vec<StoredMessage> = serde_json::from_value(messages_data.clone())
                    .map_err(|_| JsValue::from_str("Invalid messages data"))?;

                for message in messages {
                    self.store_message(&message).await?;
                }
            }

            Ok(room.id)
        } else {
            Err(JsValue::from_str("No room data found in import"))
        }
    }

    pub async fn get_storage_usage(&self) -> Result<StorageUsage, JsValue> {
        // Get storage statistics
        let total_messages = self.count_messages().await?;
        let total_rooms = self.count_rooms().await?;

        Ok(StorageUsage {
            total_messages,
            total_rooms,
            database_size_mb: 0.0, // Would calculate actual size
            last_cleanup: 0, // Would track last cleanup time
        })
    }

    async fn count_messages(&self) -> Result<u32, JsValue> {
        // Implementation would count total messages
        Ok(0)
    }

    async fn count_rooms(&self) -> Result<u32, JsValue> {
        // Implementation would count total rooms
        Ok(0)
    }
}

#[derive(Serialize, Deserialize, Debug)]
pub struct StorageUsage {
    pub total_messages: u32,
    pub total_rooms: u32,
    pub database_size_mb: f64,
    pub last_cleanup: u64,
}

// Global storage manager
thread_local! {
    static STORAGE_MANAGER: std::cell::RefCell<Option<IndexedDBManager>> = std::cell::RefCell::new(None);
}

async fn with_storage_manager<F, R>(f: F) -> Result<R, JsValue>
where
    F: FnOnce(&IndexedDBManager) -> R,
{
    STORAGE_MANAGER.with(|manager| {
        let manager_ref = manager.borrow();
        if let Some(ref storage) = *manager_ref {
            Ok(f(storage))
        } else {
            Err(JsValue::from_str("Storage manager not initialized"))
        }
    })
}
```

### 6.3 Performance Monitoring System

```rust
// Create src/performance.rs

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use wasm_bindgen::prelude::*;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PerformanceMetric {
    pub id: String,
    pub name: String,
    pub value: f64,
    pub unit: String,
    pub timestamp: u64,
    pub category: MetricCategory,
    pub tags: HashMap<String, String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub enum MetricCategory {
    Memory,
    Network,
    Rendering,
    Computation,
    Storage,
    P2P,
    WASM,
    Custom,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PerformanceSample {
    pub timestamp: u64,
    pub memory_usage_mb: f64,
    pub wasm_memory_mb: f64,
    pub message_processing_time_ms: f64,
    pub p2p_latency_ms: f64,
    pub active_connections: u32,
    pub messages_per_second: f64,
    pub frame_rate: f64,
    pub cpu_usage_percent: f64,
}

pub struct PerformanceMonitor {
    metrics: VecDeque<PerformanceMetric>,
    samples: VecDeque<PerformanceSample>,
    max_metrics: usize,
    max_samples: usize,
    collection_interval: u64,
    last_collection: u64,
    timers: HashMap<String, u64>,
    counters: HashMap<String, u64>,
}

impl PerformanceMonitor {
    pub fn new(max_metrics: usize, max_samples: usize) -> Self {
        Self {
            metrics: VecDeque::new(),
            samples: VecDeque::new(),
            max_metrics,
            max_samples,
            collection_interval: 1000, // 1 second
            last_collection: 0,
            timers: HashMap::new(),
            counters: HashMap::new(),
        }
    }

    pub fn start_timer(&mut self, name: &str) {
        let start_time = self.get_high_precision_time();
        self.timers.insert(name.to_string(), start_time);
    }

    pub fn end_timer(&mut self, name: &str) -> Option<f64> {
        if let Some(start_time) = self.timers.remove(name) {
            let duration = self.get_high_precision_time() - start_time;
            self.record_metric(name, duration, "ms", MetricCategory::Computation);
            Some(duration)
        } else {
            None
        }
    }

    pub fn record_metric(&mut self, name: &str, value: f64, unit: &str, category: MetricCategory) {
        let metric = PerformanceMetric {
            id: format!("{}_{}", name, self.get_high_precision_time() as u64),
            name: name.to_string(),
            value,
            unit: unit.to_string(),
            timestamp: js_sys::Date::now() as u64,
            category,
            tags: HashMap::new(),
        };

        self.add_metric(metric);
    }

    pub fn record_metric_with_tags(&mut self, name: &str, value: f64, unit: &str, category: MetricCategory, tags: HashMap<String, String>) {
        let metric = PerformanceMetric {
            id: format!("{}_{}", name, self.get_high_precision_time() as u64),
            name: name.to_string(),
            value,
            unit: unit.to_string(),
            timestamp: js_sys::Date::now() as u64,
            category,
            tags,
        };

        self.add_metric(metric);
    }

    pub fn increment_counter(&mut self, name: &str) {
        let count = self.counters.entry(name.to_string()).or_insert(0);
        *count += 1;
    }

    pub fn get_counter(&self, name: &str) -> u64 {
        self.counters.get(name).copied().unwrap_or(0)
    }

    pub fn collect_system_metrics(&mut self) {
        let now = js_sys::Date::now() as u64;

        if now - self.last_collection < self.collection_interval {
            return;
        }

        self.last_collection = now;

        // Collect memory metrics
        if let Ok(memory) = self.get_memory_info() {
            self.record_metric("js_heap_used", memory.used_js_heap_size as f64 / 1024.0 / 1024.0, "MB", MetricCategory::Memory);
            self.record_metric("js_heap_total", memory.total_js_heap_size as f64 / 1024.0 / 1024.0, "MB", MetricCategory::Memory);
            self.record_metric("js_heap_limit", memory.js_heap_size_limit as f64 / 1024.0 / 1024.0, "MB", MetricCategory::Memory);
        }

        // Collect WASM memory metrics
        if let Ok(wasm_memory) = self.get_wasm_memory_usage() {
            self.record_metric("wasm_memory", wasm_memory, "MB", MetricCategory::WASM);
        }

        // Collect performance timing metrics
        if let Ok(timing) = self.get_performance_timing() {
            self.record_metric("dom_loading_time", timing.dom_loading_time, "ms", MetricCategory::Rendering);
            self.record_metric("dom_interactive_time", timing.dom_interactive_time, "ms", MetricCategory::Rendering);
        }

        // Create performance sample
        let sample = PerformanceSample {
            timestamp: now,
            memory_usage_mb: self.get_memory_info().map(|m| m.used_js_heap_size as f64 / 1024.0 / 1024.0).unwrap_or(0.0),
            wasm_memory_mb: self.get_wasm_memory_usage().unwrap_or(0.0),
            message_processing_time_ms: self.get_average_metric("message_processing_time", 10000).unwrap_or(0.0), // Last 10 seconds
            p2p_latency_ms: self.get_average_metric("p2p_latency", 30000).unwrap_or(0.0), // Last 30 seconds
            active_connections: self.get_counter("active_connections") as u32,
            messages_per_second: self.calculate_messages_per_second(),
            frame_rate: self.estimate_frame_rate(),
            cpu_usage_percent: self.estimate_cpu_usage(),
        };

        self.add_sample(sample);
    }

    fn add_metric(&mut self, metric: PerformanceMetric) {
        self.metrics.push_back(metric);

        while self.metrics.len() > self.max_metrics {
            self.metrics.pop_front();
        }
    }

    fn add_sample(&mut self, sample: PerformanceSample) {
        self.samples.push_back(sample);

        while self.samples.len() > self.max_samples {
            self.samples.pop_front();
        }
    }

    pub fn get_metrics(&self, category: Option<MetricCategory>, limit: Option<usize>) -> Vec<PerformanceMetric> {
        let mut metrics: Vec<PerformanceMetric> = if let Some(cat) = category {
            self.metrics.iter().filter(|m| m.category == cat).cloned().collect()
        } else {
            self.metrics.iter().cloned().collect()
        };

        metrics.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));

        if let Some(limit) = limit {
            metrics.truncate(limit);
        }

        metrics
    }

    pub fn get_samples(&self, limit: Option<usize>) -> Vec<PerformanceSample> {
        let mut samples: Vec<PerformanceSample> = self.samples.iter().cloned().collect();
        samples.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));

        if let Some(limit) = limit {
            samples.truncate(limit);
        }

        samples
    }

    pub fn get_average_metric(&self, name: &str, time_window_ms: u64) -> Option<f64> {
        let cutoff_time = (js_sys::Date::now() as u64).saturating_sub(time_window_ms);

        let values: Vec<f64> = self.metrics
            .iter()
            .filter(|m| m.name == name && m.timestamp >= cutoff_time)
            .map(|m| m.value)
            .collect();

        if values.is_empty() {
            None
        } else {
            Some(values.iter().sum::<f64>() / values.len() as f64)
        }
    }

    pub fn get_performance_summary(&self) -> PerformanceSummary {
        let recent_sample = self.samples.back().cloned();

        PerformanceSummary {
            current_memory_mb: recent_sample.as_ref().map(|s| s.memory_usage_mb).unwrap_or(0.0),
            current_wasm_memory_mb: recent_sample.as_ref().map(|s| s.wasm_memory_mb).unwrap_or(0.0),
            average_message_time_ms: self.get_average_metric("message_processing_time", 60000).unwrap_or(0.0),
            average_p2p_latency_ms: self.get_average_metric("p2p_latency", 60000).unwrap_or(0.0),
            total_messages_processed: self.get_counter("messages_processed"),
            active_connections: recent_sample.as_ref().map(|s| s.active_connections).unwrap_or(0),
            current_frame_rate: recent_sample.as_ref().map(|s| s.frame_rate).unwrap_or(0.0),
            cpu_usage_percent: recent_sample.as_ref().map(|s| s.cpu_usage_percent).unwrap_or(0.0),
            uptime_seconds: self.calculate_uptime(),
        }
    }

    // Helper methods for system metrics collection
    fn get_memory_info(&self) -> Result<MemoryInfo, JsValue> {
        let window = web_sys::window().ok_or_else(|| JsValue::from_str("No window object"))?;
        let performance = window.performance().ok_or_else(|| JsValue::from_str("No performance object"))?;

        // Try to get memory info (only available in some browsers)
        if let Ok(memory) = js_sys::Reflect::get(&performance, &"memory".into()) {
            if !memory.is_undefined() {
                let used_heap = js_sys::Reflect::get(&memory, &"usedJSHeapSize".into()).unwrap_or(JsValue::from(0));
                let total_heap = js_sys::Reflect::get(&memory, &"totalJSHeapSize".into()).unwrap_or(JsValue::from(0));
                let heap_limit = js_sys::Reflect::get(&memory, &"jsHeapSizeLimit".into()).unwrap_or(JsValue::from(0));

                return Ok(MemoryInfo {
                    used_js_heap_size: used_heap.as_f64().unwrap_or(0.0) as u64,
                    total_js_heap_size: total_heap.as_f64().unwrap_or(0.0) as u64,
                    js_heap_size_limit: heap_limit.as_f64().unwrap_or(0.0) as u64,
                });
            }
        }

        Err(JsValue::from_str("Memory info not available"))
    }

    fn get_wasm_memory_usage(&self) -> Result<f64, JsValue> {
        // This would require access to the WASM memory object
        // Implementation depends on how WASM module exposes memory info
        Ok(0.0)
    }

    fn get_performance_timing(&self) -> Result<PerformanceTiming, JsValue> {
        let window = web_sys::window().ok_or_else(|| JsValue::from_str("No window object"))?;
        let performance = window.performance().ok_or_else(|| JsValue::from_str("No performance object"))?;

        let timing = performance.timing();

        Ok(PerformanceTiming {
            dom_loading_time: (timing.dom_loading() - timing.navigation_start()) as f64,
            dom_interactive_time: (timing.dom_interactive() - timing.navigation_start()) as f64,
            dom_complete_time: (timing.dom_complete() - timing.navigation_start()) as f64,
        })
    }

    fn get_high_precision_time(&self) -> f64 {
        if let Some(window) = web_sys::window() {
            if let Some(performance) = window.performance() {
                return performance.now();
            }
        }
        js_sys::Date::now()
    }

    fn calculate_messages_per_second(&self) -> f64 {
        // Calculate based on recent message processing metrics
        let recent_messages = self.get_counter("messages_processed");
        // Implementation would calculate rate based on time window
        recent_messages as f64 / 60.0 // Rough estimate
    }

    fn estimate_frame_rate(&self) -> f64 {
        // Estimate based on requestAnimationFrame timing
        60.0 // Placeholder - would implement actual FPS measurement
    }

    fn estimate_cpu_usage(&self) -> f64 {
        // Rough CPU usage estimation based on timing
        let recent_processing_time = self.get_average_metric("total_processing_time", 1000).unwrap_or(0.0);
        (recent_processing_time / 1000.0 * 100.0).min(100.0)
    }

    fn calculate_uptime(&self) -> u64 {
        // Calculate application uptime
        if let Some(first_sample) = self.samples.front() {
            ((js_sys::Date::now() as u64).saturating_sub(first_sample.timestamp)) / 1000
        } else {
            0
        }
    }
}

#[derive(Debug)]
struct MemoryInfo {
    used_js_heap_size: u64,
    total_js_heap_size: u64,
    js_heap_size_limit: u64,
}

#[derive(Debug)]
struct PerformanceTiming {
    dom_loading_time: f64,
    dom_interactive_time: f64,
    dom_complete_time: f64,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct PerformanceSummary {
    pub current_memory_mb: f64,
    pub current_wasm_memory_mb: f64,
    pub average_message_time_ms: f64,
    pub average_p2p_latency_ms: f64,
    pub total_messages_processed: u64,
    pub active_connections: u32,
    pub current_frame_rate: f64,
    pub cpu_usage_percent: f64,
    pub uptime_seconds: u64,
}

// Global performance monitor
thread_local! {
    static PERFORMANCE_MONITOR: std::cell::RefCell<PerformanceMonitor> = std::cell::RefCell::new(PerformanceMonitor::new(1000, 300));
}

fn with_performance_monitor<F, R>(f: F) -> Result<R, JsValue>
where
    F: FnOnce(&mut PerformanceMonitor) -> R,
{
    PERFORMANCE_MONITOR.with(|monitor| {
        let mut monitor_ref = monitor.borrow_mut();
        Ok(f(&mut *monitor_ref))
    })
}
```

### 6.4 WASM Binding Functions for Advanced Features

```rust
// Add to src/lib.rs

// Encryption bindings
#[wasm_bindgen]
pub fn generate_room_encryption_key(room_id: &str) -> Result<String, JsValue> {
    with_encryption_manager(|manager| {
        manager.generate_room_key(room_id)
    })?
}

#[wasm_bindgen]
pub fn encrypt_message_content(message: &str, key_id: Option<String>) -> Result<String, JsValue> {
    let encrypted = with_encryption_manager(|manager| {
        manager.encrypt_message(message, key_id.as_deref())
    })??;

    serde_json::to_string(&encrypted)
        .map_err(|_| JsValue::from_str("Failed to serialize encrypted data"))
}

#[wasm_bindgen]
pub fn decrypt_message_content(encrypted_data: &str) -> Result<String, JsValue> {
    let encrypted: EncryptedData = serde_json::from_str(encrypted_data)
        .map_err(|_| JsValue::from_str("Invalid encrypted data format"))?;

    with_encryption_manager(|manager| {
        manager.decrypt_message(&encrypted)
    })?
}

// Storage bindings
#[wasm_bindgen]
pub async fn initialize_storage(database_name: &str, version: u32) -> Result<(), JsValue> {
    let config = StorageConfig {
        database_name: database_name.to_string(),
        version,
        max_messages_per_room: 1000,
        auto_cleanup_days: 30,
        compression_enabled: true,
    };

    let mut storage = IndexedDBManager::new(config);
    storage.initialize().await?;

    STORAGE_MANAGER.with(|manager| {
        let mut manager_ref = manager.borrow_mut();
        *manager_ref = Some(storage);
    });

    Ok(())
}

#[wasm_bindgen]
pub async fn store_message_persistent(message_data: &JsValue) -> Result<(), JsValue> {
    let message: StoredMessage = serde_wasm_bindgen::from_value(message_data.clone())?;

    with_storage_manager(|storage| async move {
        storage.store_message(&message).await
    }).await?
}

#[wasm_bindgen]
pub async fn get_stored_messages(room_id: &str, limit: Option<u32>) -> Result<JsValue, JsValue> {
    let messages = with_storage_manager(|storage| async move {
        storage.get_messages(room_id, limit, None).await
    }).await??;

    serde_wasm_bindgen::to_value(&messages)
        .map_err(|_| JsValue::from_str("Failed to serialize messages"))
}

// Performance monitoring bindings
#[wasm_bindgen]
pub fn start_performance_monitoring() -> Result<(), JsValue> {
    with_performance_monitor(|monitor| {
        monitor.collect_system_metrics();
        console_log!("Performance monitoring started");
    })?;
    Ok(())
}

#[wasm_bindgen]
pub fn record_performance_metric(name: &str, value: f64, unit: &str, category: &str) -> Result<(), JsValue> {
    let metric_category = match category {
        "memory" => MetricCategory::Memory,
        "network" => MetricCategory::Network,
        "rendering" => MetricCategory::Rendering,
        "computation" => MetricCategory::Computation,
        "storage" => MetricCategory::Storage,
        "p2p" => MetricCategory::P2P,
        "wasm" => MetricCategory::WASM,
        _ => MetricCategory::Custom,
    };

    with_performance_monitor(|monitor| {
        monitor.record_metric(name, value, unit, metric_category);
    })?;

    Ok(())
}

#[wasm_bindgen]
pub fn get_performance_summary() -> JsValue {
    let summary = with_performance_monitor(|monitor| {
        monitor.get_performance_summary()
    }).unwrap_or_else(|_| PerformanceSummary {
        current_memory_mb: 0.0,
        current_wasm_memory_mb: 0.0,
        average_message_time_ms: 0.0,
        average_p2p_latency_ms: 0.0,
        total_messages_processed: 0,
        active_connections: 0,
        current_frame_rate: 0.0,
        cpu_usage_percent: 0.0,
        uptime_seconds: 0,
    });

    serde_wasm_bindgen::to_value(&summary).unwrap_or(JsValue::NULL)
}

#[wasm_bindgen]
pub fn start_performance_timer(label: &str) -> Result<(), JsValue> {
    with_performance_monitor(|monitor| {
        monitor.start_timer(label);
    })?;
    Ok(())
}

#[wasm_bindgen]
pub fn end_performance_timer(label: &str) -> Option<f64> {
    with_performance_monitor(|monitor| {
        monitor.end_timer(label)
    }).unwrap_or(None)
}
```

## JavaScript Integration

### Update Application Initialization
```javascript
// In js/index.js, update initializeApp function
async function initializeApp() {
  try {
    // Initialize theme preference
    initializeTheme();

    // Load WASM module first
    await loadWasmModule();
    createSafeWasmProxies();

    // Initialize advanced features
    await initializeAdvancedFeatures();

    // ... rest of initialization
  } catch (error) {
    console.error('Failed to initialize application:', error);
  }
}

async function initializeAdvancedFeatures() {
  try {
    // Initialize storage
    await window.safeWasm.initialize_storage('mindline_db', 1);
    console.log('✅ IndexedDB storage initialized');

    // Start performance monitoring
    window.safeWasm.start_performance_monitoring();
    console.log('✅ Performance monitoring started');

    // Generate encryption keys if needed
    const roomId = getCurrentRoomId();
    if (roomId) {
      try {
        const keyId = window.safeWasm.generate_room_encryption_key(roomId);
        console.log('✅ Room encryption key generated:', keyId);
      } catch (error) {
        console.warn('Could not generate room encryption key:', error);
      }
    }

    // Start periodic performance collection
    setInterval(() => {
      if (window.safeWasm && window.safeWasm.start_performance_monitoring) {
        window.safeWasm.start_performance_monitoring();
      }
    }, 5000); // Every 5 seconds

  } catch (error) {
    console.warn('Some advanced features failed to initialize:', error);
  }
}
```

### Add Performance Monitoring Wrapper
```javascript
// Create js/performance-monitor.js
class PerformanceMonitorWrapper {
  constructor() {
    this.isEnabled = false;
  }

  enable() {
    this.isEnabled = true;
    if (window.safeWasm && window.safeWasm.start_performance_monitoring) {
      window.safeWasm.start_performance_monitoring();
    }
  }

  recordMetric(name, value, unit = 'ms', category = 'custom') {
    if (this.isEnabled && window.safeWasm && window.safeWasm.record_performance_metric) {
      window.safeWasm.record_performance_metric(name, value, unit, category);
    }
  }

  startTimer(label) {
    if (this.isEnabled && window.safeWasm && window.safeWasm.start_performance_timer) {
      window.safeWasm.start_performance_timer(label);
    }
  }

  endTimer(label) {
    if (this.isEnabled && window.safeWasm && window.safeWasm.end_performance_timer) {
      return window.safeWasm.end_performance_timer(label);
    }
    return null;
  }

  getSummary() {
    if (window.safeWasm && window.safeWasm.get_performance_summary) {
      return window.safeWasm.get_performance_summary();
    }
    return null;
  }

  // Instrument common operations
  instrumentMessageSending() {
    const originalSendMessage = window.sendMessage;
    if (originalSendMessage) {
      window.sendMessage = (...args) => {
        this.startTimer('message_send');
        const result = originalSendMessage.apply(this, args);
        this.endTimer('message_send');
        return result;
      };
    }
  }
}

const performanceMonitor = new PerformanceMonitorWrapper();
window.performanceMonitor = performanceMonitor;

export default performanceMonitor;
```

## Dependencies to Add

Add to `Cargo.toml`:

```toml
[dependencies]
aes-gcm = "0.10"
argon2 = "0.5"
ring = "0.17"
rand = "0.8"
hex = "0.4"
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
serde-wasm-bindgen = "0.6"
wasm-bindgen-futures = "0.4"

[dependencies.web-sys]
features = [
  "console",
  "Window",
  "Performance",
  "PerformanceTiming",
  "Crypto",
  "IdbFactory",
  "IdbDatabase",
  "IdbObjectStore",
  "IdbTransaction",
  "IdbRequest",
  "IdbKeyRange",
  "IdbIndex",
  "IdbCursor",
]
```

## Testing Strategy

### Unit Tests
```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encryption_roundtrip() {
        let mut manager = EncryptionManager::new();
        let key_id = manager.generate_room_key("test-room").unwrap();

        let message = "Hello, encrypted world!";
        let encrypted = manager.encrypt_message(message, Some(&key_id)).unwrap();
        let decrypted = manager.decrypt_message(&encrypted).unwrap();

        assert_eq!(message, decrypted);
    }

    #[test]
    fn test_performance_metrics() {
        let mut monitor = PerformanceMonitor::new(100, 50);

        monitor.record_metric("test_metric", 42.0, "ms", MetricCategory::Computation);
        let metrics = monitor.get_metrics(Some(MetricCategory::Computation), None);

        assert_eq!(metrics.len(), 1);
        assert_eq!(metrics[0].value, 42.0);
    }
}
```

### Integration Tests
1. **Encryption Performance**: Test encryption/decryption speed
2. **Storage Performance**: Test IndexedDB operations
3. **Memory Usage**: Monitor WASM memory consumption
4. **End-to-End**: Test complete advanced feature workflow

## Success Criteria

- [ ] Enhanced encryption system working
- [ ] IndexedDB persistence functional
- [ ] Performance monitoring active
- [ ] All advanced features integrated
- [ ] Memory usage optimized
- [ ] Security features operational
- [ ] Performance improvements measurable
- [ ] Future extensibility enabled

## Timeline: Week 11-12 (14 days)

### Days 1-5: Core Implementation
- Implement encryption system
- Create IndexedDB integration
- Build performance monitoring
- Write comprehensive tests

### Days 6-10: Integration
- Integrate with existing message system
- Add JavaScript wrappers
- Test advanced features
- Performance optimization

### Days 11-14: Polish and Documentation
- Final testing and bug fixes
- Performance tuning
- Documentation completion
- Future roadmap planning

## Future Enhancements Enabled

This phase enables future capabilities:

### Desktop Application
- Core logic ready for Tauri integration
- Native file system access
- Desktop notifications
- System tray integration

### Server Components
- Rust code can run on server
- Relay server implementation
- Message persistence server
- User authentication server

### Mobile Applications
- React Native integration
- PWA enhancements
- Offline functionality
- Push notifications

### Advanced Features
- Message search (full-text indexing)
- File sharing with encryption
- Voice/video call coordination
- Advanced security features
- AI-powered features

This final phase completes the migration while opening doors to capabilities that would be difficult or impossible with JavaScript alone, positioning Mindline for future growth and enhancement.