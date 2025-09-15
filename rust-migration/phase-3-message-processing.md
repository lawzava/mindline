# Phase 3: Message Processing and History Management Migration

## Overview
Centralize all message operations, history management, and synchronization logic in Rust for improved performance, consistency, and easier maintenance. This phase handles the core chat functionality that users interact with most.

## Current State Analysis

### JavaScript Message Processing (spread across multiple files)
- **Message creation and sending** (`js/index.js` lines 1090-1260)
- **Message history management** (`js/index.js` lines 300-420)
- **Message synchronization** (`js/index.js` lines 425-540)
- **Message display coordination** (`js/index.js` lines 1980-2150)
- **Draft message handling** (`js/index.js` lines 2000-2150)

### Current Message Flow Issues
- Complex message deduplication logic in JavaScript
- Multiple sources of truth for message state
- Synchronization logic spread across files
- Race conditions in message ordering
- Manual timestamp handling and formatting

### Benefits of Rust Migration
- **Atomic operations**: Thread-safe message operations
- **Better performance**: Faster message processing and sorting
- **Consistency**: Single source of truth for message state
- **Memory efficiency**: More efficient message storage
- **Type safety**: Compile-time validation of message structures

## Implementation Plan

### 3.1 Enhanced Message Structures

```rust
// Create src/messages.rs

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};
use wasm_bindgen::prelude::*;

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
    pub mentions: Vec<String>, // user IDs mentioned in this message

    // Metadata
    pub local_timestamp: u64, // When message was created locally
    pub delivery_attempts: u32,
    pub size_bytes: usize,
}

impl EnhancedMessage {
    pub fn new(
        id: String,
        sender_id: String,
        sender_name: String,
        content: String,
        room_id: String,
    ) -> Self {
        let timestamp = js_sys::Date::now() as u64;
        let size_bytes = content.len() + id.len() + sender_id.len() + sender_name.len() + room_id.len();

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

    pub fn mark_sent(&mut self) {
        self.status = MessageStatus::Sent;
    }

    pub fn mark_delivered(&mut self) {
        self.status = MessageStatus::Delivered;
    }

    pub fn mark_failed(&mut self) {
        self.status = MessageStatus::Failed;
    }

    pub fn edit_content(&mut self, new_content: String) {
        self.original_content = Some(self.content.clone());
        self.content = new_content;
        self.edited = true;
        self.edit_timestamp = Some(js_sys::Date::now() as u64);
        self.status = MessageStatus::Edited;
    }

    pub fn add_reaction(&mut self, emoji: &str, user_id: &str) {
        let reaction = self.reactions.entry(emoji.to_string()).or_insert_with(|| {
            MessageReaction {
                emoji: emoji.to_string(),
                users: Vec::new(),
                count: 0,
            }
        });

        if !reaction.users.contains(&user_id.to_string()) {
            reaction.users.push(user_id.to_string());
            reaction.count = reaction.users.len();
        }
    }

    pub fn remove_reaction(&mut self, emoji: &str, user_id: &str) {
        if let Some(reaction) = self.reactions.get_mut(emoji) {
            reaction.users.retain(|id| id != user_id);
            reaction.count = reaction.users.len();

            if reaction.count == 0 {
                self.reactions.remove(emoji);
            }
        }
    }

    pub fn extract_mentions(&mut self) {
        // Extract @username mentions from content
        let mention_regex = regex::Regex::new(r"@(\w+)").unwrap();
        self.mentions = mention_regex
            .captures_iter(&self.content)
            .map(|cap| cap[1].to_string())
            .collect();
    }
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
    RequestSync { last_sync: u64, message_count: usize },
    SyncResponse { messages: Vec<EnhancedMessage> },
    RequestHistory { before_timestamp: Option<u64>, limit: usize },
    HistoryResponse { messages: Vec<EnhancedMessage>, has_more: bool },
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct RoomMessageState {
    pub room_id: String,
    pub messages: VecDeque<EnhancedMessage>, // Ordered by timestamp
    pub message_lookup: HashMap<String, usize>, // message_id -> index in VecDeque
    pub last_sync: u64,
    pub total_messages: usize,
    pub unread_count: usize,
    pub last_read_timestamp: u64,
    pub draft_messages: HashMap<String, DraftMessage>, // user_id -> draft
    pub typing_users: HashSet<String>,
    pub pending_messages: Vec<EnhancedMessage>, // Messages waiting for delivery
}

impl RoomMessageState {
    pub fn new(room_id: String) -> Self {
        Self {
            room_id,
            messages: VecDeque::new(),
            message_lookup: HashMap::new(),
            last_sync: 0,
            total_messages: 0,
            unread_count: 0,
            last_read_timestamp: js_sys::Date::now() as u64,
            draft_messages: HashMap::new(),
            typing_users: HashSet::new(),
            pending_messages: Vec::new(),
        }
    }

    pub fn add_message(&mut self, mut message: EnhancedMessage) -> bool {
        // Check for duplicates
        if self.message_lookup.contains_key(&message.id) {
            return false;
        }

        // Extract mentions
        message.extract_mentions();

        // Find insertion point to maintain chronological order
        let insert_index = self.messages
            .iter()
            .position(|m| m.timestamp > message.timestamp)
            .unwrap_or(self.messages.len());

        // Update lookup table indices for messages that will be shifted
        for (_, index) in self.message_lookup.iter_mut() {
            if *index >= insert_index {
                *index += 1;
            }
        }

        // Insert message
        self.messages.insert(insert_index, message.clone());
        self.message_lookup.insert(message.id.clone(), insert_index);
        self.total_messages += 1;

        // Update unread count if not from current user
        // (This would need current user context)

        true
    }

    pub fn get_message(&self, message_id: &str) -> Option<&EnhancedMessage> {
        self.message_lookup
            .get(message_id)
            .and_then(|&index| self.messages.get(index))
    }

    pub fn get_message_mut(&mut self, message_id: &str) -> Option<&mut EnhancedMessage> {
        if let Some(&index) = self.message_lookup.get(message_id) {
            self.messages.get_mut(index)
        } else {
            None
        }
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
        if let Some(&index) = self.message_lookup.get(message_id) {
            if let Some(mut message) = self.messages.get_mut(index) {
                message.status = MessageStatus::Deleted;
                message.content = "[Message deleted]".to_string();
                return true;
            }
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
        self.messages
            .iter()
            .rev()
            .take(limit)
            .cloned()
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect()
    }

    pub fn mark_all_read(&mut self) {
        self.last_read_timestamp = js_sys::Date::now() as u64;
        self.unread_count = 0;
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
```

