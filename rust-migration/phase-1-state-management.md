# Phase 1: State Management Migration

## Overview
Move all state management from JavaScript to Rust/WASM for better performance, type safety, and consistency.

## Current State Analysis

### JavaScript State Management (`js/state.js` - 163 lines)
- **AppState object**: Contains currentUserId, currentRoomId, p2pConnection, chatHistory, messageHistory, draftMessages
- **Helper functions**: getCurrentUserId(), getCurrentRoomId(), URL helpers, UUID generation
- **localStorage integration**: User and room state persistence
- **Memory management**: Maps for chat history and draft messages

### Target Files for Migration
- `js/state.js` → Remove entirely
- Update all imports across the codebase

## Implementation Plan

### 1.1 Enhanced State Structures in Rust

```rust
// Add to src/lib.rs or create src/state.rs

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use wasm_bindgen::prelude::*;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AppConfig {
    pub min_room_id_length: usize,
    pub max_message_length: usize,
    pub max_username_length: usize,
    pub reconnect_delay: u32,
    pub max_reconnect_attempts: u32,
    pub message_sync_timeout: u32,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            min_room_id_length: 8,
            max_message_length: 2000,
            max_username_length: 32,
            reconnect_delay: 2000,
            max_reconnect_attempts: 5,
            message_sync_timeout: 5000,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct UserSession {
    pub id: String,
    pub name: String,
    pub current_room_id: Option<String>,
    pub last_activity: u64,
    pub is_typing: bool,
    pub created_at: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct DraftMessage {
    pub content: String,
    pub sender_name: String,
    pub sender_id: String,
    pub last_update: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct RoomHistory {
    pub messages: Vec<Message>,
    pub last_sync: u64,
    pub room_metadata: RoomMetadata,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct RoomMetadata {
    pub id: String,
    pub created_at: u64,
    pub last_joined: u64,
    pub display_name: String,
    pub peer_count: usize,
    pub total_messages: usize,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AppState {
    pub config: AppConfig,
    pub user_session: Option<UserSession>,
    pub current_room_id: Option<String>,
    pub room_histories: HashMap<String, RoomHistory>,
    pub draft_messages: HashMap<String, DraftMessage>, // peer_id -> draft
    pub message_history: HashMap<String, Message>, // message_id -> message (for deduplication)
    pub p2p_connected_peers: Vec<String>,
    pub is_wasm_loaded: bool,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            config: AppConfig::default(),
            user_session: None,
            current_room_id: None,
            room_histories: HashMap::new(),
            draft_messages: HashMap::new(),
            message_history: HashMap::new(),
            p2p_connected_peers: Vec::new(),
            is_wasm_loaded: true, // Will be true when this code runs
        }
    }
}

// Global state manager
thread_local! {
    static APP_STATE: Arc<Mutex<AppState>> = Arc::new(Mutex::new(AppState::default()));
}
```

### 1.2 State Management Functions

```rust
// Core state management functions

#[wasm_bindgen]
pub fn get_app_state() -> JsValue {
    APP_STATE.with(|state| {
        let state = state.lock().unwrap();
        serde_wasm_bindgen::to_value(&*state).unwrap_or(JsValue::NULL)
    })
}

#[wasm_bindgen]
pub fn get_app_config() -> JsValue {
    APP_STATE.with(|state| {
        let state = state.lock().unwrap();
        serde_wasm_bindgen::to_value(&state.config).unwrap_or(JsValue::NULL)
    })
}

#[wasm_bindgen]
pub fn get_current_user_id() -> Option<String> {
    APP_STATE.with(|state| {
        let state = state.lock().unwrap();
        state.user_session.as_ref().map(|session| session.id.clone())
    })
}

#[wasm_bindgen]
pub fn get_current_room_id() -> Option<String> {
    APP_STATE.with(|state| {
        let state = state.lock().unwrap();
        state.current_room_id.clone()
    })
}

#[wasm_bindgen]
pub fn set_current_room_id(room_id: &str) -> Result<(), JsValue> {
    APP_STATE.with(|state| {
        let mut state = state.lock().map_err(|_|
            JsValue::from_str("Failed to lock app state"))?;

        state.current_room_id = if room_id.is_empty() {
            None
        } else {
            Some(room_id.to_string())
        };

        // Update user session if exists
        if let Some(ref mut session) = state.user_session {
            session.current_room_id = state.current_room_id.clone();
            session.last_activity = js_sys::Date::now() as u64;
        }

        console_log!("Current room ID set to: {:?}", state.current_room_id);
        Ok(())
    })
}

#[wasm_bindgen]
pub fn update_user_session(name: &str, user_id: &str) -> Result<(), JsValue> {
    if name.is_empty() || user_id.is_empty() {
        return Err(JsValue::from_str("Name and user ID cannot be empty"));
    }

    APP_STATE.with(|state| {
        let mut state = state.lock().map_err(|_|
            JsValue::from_str("Failed to lock app state"))?;

        let now = js_sys::Date::now() as u64;

        let session = UserSession {
            id: user_id.to_string(),
            name: name.to_string(),
            current_room_id: state.current_room_id.clone(),
            last_activity: now,
            is_typing: false,
            created_at: state.user_session.as_ref()
                .map(|s| s.created_at)
                .unwrap_or(now),
        };

        state.user_session = Some(session);
        console_log!("User session updated: {} ({})", name, user_id);
        Ok(())
    })
}

#[wasm_bindgen]
pub fn set_typing_status(is_typing: bool) -> Result<(), JsValue> {
    APP_STATE.with(|state| {
        let mut state = state.lock().map_err(|_|
            JsValue::from_str("Failed to lock app state"))?;

        if let Some(ref mut session) = state.user_session {
            session.is_typing = is_typing;
            session.last_activity = js_sys::Date::now() as u64;
            console_log!("Typing status set to: {}", is_typing);
        }

        Ok(())
    })
}
```

