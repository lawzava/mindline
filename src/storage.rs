// src/storage.rs - Simplified IndexedDB persistence system for Phase 6

use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;
use std::collections::HashMap;

use crate::console_log;

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

// Simplified storage manager using in-memory storage for now
// In production, this would use IndexedDB via JavaScript interop
pub struct IndexedDBManager {
    config: StorageConfig,
    messages: HashMap<String, Vec<StoredMessage>>,
    rooms: HashMap<String, StoredRoom>,
}

impl IndexedDBManager {
    pub fn new(config: StorageConfig) -> Self {
        Self {
            config,
            messages: HashMap::new(),
            rooms: HashMap::new(),
        }
    }

    pub async fn initialize(&mut self) -> Result<(), JsValue> {
        console_log!("IndexedDB manager initialized: {}", self.config.database_name);
        Ok(())
    }

    pub async fn store_message(&mut self, message: &StoredMessage) -> Result<(), JsValue> {
        let room_messages = self.messages.entry(message.room_id.clone()).or_insert_with(Vec::new);
        room_messages.push(message.clone());

        // Keep only the last max_messages_per_room messages
        if room_messages.len() > self.config.max_messages_per_room as usize {
            room_messages.drain(0..room_messages.len() - self.config.max_messages_per_room as usize);
        }

        // Update room statistics
        self.update_room_stats(&message.room_id, 1).await?;

        console_log!("Message stored: {}", message.id);
        Ok(())
    }

    pub async fn get_messages(&self, room_id: &str, limit: Option<u32>) -> Result<Vec<StoredMessage>, JsValue> {
        let messages = self.messages.get(room_id)
            .map(|msgs| {
                let mut sorted = msgs.clone();
                sorted.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));

                if let Some(limit) = limit {
                    sorted.truncate(limit as usize);
                }
                sorted
            })
            .unwrap_or_default();

        Ok(messages)
    }

    pub async fn store_room(&mut self, room: &StoredRoom) -> Result<(), JsValue> {
        self.rooms.insert(room.id.clone(), room.clone());
        console_log!("Room stored: {}", room.id);
        Ok(())
    }

    pub async fn get_room(&self, room_id: &str) -> Result<Option<StoredRoom>, JsValue> {
        Ok(self.rooms.get(room_id).cloned())
    }

    pub async fn list_rooms(&self) -> Result<Vec<StoredRoom>, JsValue> {
        let mut rooms: Vec<StoredRoom> = self.rooms.values().cloned().collect();
        rooms.sort_by(|a, b| b.last_activity.cmp(&a.last_activity));
        Ok(rooms)
    }

    pub async fn delete_room(&mut self, room_id: &str) -> Result<(), JsValue> {
        self.rooms.remove(room_id);
        self.messages.remove(room_id);
        console_log!("Room deleted: {}", room_id);
        Ok(())
    }

    async fn update_room_stats(&mut self, room_id: &str, message_increment: u32) -> Result<(), JsValue> {
        if let Some(room) = self.rooms.get_mut(room_id) {
            room.message_count += message_increment;
            room.last_activity = js_sys::Date::now() as u64;
        }
        Ok(())
    }

    pub async fn cleanup_old_data(&mut self, days_old: u32) -> Result<u32, JsValue> {
        let cutoff_time = (js_sys::Date::now() as u64).saturating_sub(days_old as u64 * 24 * 60 * 60 * 1000);
        let mut deleted_count = 0;

        for messages in self.messages.values_mut() {
            let original_len = messages.len();
            messages.retain(|msg| msg.timestamp >= cutoff_time);
            deleted_count += (original_len - messages.len()) as u32;
        }

        console_log!("Cleaned up {} old records", deleted_count);
        Ok(deleted_count)
    }

    pub async fn export_room_data(&self, room_id: &str) -> Result<String, JsValue> {
        let room = self.get_room(room_id).await?;
        let messages = self.get_messages(room_id, None).await?;

        let export_data = serde_json::json!({
            "room": room,
            "messages": messages,
            "exported_at": js_sys::Date::now() as u64,
            "version": "1.0"
        });

        Ok(export_data.to_string())
    }

    pub async fn import_room_data(&mut self, import_data: &str) -> Result<String, JsValue> {
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
        let total_messages: u32 = self.messages.values().map(|v| v.len() as u32).sum();
        let total_rooms = self.rooms.len() as u32;

        Ok(StorageUsage {
            total_messages,
            total_rooms,
            database_size_mb: 0.0, // Would calculate actual size if available
            last_cleanup: 0,
        })
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
    pub static STORAGE_MANAGER: std::cell::RefCell<Option<IndexedDBManager>> = std::cell::RefCell::new(None);
}

pub fn init_storage_manager(config: StorageConfig) {
    STORAGE_MANAGER.with(|manager| {
        let mut manager_ref = manager.borrow_mut();
        *manager_ref = Some(IndexedDBManager::new(config));
    });
}