### 3.2 Message Manager

```rust
// Add to src/messages.rs

use std::sync::{Arc, Mutex};

pub struct MessageManager {
    rooms: HashMap<String, RoomMessageState>,
    current_user_id: Option<String>,
    message_cache_size: usize,
}

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
        self.rooms.entry(room_id.to_string())
            .or_insert_with(|| RoomMessageState::new(room_id.to_string()))
    }

    pub fn send_message(
        &mut self,
        room_id: &str,
        content: &str,
        message_id: &str,
    ) -> Result<EnhancedMessage, JsValue> {
        let user_id = self.current_user_id.as_ref()
            .ok_or_else(|| JsValue::from_str("No current user set"))?;

        let message = EnhancedMessage::new(
            message_id.to_string(),
            user_id.clone(),
            "Current User".to_string(), // Would get from user state
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
        let room = self.get_or_create_room(&message.room_id);
        let added = room.add_message(message);

        if added {
            self.cleanup_old_messages(&message.room_id);
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
                if let Some(old_message) = room.messages.pop_front() {
                    room.message_lookup.remove(&old_message.id);
                    // Update indices in lookup table
                    for (_, index) in room.message_lookup.iter_mut() {
                        if *index > 0 {
                            *index -= 1;
                        }
                    }
                }
            }
        }
    }

    pub fn get_room_stats(&self, room_id: &str) -> Option<(usize, usize, u64)> {
        self.rooms.get(room_id).map(|room| {
            (room.total_messages, room.unread_count, room.last_sync)
        })
    }
}

// Global message manager
thread_local! {
    static MESSAGE_MANAGER: Arc<Mutex<MessageManager>> = Arc::new(Mutex::new(MessageManager::new()));
}

fn with_message_manager<F, R>(f: F) -> Result<R, JsValue>
where
    F: FnOnce(&mut MessageManager) -> R,
{
    MESSAGE_MANAGER.with(|manager| {
        let mut manager = manager.lock().map_err(|_|
            JsValue::from_str("Failed to lock message manager"))?;
        Ok(f(&mut *manager))
    })
}
```

