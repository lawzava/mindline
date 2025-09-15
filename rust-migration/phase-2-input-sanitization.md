# Phase 2: Input Sanitization and Validation Migration

## Overview
Move all input validation and sanitization from JavaScript to Rust for enhanced security, performance, and consistency. This phase focuses on preventing XSS attacks, injection vulnerabilities, and ensuring data integrity at the WASM boundary.

## Current State Analysis

### JavaScript Sanitization (`js/sanitizer.js` - 244 lines)
- **InputSanitizer class**: Comprehensive input validation and sanitization
- **HTML sanitization**: XSS prevention, dangerous element removal
- **Validation functions**: Room ID, username, message, URL parameter validation
- **Rate limiting**: localStorage-based rate limiting system
- **File validation**: For future file sharing features
- **Security features**: Secure room ID generation, cryptographic operations

### Security Benefits of Rust Migration
- **Memory safety**: Prevents buffer overflows and memory corruption
- **Type safety**: Compile-time validation of input types
- **Performance**: Faster regex and string operations
- **Consistency**: Same validation logic across all platforms
- **Auditability**: Compiled validation logic is harder to tamper with

## Implementation Plan

### 2.1 Core Sanitization Module

```rust
// Create src/sanitizer.rs

use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use wasm_bindgen::prelude::*;
use web_sys::Storage;

#[derive(Debug, Clone)]
pub struct InputSanitizer {
    room_id_regex: Regex,
    username_regex: Regex,
    dangerous_html_regex: Regex,
    javascript_regex: Regex,
    rate_limits: HashMap<String, RateLimitData>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct RateLimitData {
    attempts: Vec<u64>,
    window_start: u64,
}

impl InputSanitizer {
    pub fn new() -> Result<Self, JsValue> {
        Ok(Self {
            room_id_regex: Regex::new(r"^[a-zA-Z0-9_-]{8,64}$")
                .map_err(|e| JsValue::from_str(&format!("Failed to create room ID regex: {}", e)))?,
            username_regex: Regex::new(r"^[^<>'"&\x00-\x1f\x7f]{1,32}$")
                .map_err(|e| JsValue::from_str(&format!("Failed to create username regex: {}", e)))?,
            dangerous_html_regex: Regex::new(
                r"(?i)<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>|on\w+\s*=|javascript:|vbscript:|data:|<iframe|<object|<embed|<form"
            ).map_err(|e| JsValue::from_str(&format!("Failed to create HTML regex: {}", e)))?,
            javascript_regex: Regex::new(r"(?i)javascript:|data:|vbscript:")
                .map_err(|e| JsValue::from_str(&format!("Failed to create JS regex: {}", e)))?,
            rate_limits: HashMap::new(),
        })
    }

    /// Validate and sanitize room ID
    pub fn validate_room_id(&self, room_id: &str) -> Option<String> {
        if room_id.is_empty() {
            return None;
        }

        // Remove any potentially dangerous characters
        let sanitized: String = room_id
            .chars()
            .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_')
            .collect();

        // Check length constraints
        if sanitized.len() < 8 || sanitized.len() > 64 {
            return None;
        }

        // Validate against regex
        if self.room_id_regex.is_match(&sanitized) {
            Some(sanitized)
        } else {
            None
        }
    }

    /// Validate and sanitize username
    pub fn validate_username(&self, username: &str) -> Option<String> {
        if username.is_empty() {
            return None;
        }

        let trimmed = username.trim();
        if trimmed.is_empty() {
            return None;
        }

        // Remove dangerous characters
        let sanitized: String = trimmed
            .chars()
            .filter(|c| !matches!(*c, '<' | '>' | '\'' | '"' | '&' | '\x00'..='\x1f' | '\x7f'))
            .collect();

        if sanitized.is_empty() || sanitized.len() > 32 {
            return None;
        }

        Some(sanitized)
    }

    /// Validate and sanitize chat message
    pub fn validate_message(&self, message: &str) -> Option<String> {
        if message.is_empty() {
            return None;
        }

        let trimmed = message.trim();
        if trimmed.is_empty() {
            return None;
        }

        // Check length limit
        let sanitized = if trimmed.len() > 2000 {
            &trimmed[..2000]
        } else {
            trimmed
        };

        // Sanitize HTML content
        let html_sanitized = self.sanitize_html(sanitized);

        if html_sanitized.trim().is_empty() {
            None
        } else {
            Some(html_sanitized)
        }
    }

    /// Sanitize HTML content to prevent XSS
    pub fn sanitize_html(&self, input: &str) -> String {
        // First pass: remove script tags and dangerous patterns
        let mut sanitized = self.dangerous_html_regex.replace_all(input, "").to_string();

        // Remove javascript: protocols
        sanitized = self.javascript_regex.replace_all(&sanitized, "").to_string();

        // HTML entity encoding for remaining content
        sanitized = sanitized
            .replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;")
            .replace('"', "&quot;")
            .replace('\'', "&#x27;");

        // Remove null bytes and other control characters
        sanitized.chars()
            .filter(|c| !matches!(*c, '\x00'..='\x08' | '\x0B' | '\x0C' | '\x0E'..='\x1F' | '\x7F'))
            .collect()
    }

    /// Validate URL parameters
    pub fn validate_url_param(&self, param: &str) -> Option<String> {
        if param.is_empty() || param.len() > 128 {
            return None;
        }

        // Remove dangerous characters
        let sanitized: String = param
            .chars()
            .filter(|c| !matches!(*c, '<' | '>' | '\'' | '"' | '&'))
            .collect();

        if sanitized.is_empty() {
            None
        } else {
            Some(sanitized)
        }
    }

    /// Generate cryptographically secure room ID
    pub fn generate_secure_room_id(&self) -> Result<String, JsValue> {
        // Get window crypto
        let window = web_sys::window()
            .ok_or_else(|| JsValue::from_str("No window object"))?;
        let crypto = window.crypto()
            .map_err(|_| JsValue::from_str("No crypto object"))?;

        // Generate 16 random bytes (128 bits)
        let mut array = [0u8; 16];
        crypto.get_random_values_with_u8_array(&mut array)
            .map_err(|_| JsValue::from_str("Failed to generate random bytes"))?;

        // Convert to hex string
        let hex: String = array
            .iter()
            .map(|byte| format!("{:02x}", byte))
            .collect();

        // Add readable prefix
        Ok(format!("room-{}", hex))
    }

    /// Validate file for future file sharing feature
    pub fn validate_file(&self, file_name: &str, file_size: u64, mime_type: &str) -> bool {
        // Check file size (max 10MB)
        if file_size > 10 * 1024 * 1024 {
            return false;
        }

        // Check file name
        if file_name.is_empty() || file_name.len() > 255 {
            return false;
        }

        // Check for dangerous file names
        if file_name.contains("..") || file_name.starts_with('.') {
            return false;
        }

        // Allowed MIME types
        let allowed_types = [
            "image/jpeg", "image/png", "image/gif", "image/webp",
            "text/plain", "application/pdf",
            "audio/mpeg", "audio/wav", "audio/ogg",
            "video/mp4", "video/webm", "video/ogg"
        ];

        allowed_types.contains(&mime_type)
    }
}

// Global sanitizer instance
thread_local! {
    static SANITIZER: std::cell::RefCell<Option<InputSanitizer>> = std::cell::RefCell::new(None);
}

fn with_sanitizer<F, R>(f: F) -> Result<R, JsValue>
where
    F: FnOnce(&InputSanitizer) -> R,
{
    SANITIZER.with(|s| {
        let mut sanitizer_ref = s.borrow_mut();
        if sanitizer_ref.is_none() {
            *sanitizer_ref = Some(InputSanitizer::new()?);
        }
        Ok(f(sanitizer_ref.as_ref().unwrap()))
    })
}
```