### 1.3 Room History Management

```rust
#[wasm_bindgen]
pub fn get_room_history_list() -> JsValue {
    APP_STATE.with(|state| {
        let state = state.lock().unwrap();

        // Convert room histories to a simplified list for JavaScript
        let room_list: Vec<_> = state.room_histories
            .values()
            .map(|history| &history.room_metadata)
            .collect();

        serde_wasm_bindgen::to_value(&room_list).unwrap_or(JsValue::NULL)
    })
}

#[wasm_bindgen]
pub fn add_room_to_history(room_id: &str, display_name: Option<String>) -> Result<(), JsValue> {
    if room_id.is_empty() {
        return Err(JsValue::from_str("Room ID cannot be empty"));
    }

    APP_STATE.with(|state| {
        let mut state = state.lock().map_err(|_|
            JsValue::from_str("Failed to lock app state"))?;

        let now = js_sys::Date::now() as u64;
        let display_name = display_name.unwrap_or_else(|| room_id.to_string());

        // Update existing or create new room history
        let room_history = state.room_histories.entry(room_id.to_string())
            .or_insert_with(|| RoomHistory {
                messages: Vec::new(),
                last_sync: 0,
                room_metadata: RoomMetadata {
                    id: room_id.to_string(),
                    created_at: now,
                    last_joined: now,
                    display_name: display_name.clone(),
                    peer_count: 0,
                    total_messages: 0,
                },
            });

        // Update metadata
        room_history.room_metadata.last_joined = now;
        room_history.room_metadata.display_name = display_name;

        console_log!("Added room to history: {}", room_id);
        Ok(())
    })
}

#[wasm_bindgen]
pub fn remove_room_from_history(room_id: &str) -> Result<(), JsValue> {
    APP_STATE.with(|state| {
        let mut state = state.lock().map_err(|_|
            JsValue::from_str("Failed to lock app state"))?;

        state.room_histories.remove(room_id);
        console_log!("Removed room from history: {}", room_id);
        Ok(())
    })
}

#[wasm_bindgen]
pub fn get_room_metadata(room_id: &str) -> JsValue {
    APP_STATE.with(|state| {
        let state = state.lock().unwrap();

        state.room_histories
            .get(room_id)
            .map(|history| &history.room_metadata)
            .map(|metadata| serde_wasm_bindgen::to_value(metadata).unwrap_or(JsValue::NULL))
            .unwrap_or(JsValue::NULL)
    })
}
```

### 1.4 Draft Messages Management

```rust
#[wasm_bindgen]
pub fn get_draft_messages() -> JsValue {
    APP_STATE.with(|state| {
        let state = state.lock().unwrap();
        serde_wasm_bindgen::to_value(&state.draft_messages).unwrap_or(JsValue::NULL)
    })
}

#[wasm_bindgen]
pub fn set_draft_message(peer_id: &str, content: &str, sender_name: &str) -> Result<(), JsValue> {
    if peer_id.is_empty() {
        return Err(JsValue::from_str("Peer ID cannot be empty"));
    }

    APP_STATE.with(|state| {
        let mut state = state.lock().map_err(|_|
            JsValue::from_str("Failed to lock app state"))?;

        if content.trim().is_empty() {
            // Remove draft if content is empty
            state.draft_messages.remove(peer_id);
        } else {
            let draft = DraftMessage {
                content: content.to_string(),
                sender_name: sender_name.to_string(),
                sender_id: peer_id.to_string(),
                last_update: js_sys::Date::now() as u64,
            };
            state.draft_messages.insert(peer_id.to_string(), draft);
        }

        Ok(())
    })
}

#[wasm_bindgen]
pub fn clear_draft_message(peer_id: &str) -> Result<(), JsValue> {
    APP_STATE.with(|state| {
        let mut state = state.lock().map_err(|_|
            JsValue::from_str("Failed to lock app state"))?;

        state.draft_messages.remove(peer_id);
        Ok(())
    })
}

#[wasm_bindgen]
pub fn clear_all_draft_messages() -> Result<(), JsValue> {
    APP_STATE.with(|state| {
        let mut state = state.lock().map_err(|_|
            JsValue::from_str("Failed to lock app state"))?;

        state.draft_messages.clear();
        console_log!("All draft messages cleared");
        Ok(())
    })
}
```