### 3.3 WASM Binding Functions

```rust
// Add to src/lib.rs

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
    let message = with_message_manager(|manager| {
        manager.send_message(room_id, content, message_id)
    })??;

    serde_wasm_bindgen::to_value(&message)
        .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
}

#[wasm_bindgen]
pub fn receive_message_from_peer(message_data: &JsValue) -> Result<bool, JsValue> {
    let message: EnhancedMessage = serde_wasm_bindgen::from_value(message_data.clone())
        .map_err(|e| JsValue::from_str(&format!("Failed to deserialize message: {}", e)))?;

    with_message_manager(|manager| {
        manager.receive_message(message)
    })
}

#[wasm_bindgen]
pub fn get_room_messages(room_id: &str, limit: Option<u32>) -> JsValue {
    let messages = with_message_manager(|manager| {
        manager.get_messages(room_id, limit.map(|l| l as usize))
    }).unwrap_or_default();

    serde_wasm_bindgen::to_value(&messages).unwrap_or(JsValue::NULL)
}

#[wasm_bindgen]
pub fn edit_message(room_id: &str, message_id: &str, new_content: &str) -> Result<(), JsValue> {
    with_message_manager(|manager| {
        manager.edit_message(room_id, message_id, new_content)
    })?
}

#[wasm_bindgen]
pub fn delete_message(room_id: &str, message_id: &str) -> Result<(), JsValue> {
    with_message_manager(|manager| {
        manager.delete_message(room_id, message_id)
    })?
}

#[wasm_bindgen]
pub fn add_message_reaction(
    room_id: &str,
    message_id: &str,
    emoji: &str,
    user_id: &str,
) -> Result<(), JsValue> {
    with_message_manager(|manager| {
        manager.add_reaction(room_id, message_id, emoji, user_id)
    })?
}

#[wasm_bindgen]
pub fn handle_typing_indicator(room_id: &str, user_id: &str, is_typing: bool) -> Result<(), JsValue> {
    with_message_manager(|manager| {
        manager.handle_typing_indicator(room_id, user_id, is_typing);
    })?;
    Ok(())
}

#[wasm_bindgen]
pub fn get_typing_users(room_id: &str) -> JsValue {
    let typing_users = with_message_manager(|manager| {
        manager.get_typing_users(room_id)
    }).unwrap_or_default();

    serde_wasm_bindgen::to_value(&typing_users).unwrap_or(JsValue::NULL)
}

#[wasm_bindgen]
pub fn get_messages_for_sync(
    room_id: &str,
    after_timestamp: f64,
    limit: u32,
) -> JsValue {
    let messages = with_message_manager(|manager| {
        manager.get_messages_for_sync(room_id, after_timestamp as u64, limit as usize)
    }).unwrap_or_default();

    serde_wasm_bindgen::to_value(&messages).unwrap_or(JsValue::NULL)
}

#[wasm_bindgen]
pub fn get_room_message_stats(room_id: &str) -> JsValue {
    let stats = with_message_manager(|manager| {
        manager.get_room_stats(room_id)
    }).unwrap_or_default();

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

// Legacy compatibility function
#[wasm_bindgen]
pub fn get_messages(room_id: &JsValue) -> JsValue {
    let room_id = match room_id.as_string() {
        Some(id) if !id.is_empty() => id,
        _ => return JsValue::from_str("[]"),
    };

    get_room_messages(&room_id, Some(50))
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
        requester_id: "current_user".to_string(), // Would get from user state
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
            }).unwrap_or_default();

            let response = MessageSyncRequest {
                request_type: SyncRequestType::SyncResponse { messages },
                room_id: request.room_id,
                requester_id: "current_user".to_string(),
                timestamp: js_sys::Date::now() as u64,
            };

            serde_wasm_bindgen::to_value(&response).unwrap_or(JsValue::NULL)
        },
        _ => JsValue::NULL,
    }
}
```