### 2.2 Rate Limiting System

```rust
// Add to sanitizer.rs

impl InputSanitizer {
    /// Check rate limiting for a specific action
    pub fn check_rate_limit(
        &mut self,
        key: &str,
        max_attempts: u32,
        window_ms: u32
    ) -> Result<bool, JsValue> {
        let now = js_sys::Date::now() as u64;
        let window_start = now.saturating_sub(window_ms as u64);

        // Try to get from localStorage first, then fall back to memory
        let storage_key = format!("rate_limit_{}", key);
        let mut rate_data = self.load_rate_limit_from_storage(&storage_key)
            .unwrap_or_else(|| RateLimitData {
                attempts: Vec::new(),
                window_start: now,
            });

        // Clean old attempts outside the window
        rate_data.attempts.retain(|&timestamp| timestamp > window_start);

        // Check if limit exceeded
        if rate_data.attempts.len() >= max_attempts as usize {
            return Ok(false);
        }

        // Add current attempt
        rate_data.attempts.push(now);

        // Save back to storage and memory
        self.save_rate_limit_to_storage(&storage_key, &rate_data);
        self.rate_limits.insert(key.to_string(), rate_data);

        Ok(true)
    }

    fn load_rate_limit_from_storage(&self, key: &str) -> Option<RateLimitData> {
        let window = web_sys::window()?;
        let storage = window.local_storage().ok()??;
        let stored_str = storage.get_item(key).ok()??;
        serde_json::from_str(&stored_str).ok()
    }

    fn save_rate_limit_to_storage(&self, key: &str, data: &RateLimitData) {
        if let Some(window) = web_sys::window() {
            if let Ok(Some(storage)) = window.local_storage() {
                if let Ok(serialized) = serde_json::to_string(data) {
                    let _ = storage.set_item(key, &serialized);
                }
            }
        }
    }
}
```