### 1.5 P2P State Management

```rust
#[wasm_bindgen]
pub fn get_connected_peers() -> JsValue {
    APP_STATE.with(|state| {
        let state = state.lock().unwrap();
        serde_wasm_bindgen::to_value(&state.p2p_connected_peers).unwrap_or(JsValue::NULL)
    })
}

#[wasm_bindgen]
pub fn add_connected_peer(peer_id: &str) -> Result<(), JsValue> {
    if peer_id.is_empty() {
        return Err(JsValue::from_str("Peer ID cannot be empty"));
    }

    APP_STATE.with(|state| {
        let mut state = state.lock().map_err(|_|
            JsValue::from_str("Failed to lock app state"))?;

        if !state.p2p_connected_peers.contains(&peer_id.to_string()) {
            state.p2p_connected_peers.push(peer_id.to_string());

            // Update room metadata if in a room
            if let Some(room_id) = &state.current_room_id {
                if let Some(room_history) = state.room_histories.get_mut(room_id) {
                    room_history.room_metadata.peer_count = state.p2p_connected_peers.len();
                }
            }

            console_log!("Added connected peer: {}", peer_id);
        }

        Ok(())
    })
}

#[wasm_bindgen]
pub fn remove_connected_peer(peer_id: &str) -> Result<(), JsValue> {
    APP_STATE.with(|state| {
        let mut state = state.lock().map_err(|_|
            JsValue::from_str("Failed to lock app state"))?;

        state.p2p_connected_peers.retain(|p| p != peer_id);

        // Clear any draft messages from this peer
        state.draft_messages.remove(peer_id);

        // Update room metadata if in a room
        if let Some(room_id) = &state.current_room_id {
            if let Some(room_history) = state.room_histories.get_mut(room_id) {
                room_history.room_metadata.peer_count = state.p2p_connected_peers.len();
            }
        }

        console_log!("Removed connected peer: {}", peer_id);
        Ok(())
    })
}

#[wasm_bindgen]
pub fn clear_all_connected_peers() -> Result<(), JsValue> {
    APP_STATE.with(|state| {
        let mut state = state.lock().map_err(|_|
            JsValue::from_str("Failed to lock app state"))?;

        state.p2p_connected_peers.clear();
        state.draft_messages.clear();

        // Update room metadata if in a room
        if let Some(room_id) = &state.current_room_id {
            if let Some(room_history) = state.room_histories.get_mut(room_id) {
                room_history.room_metadata.peer_count = 0;
            }
        }

        console_log!("All connected peers cleared");
        Ok(())
    })
}
```

### 1.6 URL and Utility Functions

```rust
#[wasm_bindgen]
pub fn generate_uuid() -> String {
    // Use crypto.randomUUID() through web-sys if available, fallback to manual generation
    let window = web_sys::window().unwrap();
    let crypto = window.crypto().unwrap();

    // Generate 16 random bytes
    let mut bytes = [0u8; 16];
    crypto.get_random_values_with_u8_array(&mut bytes).unwrap();

    // Set version (4) and variant bits
    bytes[6] = (bytes[6] & 0x0F) | 0x40; // Version 4
    bytes[8] = (bytes[8] & 0x3F) | 0x80; // Variant 10

    // Format as UUID string
    format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        bytes[0], bytes[1], bytes[2], bytes[3],
        bytes[4], bytes[5],
        bytes[6], bytes[7],
        bytes[8], bytes[9],
        bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15]
    )
}

#[wasm_bindgen]
pub fn get_room_from_url() -> Option<String> {
    let window = web_sys::window()?;
    let location = window.location();
    let search = location.search().ok()?;

    if search.is_empty() {
        return None;
    }

    // Parse URL parameters manually
    let params = search.strip_prefix('?').unwrap_or(&search);
    for param in params.split('&') {
        if let Some((key, value)) = param.split_once('=') {
            if key == "r" {
                // URL decode the value
                let decoded = js_sys::decode_uri_component(value).ok()?;
                return Some(decoded.into());
            }
        }
    }

    None
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
```