### 3.4 Message History Persistence

```rust
// Add to src/messages.rs for localStorage integration

use web_sys::{window, Storage};

impl MessageManager {
    pub fn save_room_to_storage(&self, room_id: &str) -> Result<(), JsValue> {
        let window = window().ok_or_else(|| JsValue::from_str("No window object"))?;
        let storage = window.local_storage()
            .map_err(|_| JsValue::from_str("No localStorage"))?
            .ok_or_else(|| JsValue::from_str("localStorage not available"))?;

        if let Some(room) = self.rooms.get(room_id) {
            let serialized = serde_json::to_string(room)
                .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))?;

            let storage_key = format!("chatHistory_{}", room_id);
            storage.set_item(&storage_key, &serialized)
                .map_err(|_| JsValue::from_str("Failed to save to localStorage"))?;

            console_log!("Saved room {} to localStorage", room_id);
        }

        Ok(())
    }

    pub fn load_room_from_storage(&mut self, room_id: &str) -> Result<bool, JsValue> {
        let window = window().ok_or_else(|| JsValue::from_str("No window object"))?;
        let storage = window.local_storage()
            .map_err(|_| JsValue::from_str("No localStorage"))?
            .ok_or_else(|| JsValue::from_str("localStorage not available"))?;

        let storage_key = format!("chatHistory_{}", room_id);

        if let Ok(Some(stored_data)) = storage.get_item(&storage_key) {
            match serde_json::from_str::<RoomMessageState>(&stored_data) {
                Ok(room_state) => {
                    self.rooms.insert(room_id.to_string(), room_state);
                    console_log!("Loaded room {} from localStorage", room_id);
                    Ok(true)
                },
                Err(e) => {
                    console_log!("Failed to deserialize room data: {}", e);
                    Ok(false)
                }
            }
        } else {
            Ok(false)
        }
    }
}

#[wasm_bindgen]
pub fn save_room_messages_to_storage(room_id: &str) -> Result<(), JsValue> {
    with_message_manager(|manager| {
        manager.save_room_to_storage(room_id)
    })?
}

#[wasm_bindgen]
pub fn load_room_messages_from_storage(room_id: &str) -> Result<bool, JsValue> {
    with_message_manager(|manager| {
        manager.load_room_from_storage(room_id)
    })?
}
```

## JavaScript Migration Steps

### Step 1: Update Message Sending
```javascript
// In js/index.js, replace sendMessage function
function sendMessage() {
  const messageInput = document.getElementById('messageInput');
  const rawMessage = messageInput.value;

  const message = window.safeWasm.validate_message(rawMessage);
  if (!message) {
    logger.warn('Message failed validation:', rawMessage);
    return;
  }

  const roomId = window.safeWasm.get_current_room_id();
  if (!roomId) {
    log('Please create or join a room first');
    return;
  }

  const messageId = window.safeWasm.generate_uuid();

  try {
    // NEW: Use enhanced message system
    const messageObj = window.safeWasm.send_message_enhanced(roomId, message, messageId);

    // Broadcast via P2P
    if (AppState.p2pConnection) {
      AppState.p2pConnection.broadcast(messageObj);
    }

    // Display in UI
    displayMessage(message, true, messageObj.sender_name, true, messageObj.timestamp);

    // Clear input
    messageInput.value = '';
    scrollChatToBottom('smooth', 50);

    // Save to storage
    window.safeWasm.save_room_messages_to_storage(roomId);
  } catch (error) {
    console.error('Error sending message:', error);
    log(`Error sending message: ${error.message}`);
  }
}
```