### 2.3 WASM Binding Functions

```rust
// Add to src/lib.rs

#[wasm_bindgen]
pub fn validate_room_id(room_id: &str) -> JsValue {
    match with_sanitizer(|s| s.validate_room_id(room_id)) {
        Ok(Some(valid_id)) => JsValue::from_str(&valid_id),
        Ok(None) => JsValue::NULL,
        Err(e) => {
            console_log!("Error validating room ID: {:?}", e);
            JsValue::NULL
        }
    }
}

#[wasm_bindgen]
pub fn validate_username(username: &str) -> JsValue {
    match with_sanitizer(|s| s.validate_username(username)) {
        Ok(Some(valid_name)) => JsValue::from_str(&valid_name),
        Ok(None) => JsValue::NULL,
        Err(e) => {
            console_log!("Error validating username: {:?}", e);
            JsValue::NULL
        }
    }
}

#[wasm_bindgen]
pub fn validate_message(message: &str) -> JsValue {
    match with_sanitizer(|s| s.validate_message(message)) {
        Ok(Some(valid_message)) => JsValue::from_str(&valid_message),
        Ok(None) => JsValue::NULL,
        Err(e) => {
            console_log!("Error validating message: {:?}", e);
            JsValue::NULL
        }
    }
}

#[wasm_bindgen]
pub fn sanitize_html_content(html: &str) -> String {
    with_sanitizer(|s| s.sanitize_html(html))
        .unwrap_or_else(|_| html.to_string())
}

#[wasm_bindgen]
pub fn validate_url_param(param: &str) -> JsValue {
    match with_sanitizer(|s| s.validate_url_param(param)) {
        Ok(Some(valid_param)) => JsValue::from_str(&valid_param),
        Ok(None) => JsValue::NULL,
        Err(e) => {
            console_log!("Error validating URL param: {:?}", e);
            JsValue::NULL
        }
    }
}

#[wasm_bindgen]
pub fn generate_secure_room_id() -> Result<String, JsValue> {
    with_sanitizer(|s| s.generate_secure_room_id())?
}

#[wasm_bindgen]
pub fn check_rate_limit(key: &str, max_attempts: u32, window_ms: u32) -> bool {
    SANITIZER.with(|s| {
        let mut sanitizer_ref = s.borrow_mut();
        if sanitizer_ref.is_none() {
            if let Ok(new_sanitizer) = InputSanitizer::new() {
                *sanitizer_ref = Some(new_sanitizer);
            } else {
                return false;
            }
        }

        sanitizer_ref
            .as_mut()
            .unwrap()
            .check_rate_limit(key, max_attempts, window_ms)
            .unwrap_or(false)
    })
}

#[wasm_bindgen]
pub fn validate_file(file_name: &str, file_size: f64, mime_type: &str) -> bool {
    with_sanitizer(|s| s.validate_file(file_name, file_size as u64, mime_type))
        .unwrap_or(false)
}

// Utility function for batch validation
#[wasm_bindgen]
pub fn validate_input_batch(input_type: &str, values: &JsValue) -> JsValue {
    let values: Vec<String> = serde_wasm_bindgen::from_value(values.clone())
        .unwrap_or_default();

    let results: Vec<Option<String>> = values
        .iter()
        .map(|value| {
            match input_type {
                "room_id" => with_sanitizer(|s| s.validate_room_id(value)).unwrap_or(None),
                "username" => with_sanitizer(|s| s.validate_username(value)).unwrap_or(None),
                "message" => with_sanitizer(|s| s.validate_message(value)).unwrap_or(None),
                "url_param" => with_sanitizer(|s| s.validate_url_param(value)).unwrap_or(None),
                _ => None,
            }
        })
        .collect();

    serde_wasm_bindgen::to_value(&results).unwrap_or(JsValue::NULL)
}
```

