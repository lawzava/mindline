// src/sanitizer.rs
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
            username_regex: Regex::new(r"^[a-zA-Z0-9 _-]{1,32}$")
                .map_err(|e| JsValue::from_str(&format!("Failed to create username regex: {}", e)))?,
            dangerous_html_regex: Regex::new(
                r"(?i)<script|on\w+\s*=|javascript:|vbscript:|data:|<iframe|<object|<embed|<form"
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

        // Check length constraints (allow UUIDs which are 36 chars)
        if sanitized.len() < 8 || sanitized.len() > 64 {
            return None;
        }

        // Check if it's a valid UUID format (36 chars with hyphens) or regular room ID
        if sanitized.len() == 36 && sanitized.chars().filter(|&c| c == '-').count() == 4 {
            // UUID format: 8-4-4-4-12
            Some(sanitized)
        } else if self.room_id_regex.is_match(&sanitized) {
            // Regular room ID format
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

        // Remove dangerous characters using simple validation
        let sanitized: String = trimmed
            .chars()
            .filter(|c| c.is_alphanumeric() || *c == ' ' || *c == '_' || *c == '-')
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
            .filter(|c| c.is_ascii_graphic() || c.is_ascii_whitespace())
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
            .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_')
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

    /// Detect potential SQL injection patterns (for future database features)
    pub fn detect_sql_injection(&self, input: &str) -> bool {
        let lower_input = input.to_lowercase();
        // Simple detection of common SQL injection patterns
        lower_input.contains("union") ||
        lower_input.contains("select") ||
        lower_input.contains("insert") ||
        lower_input.contains("update") ||
        lower_input.contains("delete") ||
        lower_input.contains("drop") ||
        input.contains('\'') ||
        input.contains('"') ||
        input.contains(';')
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

// Global sanitizer instance
thread_local! {
    pub static SANITIZER: std::cell::RefCell<Option<InputSanitizer>> = std::cell::RefCell::new(None);
}

pub fn with_sanitizer<F, R>(f: F) -> Result<R, JsValue>
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