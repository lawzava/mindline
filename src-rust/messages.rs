// src/messages.rs - Enhanced message processing for Phase 3

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use wasm_bindgen::prelude::*;
use web_sys::window;

// Simple macro for logging to browser console
#[cfg(not(test))]
macro_rules! console_log {
    ($($t:tt)*) => (crate::log(&format!($($t)*)))
}

#[cfg(test)]
macro_rules! console_log {
    ($($t:tt)*) => (println!($($t)*))
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub enum MessageType {
    Text,
    Typing,
    StoppedTyping,
    Edit,
    Delete,
    Media,
    Reaction,
    System,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub enum MessageStatus {
    Sending,
    Sent,
    Delivered,
    Failed,
    Edited,
    Deleted,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct MessageReaction {
    pub emoji: String,
    pub users: Vec<String>, // user IDs who reacted
    pub count: usize,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct EnhancedMessage {
    pub id: String,
    pub sender_id: String,
    pub sender_name: String,
    pub message_type: MessageType,
    pub content: String,
    pub timestamp: u64,
    pub room_id: String,
    pub status: MessageStatus,

    // Enhanced features
    pub edited: bool,
    pub edit_timestamp: Option<u64>,
    pub original_content: Option<String>,
    pub reply_to: Option<String>, // Message ID this is replying to
    pub reactions: HashMap<String, MessageReaction>, // emoji -> reaction data
    pub mentions: Vec<String>,    // user IDs mentioned in this message

    // Metadata
    pub local_timestamp: u64, // When message was created locally
    pub delivery_attempts: u32,
    pub size_bytes: usize,
}

#[allow(dead_code)]
impl EnhancedMessage {
    pub fn new(
        id: String,
        sender_id: String,
        sender_name: String,
        content: String,
        room_id: String,
    ) -> Self {
        #[cfg(not(test))]
        let timestamp = js_sys::Date::now() as u64;
        #[cfg(test)]
        let timestamp = 1000u64; // Fixed timestamp for tests

        let size_bytes =
            content.len() + id.len() + sender_id.len() + sender_name.len() + room_id.len();

        Self {
            id,
            sender_id,
            sender_name,
            message_type: MessageType::Text,
            content,
            timestamp,
            room_id,
            status: MessageStatus::Sending,
            edited: false,
            edit_timestamp: None,
            original_content: None,
            reply_to: None,
            reactions: HashMap::new(),
            mentions: Vec::new(),
            local_timestamp: timestamp,
            delivery_attempts: 0,
            size_bytes,
        }
    }

    pub fn edit_content(&mut self, new_content: String) {
        self.original_content = Some(self.content.clone());
        self.content = new_content;
        self.edited = true;
        #[cfg(not(test))]
        let edit_time = js_sys::Date::now() as u64;
        #[cfg(test)]
        let edit_time = 2000u64;
        self.edit_timestamp = Some(edit_time);
        self.status = MessageStatus::Edited;
    }

    pub fn add_reaction(&mut self, emoji: &str, user_id: &str) {
        let reaction = self
            .reactions
            .entry(emoji.to_string())
            .or_insert_with(|| MessageReaction {
                emoji: emoji.to_string(),
                users: Vec::new(),
                count: 0,
            });

        if !reaction.users.contains(&user_id.to_string()) {
            reaction.users.push(user_id.to_string());
            reaction.count = reaction.users.len();
        }
    }

    pub fn remove_reaction(&mut self, emoji: &str, user_id: &str) {
        if let Some(reaction) = self.reactions.get_mut(emoji) {
            reaction.users.retain(|u| u != user_id);
            reaction.count = reaction.users.len();
            if reaction.count == 0 {
                self.reactions.remove(emoji);
            }
        }
    }

    pub fn extract_mentions(&mut self) {
        // Extract @username mentions from content
        // Simple regex-like pattern matching without regex crate for now
        let mut mentions = Vec::new();
        let chars = self.content.chars();
        let mut current_mention = String::new();
        let mut in_mention = false;

        for ch in chars {
            if ch == '@' {
                in_mention = true;
                current_mention.clear();
            } else if in_mention {
                if ch.is_alphanumeric() || ch == '_' || ch == '-' {
                    current_mention.push(ch);
                } else {
                    if !current_mention.is_empty() {
                        mentions.push(current_mention.clone());
                    }
                    in_mention = false;
                    current_mention.clear();
                }
            }
        }

        // Don't forget the last mention if the string ends with it
        if in_mention && !current_mention.is_empty() {
            mentions.push(current_mention);
        }

        self.mentions = mentions;
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DraftMessage {
    pub content: String,
    pub sender_name: String,
    pub sender_id: String,
    pub last_update: u64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct MessageSyncRequest {
    pub request_type: SyncRequestType,
    pub room_id: String,
    pub requester_id: String,
    pub timestamp: u64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub enum SyncRequestType {
    RequestSync {
        last_sync: u64,
        message_count: usize,
    },
    SyncResponse {
        messages: Vec<EnhancedMessage>,
    },
    RequestHistory {
        before_timestamp: Option<u64>,
        limit: usize,
    },
    HistoryResponse {
        messages: Vec<EnhancedMessage>,
        has_more: bool,
    },
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct RoomMessageState {
    pub room_id: String,
    pub messages: Vec<EnhancedMessage>, // Ordered by timestamp
    pub message_ids: HashSet<String>,   // Quick lookup for duplicate checking
    pub last_sync: u64,
    pub total_messages: usize,
    pub unread_count: usize,
    pub last_read_timestamp: u64,
    pub draft_messages: HashMap<String, DraftMessage>, // user_id -> draft
    pub typing_users: HashSet<String>,
    pub pending_messages: Vec<EnhancedMessage>, // Messages waiting for delivery
}

#[allow(dead_code)]
impl RoomMessageState {
    pub fn new(room_id: String) -> Self {
        #[cfg(not(test))]
        let last_read = js_sys::Date::now() as u64;
        #[cfg(test)]
        let last_read = 1000u64;

        Self {
            room_id,
            messages: Vec::new(),
            message_ids: HashSet::new(),
            last_sync: 0,
            total_messages: 0,
            unread_count: 0,
            last_read_timestamp: last_read,
            draft_messages: HashMap::new(),
            typing_users: HashSet::new(),
            pending_messages: Vec::new(),
        }
    }

    pub fn add_message(&mut self, mut message: EnhancedMessage) -> bool {
        // Check for duplicates
        if self.message_ids.contains(&message.id) {
            return false;
        }

        // Extract mentions
        message.extract_mentions();

        // Find insertion point to maintain chronological order
        let insert_index = self
            .messages
            .iter()
            .position(|m| m.timestamp > message.timestamp)
            .unwrap_or(self.messages.len());

        // Ensure index is valid for VecDeque insert
        let safe_index = insert_index.min(self.messages.len());

        // Insert message
        self.messages.insert(safe_index, message.clone());
        self.message_ids.insert(message.id.clone());
        self.total_messages += 1;

        true
    }

    pub fn get_message_mut(&mut self, message_id: &str) -> Option<&mut EnhancedMessage> {
        self.messages.iter_mut().find(|m| m.id == message_id)
    }

    pub fn get_message(&self, message_id: &str) -> Option<&EnhancedMessage> {
        self.messages.iter().find(|m| m.id == message_id)
    }

    pub fn edit_message(&mut self, message_id: &str, new_content: String) -> bool {
        if let Some(message) = self.get_message_mut(message_id) {
            message.edit_content(new_content);
            true
        } else {
            false
        }
    }

    pub fn delete_message(&mut self, message_id: &str) -> bool {
        if let Some(message) = self.get_message_mut(message_id) {
            message.status = MessageStatus::Deleted;
            message.content = "[Message deleted]".to_string();
            return true;
        }
        false
    }

    pub fn get_messages_after(&self, timestamp: u64, limit: usize) -> Vec<EnhancedMessage> {
        self.messages
            .iter()
            .filter(|m| m.timestamp > timestamp)
            .take(limit)
            .cloned()
            .collect()
    }

    pub fn get_recent_messages(&self, limit: usize) -> Vec<EnhancedMessage> {
        // Return messages in chronological order (oldest to newest)
        let all_messages: Vec<EnhancedMessage> = self.messages.to_vec();

        // If we have more messages than the limit, take the most recent ones
        if all_messages.len() > limit && limit > 0 {
            let skip_count = all_messages.len().saturating_sub(limit);
            all_messages.into_iter().skip(skip_count).collect()
        } else {
            all_messages
        }
    }

    pub fn add_typing_user(&mut self, user_id: String) {
        self.typing_users.insert(user_id);
    }

    pub fn remove_typing_user(&mut self, user_id: &str) {
        self.typing_users.remove(user_id);
    }

    pub fn clear_typing_users(&mut self) {
        self.typing_users.clear();
    }
}

pub struct MessageManager {
    pub rooms: HashMap<String, RoomMessageState>,
    pub current_user_id: Option<String>,
    pub message_cache_size: usize,
}

#[allow(dead_code)]
impl MessageManager {
    pub fn new() -> Self {
        Self {
            rooms: HashMap::new(),
            current_user_id: None,
            message_cache_size: 1000, // Maximum messages to keep in memory per room
        }
    }

    pub fn set_current_user(&mut self, user_id: String) {
        self.current_user_id = Some(user_id);
    }

    pub fn get_or_create_room(&mut self, room_id: &str) -> &mut RoomMessageState {
        self.rooms
            .entry(room_id.to_string())
            .or_insert_with(|| RoomMessageState::new(room_id.to_string()))
    }

    pub fn send_message(
        &mut self,
        room_id: &str,
        content: &str,
        message_id: &str,
        sender_name: &str,
    ) -> Result<EnhancedMessage, JsValue> {
        let user_id = self
            .current_user_id
            .as_ref()
            .ok_or_else(|| JsValue::from_str("No current user set"))?;

        let message = EnhancedMessage::new(
            message_id.to_string(),
            user_id.clone(),
            sender_name.to_string(),
            content.to_string(),
            room_id.to_string(),
        );

        let room = self.get_or_create_room(room_id);
        if room.add_message(message.clone()) {
            console_log!("Message added to room {}: {}", room_id, message_id);
            Ok(message)
        } else {
            Err(JsValue::from_str("Failed to add message - duplicate ID"))
        }
    }

    pub fn receive_message(&mut self, message: EnhancedMessage) -> bool {
        let room_id = message.room_id.clone();
        let room = self.get_or_create_room(&room_id);
        let added = room.add_message(message);

        if added {
            self.cleanup_old_messages(&room_id);
        }

        added
    }

    pub fn edit_message(
        &mut self,
        room_id: &str,
        message_id: &str,
        new_content: &str,
    ) -> Result<(), JsValue> {
        let room = self.get_or_create_room(room_id);
        if room.edit_message(message_id, new_content.to_string()) {
            console_log!("Message edited: {}", message_id);
            Ok(())
        } else {
            Err(JsValue::from_str("Message not found"))
        }
    }

    pub fn delete_message(&mut self, room_id: &str, message_id: &str) -> Result<(), JsValue> {
        let room = self.get_or_create_room(room_id);
        if room.delete_message(message_id) {
            console_log!("Message deleted: {}", message_id);
            Ok(())
        } else {
            Err(JsValue::from_str("Message not found"))
        }
    }

    pub fn add_reaction(
        &mut self,
        room_id: &str,
        message_id: &str,
        emoji: &str,
        user_id: &str,
    ) -> Result<(), JsValue> {
        let room = self.get_or_create_room(room_id);
        if let Some(message) = room.get_message_mut(message_id) {
            message.add_reaction(emoji, user_id);
            console_log!("Reaction added: {} to message {}", emoji, message_id);
            Ok(())
        } else {
            Err(JsValue::from_str("Message not found"))
        }
    }

    pub fn remove_reaction(
        &mut self,
        room_id: &str,
        message_id: &str,
        emoji: &str,
        user_id: &str,
    ) -> Result<(), JsValue> {
        let room = self.get_or_create_room(room_id);
        if let Some(message) = room.get_message_mut(message_id) {
            message.remove_reaction(emoji, user_id);
            console_log!("Reaction removed: {} from message {}", emoji, message_id);
            Ok(())
        } else {
            Err(JsValue::from_str("Message not found"))
        }
    }

    pub fn get_messages(&self, room_id: &str, limit: Option<usize>) -> Vec<EnhancedMessage> {
        if let Some(room) = self.rooms.get(room_id) {
            room.get_recent_messages(limit.unwrap_or(50))
        } else {
            Vec::new()
        }
    }

    pub fn get_messages_for_sync(
        &self,
        room_id: &str,
        after_timestamp: u64,
        limit: usize,
    ) -> Vec<EnhancedMessage> {
        if let Some(room) = self.rooms.get(room_id) {
            room.get_messages_after(after_timestamp, limit)
        } else {
            Vec::new()
        }
    }

    pub fn handle_typing_indicator(&mut self, room_id: &str, user_id: &str, is_typing: bool) {
        let room = self.get_or_create_room(room_id);
        if is_typing {
            room.add_typing_user(user_id.to_string());
        } else {
            room.remove_typing_user(user_id);
        }
    }

    pub fn get_typing_users(&self, room_id: &str) -> Vec<String> {
        if let Some(room) = self.rooms.get(room_id) {
            room.typing_users.iter().cloned().collect()
        } else {
            Vec::new()
        }
    }

    pub fn cleanup_old_messages(&mut self, room_id: &str) {
        if let Some(room) = self.rooms.get_mut(room_id) {
            while room.messages.len() > self.message_cache_size {
                if !room.messages.is_empty() {
                    let old_message = room.messages.remove(0);
                    room.message_ids.remove(&old_message.id);
                }
            }
        }
    }

    pub fn get_room_stats(&self, room_id: &str) -> Option<(usize, usize, u64)> {
        self.rooms
            .get(room_id)
            .map(|room| (room.total_messages, room.unread_count, room.last_sync))
    }

    pub fn save_room_to_storage(&self, room_id: &str) -> Result<(), JsValue> {
        let window = window().ok_or_else(|| JsValue::from_str("No window object"))?;
        let storage = window
            .local_storage()
            .map_err(|_| JsValue::from_str("No localStorage"))?
            .ok_or_else(|| JsValue::from_str("localStorage not available"))?;

        if let Some(room) = self.rooms.get(room_id) {
            let storage_key = format!("chatHistory_{}", room_id);

            // Read existing data from localStorage and merge to prevent multi-tab race conditions
            let merged_room = if let Ok(Some(stored_data)) = storage.get_item(&storage_key) {
                if let Ok(stored_room) = serde_json::from_str::<RoomMessageState>(&stored_data) {
                    // Merge: combine messages from storage and current in-memory state
                    let mut merged = RoomMessageState::new(room_id.to_string());

                    // IMPORTANT: Add in-memory state FIRST so edits/deletes/reactions take precedence
                    // Then add localStorage messages (only those not already in in-memory will be added)
                    for msg in &room.messages {
                        merged.add_message(msg.clone());
                    }

                    // Then add messages from localStorage (only new messages from other tabs)
                    for msg in stored_room.messages {
                        merged.add_message(msg);
                    }

                    // Copy other state from in-memory room
                    merged.last_sync = room.last_sync.max(stored_room.last_sync);
                    merged.unread_count = room.unread_count;
                    merged.last_read_timestamp = room.last_read_timestamp.max(stored_room.last_read_timestamp);
                    merged.draft_messages = room.draft_messages.clone();
                    merged.typing_users = room.typing_users.clone();
                    merged.pending_messages = room.pending_messages.clone();

                    merged
                } else {
                    // Couldn't parse stored data, use current room
                    room.clone()
                }
            } else {
                // No stored data, use current room
                room.clone()
            };

            let serialized = serde_json::to_string(&merged_room)
                .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))?;

            storage
                .set_item(&storage_key, &serialized)
                .map_err(|_| JsValue::from_str("Failed to save to localStorage"))?;
        }

        Ok(())
    }

    pub fn load_room_from_storage(&mut self, room_id: &str) -> Result<bool, JsValue> {
        let window = window().ok_or_else(|| JsValue::from_str("No window object"))?;
        let storage = window
            .local_storage()
            .map_err(|_| JsValue::from_str("No localStorage"))?
            .ok_or_else(|| JsValue::from_str("localStorage not available"))?;

        let storage_key = format!("chatHistory_{}", room_id);

        if let Ok(Some(stored_data)) = storage.get_item(&storage_key) {
            match serde_json::from_str::<RoomMessageState>(&stored_data) {
                Ok(room_state) => {
                    // If we already have messages in memory, merge them with loaded data
                    if let Some(existing_room) = self.rooms.get(room_id) {
                        if !existing_room.messages.is_empty() {
                            // Merge: keep existing in-memory messages and add loaded ones
                            let mut merged = room_state;
                            for msg in &existing_room.messages {
                                // add_message handles deduplication
                                merged.add_message(msg.clone());
                            }
                            self.rooms.insert(room_id.to_string(), merged);
                            return Ok(true);
                        }
                    }
                    self.rooms.insert(room_id.to_string(), room_state);
                    Ok(true)
                }
                Err(_) => {
                    // Clear corrupted/old format data
                    let _ = storage.remove_item(&storage_key);
                    // Create fresh room
                    self.get_or_create_room(room_id);
                    Ok(false)
                }
            }
        } else {
            // No data found, create new room
            self.get_or_create_room(room_id);
            Ok(false)
        }
    }
}

// Global message manager
thread_local! {
    pub static MESSAGE_MANAGER: Arc<Mutex<MessageManager>> = Arc::new(Mutex::new(MessageManager::new()));
}

pub fn with_message_manager<F, R>(f: F) -> Result<R, JsValue>
where
    F: FnOnce(&mut MessageManager) -> R,
{
    MESSAGE_MANAGER.with(|manager| {
        let mut manager = manager
            .lock()
            .map_err(|_| JsValue::from_str("Failed to lock message manager"))?;
        Ok(f(&mut manager))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_message(id: &str, content: &str, timestamp: u64) -> EnhancedMessage {
        let mut msg = EnhancedMessage::new(
            id.to_string(),
            "user-1".to_string(),
            "Test User".to_string(),
            content.to_string(),
            "room-1".to_string(),
        );
        msg.timestamp = timestamp;
        msg
    }

    #[test]
    fn test_enhanced_message_creation() {
        let message = EnhancedMessage::new(
            "msg-1".to_string(),
            "user-1".to_string(),
            "Test User".to_string(),
            "Hello world".to_string(),
            "room-1".to_string(),
        );

        assert_eq!(message.id, "msg-1");
        assert_eq!(message.sender_id, "user-1");
        assert_eq!(message.sender_name, "Test User");
        assert_eq!(message.content, "Hello world");
        assert_eq!(message.room_id, "room-1");
        assert_eq!(message.status, MessageStatus::Sending);
        assert!(!message.edited);
        assert!(message.reactions.is_empty());
        assert!(message.mentions.is_empty());
    }

    #[test]
    fn test_message_editing() {
        let mut message = create_test_message("msg-1", "Original content", 1000);

        message.edit_content("Edited content".to_string());

        assert_eq!(message.content, "Edited content");
        assert!(message.edited);
        assert_eq!(
            message.original_content,
            Some("Original content".to_string())
        );
        assert!(message.edit_timestamp.is_some());
        assert_eq!(message.status, MessageStatus::Edited);
    }

    #[test]
    fn test_message_reactions() {
        let mut message = create_test_message("msg-1", "Test message", 1000);

        // Add reactions
        message.add_reaction("👍", "user-1");
        message.add_reaction("👍", "user-2");
        message.add_reaction("❤️", "user-1");

        assert_eq!(message.reactions.len(), 2);
        assert_eq!(message.reactions.get("👍").unwrap().count, 2);
        assert_eq!(message.reactions.get("❤️").unwrap().count, 1);

        // Remove reaction
        message.remove_reaction("👍", "user-1");
        assert_eq!(message.reactions.get("👍").unwrap().count, 1);

        // Remove last reaction for an emoji
        message.remove_reaction("👍", "user-2");
        assert!(!message.reactions.contains_key("👍"));
    }

    #[test]
    fn test_mention_extraction() {
        let mut message = create_test_message(
            "msg-1",
            "Hello @alice and @bob, how are you @charlie?",
            1000,
        );

        message.extract_mentions();

        assert_eq!(message.mentions.len(), 3);
        assert!(message.mentions.contains(&"alice".to_string()));
        assert!(message.mentions.contains(&"bob".to_string()));
        assert!(message.mentions.contains(&"charlie".to_string()));
    }

    #[test]
    fn test_room_message_state_creation() {
        let room = RoomMessageState::new("room-1".to_string());

        assert_eq!(room.room_id, "room-1");
        assert_eq!(room.messages.len(), 0);
        assert_eq!(room.total_messages, 0);
        assert_eq!(room.unread_count, 0);
        assert!(room.typing_users.is_empty());
    }

    #[test]
    fn test_room_message_ordering() {
        let mut room = RoomMessageState::new("room-1".to_string());

        // Add messages out of order
        let msg1 = create_test_message("msg-1", "First", 1000);
        let msg2 = create_test_message("msg-2", "Second", 2000);
        let msg3 = create_test_message("msg-3", "Third", 1500);

        room.add_message(msg2);
        room.add_message(msg1);
        room.add_message(msg3);

        // Verify chronological order
        let messages = room.get_recent_messages(10);
        assert_eq!(messages.len(), 3);
        assert_eq!(messages[0].content, "First");
        assert_eq!(messages[1].content, "Third");
        assert_eq!(messages[2].content, "Second");
    }

    #[test]
    fn test_duplicate_message_prevention() {
        let mut room = RoomMessageState::new("room-1".to_string());

        let msg = create_test_message("msg-1", "Test", 1000);

        assert!(room.add_message(msg.clone()));
        assert!(!room.add_message(msg)); // Duplicate should be rejected
        assert_eq!(room.total_messages, 1);
    }

    #[test]
    fn test_message_editing_in_room() {
        let mut room = RoomMessageState::new("room-1".to_string());

        let msg = create_test_message("msg-1", "Original", 1000);
        room.add_message(msg);

        assert!(room.edit_message("msg-1", "Edited".to_string()));

        let edited_msg = room.get_message("msg-1").unwrap();
        assert_eq!(edited_msg.content, "Edited");
        assert!(edited_msg.edited);
    }

    #[test]
    fn test_message_deletion_in_room() {
        let mut room = RoomMessageState::new("room-1".to_string());

        let msg = create_test_message("msg-1", "To be deleted", 1000);
        room.add_message(msg);

        assert!(room.delete_message("msg-1"));

        let deleted_msg = room.get_message("msg-1").unwrap();
        assert_eq!(deleted_msg.content, "[Message deleted]");
        assert_eq!(deleted_msg.status, MessageStatus::Deleted);
    }

    #[test]
    fn test_typing_users_management() {
        let mut room = RoomMessageState::new("room-1".to_string());

        room.add_typing_user("user-1".to_string());
        room.add_typing_user("user-2".to_string());

        assert_eq!(room.typing_users.len(), 2);
        assert!(room.typing_users.contains("user-1"));

        room.remove_typing_user("user-1");
        assert_eq!(room.typing_users.len(), 1);
        assert!(!room.typing_users.contains("user-1"));

        room.clear_typing_users();
        assert!(room.typing_users.is_empty());
    }

    #[test]
    fn test_get_messages_after_timestamp() {
        let mut room = RoomMessageState::new("room-1".to_string());

        room.add_message(create_test_message("msg-1", "Old", 1000));
        room.add_message(create_test_message("msg-2", "Middle", 2000));
        room.add_message(create_test_message("msg-3", "New", 3000));

        let messages = room.get_messages_after(1500, 10);
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].content, "Middle");
        assert_eq!(messages[1].content, "New");
    }

    #[test]
    fn test_message_manager_creation() {
        let mut manager = MessageManager::new();

        assert!(manager.current_user_id.is_none());
        assert_eq!(manager.message_cache_size, 1000);

        manager.set_current_user("user-1".to_string());
        assert_eq!(manager.current_user_id, Some("user-1".to_string()));
    }

    #[test]
    fn test_message_manager_send_message() {
        let mut manager = MessageManager::new();
        manager.set_current_user("user-1".to_string());

        let result = manager.send_message("room-1", "Test message", "msg-1", "Test User");

        assert!(result.is_ok());
        let message = result.unwrap();
        assert_eq!(message.content, "Test message");
        assert_eq!(message.room_id, "room-1");

        // Verify message was added to room
        let messages = manager.get_messages("room-1", None);
        assert_eq!(messages.len(), 1);
    }

    #[test]
    fn test_message_manager_receive_message() {
        let mut manager = MessageManager::new();

        let msg = create_test_message("msg-1", "Received message", 1000);

        assert!(manager.receive_message(msg.clone()));

        let messages = manager.get_messages("room-1", None);
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].content, "Received message");

        // Test duplicate rejection
        assert!(!manager.receive_message(msg));
    }

    #[test]
    fn test_message_manager_reactions() {
        let mut manager = MessageManager::new();
        manager.set_current_user("user-1".to_string());

        // Send a message first
        manager
            .send_message("room-1", "Test", "msg-1", "User")
            .unwrap();

        // Add reaction
        assert!(manager
            .add_reaction("room-1", "msg-1", "👍", "user-2")
            .is_ok());

        let messages = manager.get_messages("room-1", None);
        assert_eq!(messages[0].reactions.get("👍").unwrap().count, 1);
    }

    #[test]
    fn test_message_manager_typing_indicators() {
        let mut manager = MessageManager::new();

        manager.handle_typing_indicator("room-1", "user-1", true);
        manager.handle_typing_indicator("room-1", "user-2", true);

        let typing_users = manager.get_typing_users("room-1");
        assert_eq!(typing_users.len(), 2);
        assert!(typing_users.contains(&"user-1".to_string()));

        manager.handle_typing_indicator("room-1", "user-1", false);
        let typing_users = manager.get_typing_users("room-1");
        assert_eq!(typing_users.len(), 1);
    }

    #[test]
    fn test_message_cleanup() {
        let mut manager = MessageManager::new();
        manager.message_cache_size = 3; // Set small cache for testing
        manager.set_current_user("user-1".to_string());

        // Add more messages than cache size
        for i in 0..5 {
            let msg = EnhancedMessage::new(
                format!("msg-{}", i),
                "user-1".to_string(),
                "User".to_string(),
                format!("Message {}", i),
                "room-1".to_string(),
            );
            manager.receive_message(msg);
        }

        let messages = manager.get_messages("room-1", None);
        assert_eq!(messages.len(), 3); // Should only keep last 3 messages
        assert_eq!(messages[0].content, "Message 2");
        assert_eq!(messages[2].content, "Message 4");
    }

    #[test]
    fn test_room_statistics() {
        let mut manager = MessageManager::new();
        manager.set_current_user("user-1".to_string());

        // Add some messages
        for i in 0..3 {
            manager
                .send_message(
                    "room-1",
                    &format!("Message {}", i),
                    &format!("msg-{}", i),
                    "User",
                )
                .unwrap();
        }

        let stats = manager.get_room_stats("room-1");
        assert!(stats.is_some());

        let (total, unread, _last_sync) = stats.unwrap();
        assert_eq!(total, 3);
        assert_eq!(unread, 0); // No unread logic implemented yet
    }

    #[test]
    fn test_sync_messages() {
        let mut manager = MessageManager::new();

        // Add messages with different timestamps
        let mut msg1 = create_test_message("msg-1", "Old", 1000);
        msg1.timestamp = 1000;
        let mut msg2 = create_test_message("msg-2", "Middle", 2000);
        msg2.timestamp = 2000;
        let mut msg3 = create_test_message("msg-3", "New", 3000);
        msg3.timestamp = 3000;

        manager.receive_message(msg1);
        manager.receive_message(msg2);
        manager.receive_message(msg3);

        // Get messages after timestamp 1500
        let sync_messages = manager.get_messages_for_sync("room-1", 1500, 10);
        assert_eq!(sync_messages.len(), 2);
        assert_eq!(sync_messages[0].content, "Middle");
        assert_eq!(sync_messages[1].content, "New");
    }
}