### 2.4 Enhanced Security Features

```rust
// Add to sanitizer.rs for additional security features

impl InputSanitizer {
    /// Detect potential SQL injection patterns (for future database features)
    pub fn detect_sql_injection(&self, input: &str) -> bool {
        let sql_patterns = [
            r"(?i)\b(union|select|insert|update|delete|drop|exec|execute)\b",
            r"(?i)\b(script|javascript|vbscript)\b",
            r"[;'\"\\]",
            r"(?i)\b(or|and)\b\s*\d+\s*=\s*\d+",
            r"(?i)\b(or|and)\b\s*['\"].*['\"]",
        ];

        for pattern in &sql_patterns {
            if let Ok(regex) = Regex::new(pattern) {
                if regex.is_match(input) {
                    return true;
                }
            }
        }
        false
    }

    /// Validate and sanitize JSON input
    pub fn validate_json(&self, json_str: &str, max_size: usize) -> Option<String> {
        if json_str.len() > max_size {
            return None;
        }

        // Try to parse as JSON to ensure validity
        if let Ok(_parsed) = serde_json::from_str::<serde_json::Value>(json_str) {
            // Basic sanitization - remove potential script injection
            let sanitized = self.sanitize_html(json_str);
            Some(sanitized)
        } else {
            None
        }
    }

    /// Check for common attack patterns
    pub fn detect_attack_patterns(&self, input: &str) -> Vec<String> {
        let mut detected_patterns = Vec::new();

        // XSS patterns
        if self.dangerous_html_regex.is_match(input) {
            detected_patterns.push("xss".to_string());
        }

        // SQL injection patterns
        if self.detect_sql_injection(input) {
            detected_patterns.push("sql_injection".to_string());
        }

        // Path traversal
        if input.contains("../") || input.contains("..\\") {
            detected_patterns.push("path_traversal".to_string());
        }

        // Command injection
        if input.contains('|') || input.contains('&') || input.contains(';') {
            detected_patterns.push("command_injection".to_string());
        }

        detected_patterns
    }
}

// Additional WASM bindings for security features
#[wasm_bindgen]
pub fn detect_attack_patterns(input: &str) -> JsValue {
    let patterns = with_sanitizer(|s| s.detect_attack_patterns(input))
        .unwrap_or_default();
    serde_wasm_bindgen::to_value(&patterns).unwrap_or(JsValue::NULL)
}

#[wasm_bindgen]
pub fn validate_json_input(json_str: &str, max_size: u32) -> JsValue {
    match with_sanitizer(|s| s.validate_json(json_str, max_size as usize)) {
        Ok(Some(valid_json)) => JsValue::from_str(&valid_json),
        Ok(None) => JsValue::NULL,
        Err(_) => JsValue::NULL,
    }
}
```