### Step 2: Update Message Reception
```javascript
// Update handleIncomingP2PMessage function
function handleIncomingP2PMessage(message, peerId) {
  console.log(`📨 Handling incoming P2P message from ${peerId}:`, message.type, message.id || 'no-id');

  switch (message.type) {
    case 'chat':
      // NEW: Use enhanced message system
      try {
        const added = window.safeWasm.receive_message_from_peer(message);
        if (added) {
          displayReceivedMessage(message);

          // Save to storage
          const roomId = window.safeWasm.get_current_room_id();
          if (roomId) {
            window.safeWasm.save_room_messages_to_storage(roomId);
          }
        }
      } catch (error) {
        console.error('Error processing received message:', error);
      }
      break;

    case 'typing':
      // NEW: Use Rust typing system
      window.safeWasm.handle_typing_indicator(message.room_id, peerId, true);
      updateTypingIndicators();
      break;

    case 'stopped_typing':
      window.safeWasm.handle_typing_indicator(message.room_id, peerId, false);
      updateTypingIndicators();
      break;

    // Handle other message types...
  }
}
```

### Step 3: Update History Loading
```javascript
// Replace loadChatHistory and displayChatHistory functions
async function loadAndDisplayChatHistory(roomId) {
  try {
    // Load from storage first
    await window.safeWasm.load_room_messages_from_storage(roomId);

    // Get messages from Rust
    const messages = window.safeWasm.get_room_messages(roomId, 50);

    displayChatHistory(messages);

    console.log(`Loaded ${messages.length} messages for room ${roomId}`);
  } catch (error) {
    console.error('Error loading chat history:', error);
  }
}

function displayChatHistory(messages) {
  const chatArea = document.getElementById('chatArea');
  if (!chatArea) return;

  chatArea.innerHTML = '';

  if (messages.length === 0) {
    // Show welcome message
    const welcomeMessage = document.getElementById('welcomeMessage');
    if (welcomeMessage) {
      chatArea.appendChild(welcomeMessage.cloneNode(true));
    }
  } else {
    // Display all messages
    messages.forEach(message => {
      const currentUserId = window.safeWasm.get_current_user_id();
      const isMe = message.sender_id === currentUserId;
      displayMessage(message.content, isMe, message.sender_name, false, message.timestamp);
    });

    scrollChatToBottom('auto', 100);
  }
}
```

### Step 4: Update Typing Indicators
```javascript
// Create new typing indicator system
function updateTypingIndicators() {
  const roomId = window.safeWasm.get_current_room_id();
  if (!roomId) return;

  const typingUsers = window.safeWasm.get_typing_users(roomId);
  const currentUserId = window.safeWasm.get_current_user_id();

  // Filter out current user
  const otherTypingUsers = typingUsers.filter(userId => userId !== currentUserId);

  // Update UI with typing indicators
  updateDraftsDisplay(new Map(
    otherTypingUsers.map(userId => [userId, { content: '...typing...', sender: userId }])
  ), currentUserId);
}

// Update draft message handling
function handleDraftMessage() {
  const roomId = window.safeWasm.get_current_room_id();
  if (!roomId) return;

  const messageInput = document.getElementById('messageInput');
  const content = messageInput.value;
  const currentUserId = window.safeWasm.get_current_user_id();

  try {
    // Update local typing state
    window.safeWasm.handle_typing_indicator(roomId, currentUserId, content.trim().length > 0);

    // Broadcast typing state to peers
    const p2pConnection = getP2PConnection();
    if (p2pConnection) {
      const typingMessage = {
        type: content.trim() ? 'typing' : 'stopped_typing',
        room_id: roomId,
        sender_id: currentUserId,
        timestamp: Date.now()
      };
      p2pConnection.broadcast(typingMessage);
    }
  } catch (error) {
    console.error("Error handling draft message:", error);
  }
}
```

### Step 5: Remove Old Message Functions
Remove these functions from `js/index.js`:
- `addMessageToHistory()`
- `getChatHistory()`
- `saveChatHistory()`
- `loadChatHistory()`
- `requestMessageSync()`
- `handleSyncRequest()`
- `handleSyncResponse()`

## Dependencies to Add

Add to `Cargo.toml`:

