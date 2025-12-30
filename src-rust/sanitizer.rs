// src/sanitizer.rs
use regex::Regex;
use wasm_bindgen::prelude::*;

#[derive(Debug, Clone)]
pub struct InputSanitizer {
    dangerous_html_regex: Regex,
    javascript_regex: Regex,
}

#[allow(dead_code)]
impl InputSanitizer {
    pub fn new() -> Result<Self, JsValue> {
        Ok(Self {
            dangerous_html_regex: Regex::new(
                r"(?i)<script|on\w+\s*=|javascript:|vbscript:|data:|<iframe|<object|<embed|<form",
            )
            .map_err(|e| JsValue::from_str(&format!("Failed to create HTML regex: {}", e)))?,
            javascript_regex: Regex::new(r"(?i)javascript:|data:|vbscript:")
                .map_err(|e| JsValue::from_str(&format!("Failed to create JS regex: {}", e)))?,
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

        // Check length constraints - allow shorter room IDs (minimum 3 chars) and UUIDs
        if sanitized.len() < 3 || sanitized.len() > 64 {
            return None;
        }

        // Accept any room ID that contains only safe characters and is the right length
        // This includes:
        // - Simple names like "testroom"
        // - UUIDs like "4c43d349-8677-458e-9e9d-e7fff57f75a4"
        // - Custom IDs like "room-123"
        Some(sanitized)
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

        // Check length limit - ensure we don't slice in the middle of a UTF-8 character
        let sanitized = if trimmed.len() > 2000 {
            // Find the last valid character boundary at or before index 2000
            let mut boundary = 2000;
            while boundary > 0 && !trimmed.is_char_boundary(boundary) {
                boundary -= 1;
            }
            &trimmed[..boundary]
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
        sanitized = self
            .javascript_regex
            .replace_all(&sanitized, "")
            .to_string();

        // HTML entity encoding for remaining content
        sanitized = sanitized
            .replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;")
            .replace('"', "&quot;")
            .replace('\'', "&#x27;");

        // Remove null bytes and other control characters
        sanitized
            .chars()
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
        let window = web_sys::window().ok_or_else(|| JsValue::from_str("No window object"))?;
        let crypto = window
            .crypto()
            .map_err(|_| JsValue::from_str("No crypto object"))?;

        // Generate 16 random bytes (128 bits)
        let mut array = [0u8; 16];
        crypto
            .get_random_values_with_u8_array(&mut array)
            .map_err(|_| JsValue::from_str("Failed to generate random bytes"))?;

        // Convert to hex string
        let hex: String = array.iter().map(|byte| format!("{:02x}", byte)).collect();

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
            "image/jpeg",
            "image/png",
            "image/gif",
            "image/webp",
            "text/plain",
            "application/pdf",
            "audio/mpeg",
            "audio/wav",
            "audio/ogg",
            "video/mp4",
            "video/webm",
            "video/ogg",
        ];

        allowed_types.contains(&mime_type)
    }

    /// Detect potential SQL injection patterns (for future database features)
    pub fn detect_sql_injection(&self, input: &str) -> bool {
        let lower_input = input.to_lowercase();
        // Simple detection of common SQL injection patterns
        lower_input.contains("union")
            || lower_input.contains("select")
            || lower_input.contains("insert")
            || lower_input.contains("update")
            || lower_input.contains("delete")
            || lower_input.contains("drop")
            || input.contains('\'')
            || input.contains('"')
            || input.contains(';')
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
    pub static SANITIZER: std::cell::RefCell<Option<InputSanitizer>> = const { std::cell::RefCell::new(None) };
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