## JavaScript Migration Steps

### Step 1: Update Safe WASM Proxy
Add sanitization functions to the safe WASM proxy:

```javascript
// In js/index.js, update createSafeWasmProxies()
function createSafeWasmProxies() {
  if (!IndexState.wasmModule) {
    logger.warn("WASM module not loaded, cannot create safe proxies");
    return;
  }

  window.safeWasm = {
    // Existing functions...
    initialize: safeWasmCall('initialize', ['userName', 'userId']),

    // New sanitization functions
    validate_room_id: safeWasmCall('validate_room_id', ['roomId']),
    validate_username: safeWasmCall('validate_username', ['username']),
    validate_message: safeWasmCall('validate_message', ['message']),
    sanitize_html_content: safeWasmCall('sanitize_html_content', ['html']),
    validate_url_param: safeWasmCall('validate_url_param', ['param']),
    generate_secure_room_id: safeWasmCall('generate_secure_room_id', []),
    check_rate_limit: safeWasmCall('check_rate_limit', ['key', 'maxAttempts', 'windowMs']),
    validate_file: safeWasmCall('validate_file', ['fileName', 'fileSize', 'mimeType']),
    detect_attack_patterns: safeWasmCall('detect_attack_patterns', ['input']),
    validate_json_input: safeWasmCall('validate_json_input', ['jsonStr', 'maxSize']),
  };

  log("Safe WASM function proxies created with sanitization support");
}
```

### Step 2: Replace Sanitizer Calls
Update all files that use the sanitizer:

```javascript
// Old sanitizer usage - REMOVE THESE
import sanitizer from './sanitizer.js';
const validRoomId = sanitizer.validateRoomId(roomId);
const validUsername = sanitizer.validateUsername(username);
const validMessage = sanitizer.validateMessage(message);

// New WASM usage
const validRoomId = window.safeWasm.validate_room_id(roomId);
const validUsername = window.safeWasm.validate_username(username);
const validMessage = window.safeWasm.validate_message(message);
```

### Step 3: Update Specific Use Cases

#### In `js/index.js`:
```javascript
// Replace sendMessage function validation
function sendMessage() {
  const messageInput = document.getElementById('messageInput');
  const rawMessage = messageInput.value;

  // OLD: const message = sanitizer.validateMessage(rawMessage);
  // NEW:
  const message = window.safeWasm.validate_message(rawMessage);

  if (!message) {
    logger.warn('Message failed validation:', rawMessage);
    return;
  }

  // Continue with rest of function...
}

// Replace room validation
async function joinRoom(roomId) {
  // OLD: const sanitizedRoomId = sanitizer.validateRoomId(roomId);
  // NEW:
  const sanitizedRoomId = window.safeWasm.validate_room_id(roomId);

  if (!sanitizedRoomId) {
    log('Invalid room ID format');
    return null;
  }

  // OLD: if (!sanitizer.checkRateLimit(`join_room_${sanitizedRoomId}`, 5, 30000)) {
  // NEW:
  if (!window.safeWasm.check_rate_limit(`join_room_${sanitizedRoomId}`, 5, 30000)) {
    log('Too many join attempts. Please wait before trying again.');
    return null;
  }

  // Continue with rest of function...
}
```

#### In user initialization:
```javascript
function handleInitializeUser(userName = null) {
  if (!userName) {
    userName = document.getElementById('userName').value || 'Anonymous';
  }

  // OLD: userName = sanitizer.validateUsername(userName) || 'Anonymous';
  // NEW:
  userName = window.safeWasm.validate_username(userName) || 'Anonymous';

  // Continue with rest of function...
}
```