## JavaScript Migration Steps

### Step 1: Update Imports
Replace all imports from `state.js` across the codebase:

```javascript
// Old imports - REMOVE THESE
import {
  getCurrentUserId,
  getCurrentRoomId,
  setCurrentUserId,
  setCurrentRoomId,
  generateUUID,
  getRoomFromURL,
  updateURLWithRoom,
  // ... etc
} from './state.js';

// New - use WASM functions directly
// No imports needed, functions available via window.safeWasm
```

### Step 2: Update Function Calls
Replace JavaScript state calls with WASM calls:

```javascript
// Old JavaScript calls
const userId = getCurrentUserId();
const roomId = getCurrentRoomId();
setCurrentRoomId('new-room-id');
const uuid = generateUUID();

// New WASM calls
const userId = window.safeWasm.get_current_user_id();
const roomId = window.safeWasm.get_current_room_id();
window.safeWasm.set_current_room_id('new-room-id');
const uuid = window.safeWasm.generate_uuid();
```

### Step 3: Update State Access Patterns
```javascript
// Old AppState usage
import { AppState } from './state.js';
const drafts = AppState.draftMessages;
const history = AppState.chatHistory;

// New WASM state access
const drafts = window.safeWasm.get_draft_messages();
const history = window.safeWasm.get_room_history_list();
```

### Step 4: Remove state.js
After updating all references, delete `js/state.js` completely.

## Dependencies to Add

Add to `Cargo.toml`:

```toml
[dependencies]
uuid = { version = "1.0", features = ["v4", "js"] }
serde-wasm-bindgen = "0.6"

[dependencies.web-sys]
features = [
  "Window",
  "Location",
  "History",
  "Crypto",
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
    fn test_user_session_creation() {
        let result = update_user_session("Test User", "test-user-id");
        assert!(result.is_ok());

        let user_id = get_current_user_id();
        assert_eq!(user_id, Some("test-user-id".to_string()));
    }

    #[test]
    fn test_room_history_management() {
        let room_id = "test-room";
        let result = add_room_to_history(room_id, Some("Test Room".to_string()));
        assert!(result.is_ok());

        let metadata = get_room_metadata(room_id);
        assert!(!metadata.is_null());
    }

    #[test]
    fn test_draft_messages() {
        let peer_id = "test-peer";
        let content = "Hello world";
        let sender = "Test User";

        let result = set_draft_message(peer_id, content, sender);
        assert!(result.is_ok());

        let drafts = get_draft_messages();
        assert!(!drafts.is_null());

        clear_draft_message(peer_id).unwrap();
        let drafts_after = get_draft_messages();
        // Should be empty object or no longer contain our peer
    }
}
```

### Integration Tests
1. **State Persistence**: Verify state survives page reloads
2. **Cross-function Consistency**: Ensure all state functions work together
3. **Performance**: Measure WASM call overhead vs JavaScript
4. **Memory**: Monitor memory usage patterns

## Success Criteria

- [ ] All state management moved to Rust
- [ ] `js/state.js` file deleted
- [ ] All JavaScript files updated to use WASM state functions
- [ ] No functionality lost
- [ ] Performance equal or better than JavaScript version
- [ ] Memory usage equal or better
- [ ] All tests passing

## Timeline: Week 1-2 (14 days)

### Days 1-3: Rust Implementation
- Implement all Rust state structures and functions
- Add WASM bindings
- Write unit tests

### Days 4-7: JavaScript Integration
- Update `safeWasmCall` factory to include new functions
- Update imports across all JavaScript files
- Test basic functionality

### Days 8-10: Migration and Testing
- Remove `js/state.js`
- Fix any remaining references
- Integration testing

### Days 11-14: Validation and Optimization
- Performance testing and comparison
- Memory usage analysis
- Bug fixes and optimization
- Documentation updates

## Risks and Mitigation

### Risk: Performance Degradation
- **Mitigation**: Benchmark before/after, optimize serialization
- **Fallback**: Keep JavaScript version available for quick rollback

### Risk: Serialization Overhead
- **Mitigation**: Use efficient serde-wasm-bindgen, minimize large object transfers
- **Solution**: Cache frequently accessed state in JavaScript when needed

### Risk: State Synchronization Issues
- **Mitigation**: Comprehensive testing of state consistency
- **Solution**: Clear ownership model - Rust owns state, JavaScript reads/writes via functions

This phase lays the foundation for all subsequent migrations by establishing a robust, type-safe state management system in Rust.