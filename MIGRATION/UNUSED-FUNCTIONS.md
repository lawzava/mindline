# Unused Rust/WASM Functions

## Overview
77 Rust functions are exported to WASM but never called from JavaScript. These represent significant untapped functionality.

## Categories and Functions

### State Management (11 functions)
```rust
add_connected_peer(peer_id: String)
get_app_config() -> JsValue
get_app_state() -> JsValue
get_current_room_id() -> Option<String>
get_current_user_id() -> Option<String>
get_connected_peers() -> Vec<String>
remove_connected_peer(peer_id: String)
clear_all_connected_peers()
set_current_room_id(room_id: String)
set_typing_status(is_typing: bool)
update_user_session(user_id: String, user_name: String)
```

### Room & Message Management (15 functions)
```rust
add_room_to_history(room_id: String)
remove_room_from_history(room_id: String)
get_room_history_list() -> Vec<String>
get_room_metadata(room_id: String) -> JsValue
get_stored_messages(room_id: String) -> Vec<JsValue>
get_stored_room(room_id: String) -> Option<JsValue>
get_messages(room_id: String) -> Vec<JsValue>
get_messages_for_sync(room_id: String) -> Vec<JsValue>
get_room_message_stats(room_id: String) -> JsValue
store_message_persistent(room_id: String, message: JsValue)
store_room_persistent(room_id: String, room_data: JsValue)
save_room_messages_to_storage(room_id: String, messages: String)
add_message_reaction(message_id: String, reaction: String)
edit_message(message_id: String, new_content: String)
delete_message(message_id: String)
```

### Draft Messages (4 functions)
```rust
get_draft_messages(room_id: String) -> Vec<JsValue>
clear_draft_message(room_id: String)
clear_all_draft_messages()
save_draft_message(room_id: String, content: String)
```

### Validation Functions (10 functions)
```rust
validate_room_id(room_id: String) -> JsValue
validate_username(username: String) -> JsValue
validate_message(message: String) -> JsValue
validate_url_param(param: String) -> bool
validate_file(file_data: Vec<u8>) -> JsValue
detect_attack_patterns(input: String) -> bool
validate_json_input(json: String) -> bool
validate_input_batch(inputs: Vec<String>) -> Vec<bool>
sanitize_html_content(html: String) -> String
check_rate_limit(user_id: String, action: String) -> bool
```

### Logging Functions (15 functions)
```rust
log_debug(message: String)
log_error(message: String)
log_info(message: String)
log_warn(message: String)
log_table(data: JsValue)
log_with_data(level: String, message: String, data: JsValue)
search_logs(query: String) -> Vec<JsValue>
get_log_statistics() -> JsValue
export_logs_json() -> String
clear_log_buffer()
get_error_summary() -> JsValue
create_debug_report() -> String
configure_logger(config: JsValue)
get_log_entries(count: u32) -> Vec<JsValue>
get_logs_by_component(component: String) -> Vec<JsValue>
```

### P2P Network Functions (8 functions)
```rust
get_broadcast_plan(message_type: String) -> JsValue
get_connected_peer_list() -> Vec<String>
get_connection_decision(peer_id: String) -> String
record_peer_message_received(peer_id: String, message_type: String)
record_performance_metric(metric: String, value: f64)
should_initiate_connection_to_peer(peer_id: String) -> bool
set_connection_strategy(strategy: String)
start_performance_monitoring()
```

### Utility Functions (8 functions)
```rust
generate_uuid() -> String
generate_secure_room_id() -> String
get_room_from_url() -> Option<String>
initialize_storage()
cleanup_old_storage_data(days_old: u32)
start_log_group(label: String)
end_log_group()
export_recent_logs_json(minutes: u32) -> String
```

### Encryption Functions (4 functions)
```rust
encrypt_message_content(content: String) -> String
decrypt_message_content(encrypted: String) -> String
export_encryption_key() -> String
import_encryption_key(key: String)
```

### Core Functions (2 functions)
```rust
send_message(content: String) -> Result<(), JsValue>
send_typing_indicator(is_typing: bool) -> Result<(), JsValue>
```

## Usage Priority

### High Priority (Use Immediately)
- `validate_*` functions - Phase 2
- State management functions - Phase 3
- Message management functions - Phase 4

### Medium Priority (Use After Migration)
- Logging functions - Phase 5
- P2P coordination - Phase 5
- Encryption functions - Phase 5

### Low Priority (Future Enhancement)
- Performance monitoring
- Analytics functions
- Debug utilities

## Implementation Notes

### Adding Proxy Wrappers
Each function needs a proxy in `js/wasm-manager.js`:

```javascript
window.safeWasm.function_name = safeWasmCall(
  () => wasm.function_name(...arguments),
  'function_name',
  ['param1', 'param2'] // parameter names for logging
);
```

### Testing Function Availability
```javascript
// Check if function exists
if (window.safeWasm && window.safeWasm.function_name) {
  // Use the function
  const result = window.safeWasm.function_name(param);
}
```

### Common Issues
1. **Type Mismatch**: Ensure JS types match Rust expectations
2. **Missing Proxy**: Function exists in Rust but no JS proxy
3. **Null Returns**: Some functions return Option<T> which becomes null in JS
4. **Array Handling**: Vec<T> becomes JavaScript array

## Verification Script

```javascript
// Run in browser console to check which functions are available
const rustFunctions = [
  'add_connected_peer', 'get_app_config', 'get_app_state',
  // ... add all 77 function names
];

const available = [];
const missing = [];

rustFunctions.forEach(func => {
  if (window.safeWasm && typeof window.safeWasm[func] === 'function') {
    available.push(func);
  } else {
    missing.push(func);
  }
});

console.log(`Available: ${available.length}/${rustFunctions.length}`);
console.log('Missing functions:', missing);
```

---

⚠️ **Note**: These functions are already implemented in Rust but need JavaScript proxy wrappers and integration code to be useful.