### Step 4: Remove Sanitizer File
After updating all references:
1. Delete `js/sanitizer.js`
2. Remove any remaining imports
3. Update any global window.sanitizer references

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
    fn test_room_id_validation() {
        let sanitizer = InputSanitizer::new().unwrap();

        assert_eq!(sanitizer.validate_room_id("valid-room-123"), Some("valid-room-123".to_string()));
        assert_eq!(sanitizer.validate_room_id(""), None);
        assert_eq!(sanitizer.validate_room_id("short"), None);
        assert_eq!(sanitizer.validate_room_id("room<script>"), Some("roomscript".to_string()));
    }

    #[test]
    fn test_username_validation() {
        let sanitizer = InputSanitizer::new().unwrap();

        assert_eq!(sanitizer.validate_username("ValidUser"), Some("ValidUser".to_string()));
        assert_eq!(sanitizer.validate_username(""), None);
        assert_eq!(sanitizer.validate_username("User<script>"), Some("Userscript".to_string()));
    }

    #[test]
    fn test_message_sanitization() {
        let sanitizer = InputSanitizer::new().unwrap();

        let malicious = "<script>alert('xss')</script>Hello";
        let result = sanitizer.validate_message(malicious);
        assert!(result.is_some());
        assert!(!result.unwrap().contains("<script>"));
    }

    #[test]
    fn test_html_sanitization() {
        let sanitizer = InputSanitizer::new().unwrap();

        let html = "<div onclick='alert(1)'>Hello</div>";
        let sanitized = sanitizer.sanitize_html(html);
        assert!(!sanitized.contains("onclick"));
        assert!(sanitized.contains("Hello"));
    }

    #[test]
    fn test_attack_pattern_detection() {
        let sanitizer = InputSanitizer::new().unwrap();

        let xss_input = "<script>alert('xss')</script>";
        let patterns = sanitizer.detect_attack_patterns(xss_input);
        assert!(patterns.contains(&"xss".to_string()));

        let sql_input = "'; DROP TABLE users; --";
        let patterns = sanitizer.detect_attack_patterns(sql_input);
        assert!(patterns.contains(&"sql_injection".to_string()));
    }
}
```

### Security Testing
1. **XSS Prevention**: Test various XSS payloads
2. **SQL Injection**: Test injection patterns
3. **Input Fuzzing**: Random input testing
4. **Performance**: Measure validation performance vs JavaScript
5. **Memory Safety**: Ensure no memory leaks

## Success Criteria

- [ ] All input validation moved to Rust
- [ ] `js/sanitizer.js` file deleted
- [ ] All JavaScript files updated to use WASM validation
- [ ] Security improved (all validation in compiled code)
- [ ] Performance equal or better than JavaScript
- [ ] Rate limiting working correctly
- [ ] All security tests passing
- [ ] No XSS vulnerabilities introduced

## Timeline: Week 3-4 (14 days)

### Days 1-3: Rust Implementation
- Implement sanitization module in Rust
- Add comprehensive regex patterns
- Implement rate limiting system
- Write security unit tests

### Days 4-7: WASM Integration
- Create WASM bindings
- Update safe WASM proxy
- Test basic functionality
- Benchmark performance

### Days 8-10: JavaScript Migration
- Replace all sanitizer calls
- Remove sanitizer.js file
- Update rate limiting calls
- Integration testing

### Days 11-14: Security Validation
- Comprehensive security testing
- XSS and injection testing
- Performance optimization
- Documentation and final validation

## Risks and Mitigation

### Risk: Regex Performance in WASM
- **Mitigation**: Benchmark regex operations, optimize patterns
- **Solution**: Cache compiled regexes, use efficient patterns

### Risk: Rate Limiting Storage Issues
- **Mitigation**: Graceful fallback to memory-only rate limiting
- **Solution**: Handle localStorage errors gracefully

### Risk: Security Regression
- **Mitigation**: Comprehensive security test suite
- **Solution**: Side-by-side testing with original sanitizer

This phase significantly improves the security posture of Mindline by moving all input validation to compiled Rust code, making it much harder for attackers to bypass security measures.