```toml
[dependencies]
regex = "1.10"
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
serde-wasm-bindgen = "0.6"

[dependencies.web-sys]
features = [
  "Window",
  "Storage",
  "console",
]
```

## Testing Strategy

### Unit Tests in Rust
```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_message_creation() {
        let message = EnhancedMessage::new(
            "msg-1".to_string(),
            "user-1".to_string(),
            "Test User".to_string(),
            "Hello world".to_string(),
            "room-1".to_string(),
        );

        assert_eq!(message.id, "msg-1");
        assert_eq!(message.content, "Hello world");
        assert_eq!(message.status, MessageStatus::Sending);
    }

    #[test]
    fn test_message_ordering() {
        let mut room = RoomMessageState::new("test-room".to_string());

        let msg1 = EnhancedMessage::new("1".to_string(), "u1".to_string(), "User".to_string(), "First".to_string(), "test-room".to_string());
        let mut msg2 = EnhancedMessage::new("2".to_string(), "u1".to_string(), "User".to_string(), "Second".to_string(), "test-room".to_string());
        msg2.timestamp = msg1.timestamp + 1000;

        room.add_message(msg2);
        room.add_message(msg1);

        let messages = room.get_recent_messages(10);
        assert_eq!(messages[0].content, "First");
        assert_eq!(messages[1].content, "Second");
    }

    #[test]
    fn test_message_editing() {
        let mut room = RoomMessageState::new("test-room".to_string());
        let message = EnhancedMessage::new("1".to_string(), "u1".to_string(), "User".to_string(), "Original".to_string(), "test-room".to_string());

        room.add_message(message);
        room.edit_message("1", "Edited".to_string());

        let edited = room.get_message("1").unwrap();
        assert_eq!(edited.content, "Edited");
        assert!(edited.edited);
        assert_eq!(edited.original_content, Some("Original".to_string()));
    }

    #[test]
    fn test_reactions() {
        let mut message = EnhancedMessage::new("1".to_string(), "u1".to_string(), "User".to_string(), "Hello".to_string(), "room".to_string());

        message.add_reaction("👍", "user1");
        message.add_reaction("👍", "user2");
        message.add_reaction("❤️", "user1");

        assert_eq!(message.reactions.len(), 2);
        assert_eq!(message.reactions.get("👍").unwrap().count, 2);
        assert_eq!(message.reactions.get("❤️").unwrap().count, 1);
    }
}
```

### Performance Tests
1. **Message Processing Speed**: Compare Rust vs JavaScript message handling
2. **Memory Usage**: Monitor memory consumption with large message histories
3. **Serialization Overhead**: Measure JS ↔ WASM data transfer costs
4. **Storage Performance**: Test localStorage read/write performance

## Success Criteria

- [ ] All message operations moved to Rust
- [ ] Message history management centralized
- [ ] Message synchronization working correctly
- [ ] Typing indicators functioning
- [ ] Performance equal or better than JavaScript
- [ ] Memory usage optimized
- [ ] Message persistence working
- [ ] All existing features preserved

## Timeline: Week 5-6 (14 days)

### Days 1-5: Core Implementation
- Implement enhanced message structures
- Create message manager in Rust
- Add WASM bindings
- Write comprehensive unit tests

### Days 6-10: Integration
- Update JavaScript message handling
- Migrate history management
- Update P2P message flow
- Test message synchronization

### Days 11-14: Optimization and Testing
- Performance optimization
- Memory usage analysis
- Integration testing
- Bug fixes and polish

## Risks and Mitigation

### Risk: Message Loss During Migration
- **Mitigation**: Comprehensive backup and restore procedures
- **Solution**: Parallel running systems during transition

### Risk: Performance Degradation
- **Mitigation**: Benchmark all operations, optimize serialization
- **Solution**: Efficient data structures and caching strategies

### Risk: Synchronization Issues
- **Mitigation**: Thorough testing of message ordering and deduplication
- **Solution**: Atomic operations and consistent state management

This phase centralizes the core chat functionality in Rust, providing better performance, consistency, and a foundation for advanced features like message search, encryption, and offline support.