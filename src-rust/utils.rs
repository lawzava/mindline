// src/utils.rs
// URL and utility functions

use crate::console_log;
use wasm_bindgen::prelude::*;

// URL and utility functions

#[wasm_bindgen]
pub fn generate_uuid() -> String {
    // Return String directly for proper JavaScript interop
    use uuid::Uuid;
    Uuid::new_v4().to_string()
}

#[wasm_bindgen]
pub fn get_room_from_url() -> Option<String> {
    let window = web_sys::window()?;

    let location = window.location();
    let search = match location.search() {
        Ok(s) => s,
        Err(_) => return None,
    };

    if search.is_empty() {
        return None;
    }

    // Parse URL parameters manually
    let params = search.strip_prefix('?').unwrap_or(&search);
    for param in params.split('&') {
        if let Some((key, value)) = param.split_once('=') {
            if key == "r" {
                // URL decode the value
                if let Ok(decoded) = js_sys::decode_uri_component(value) {
                    let room_id = String::from(decoded);
                    // Validate room ID has minimum length
                    if room_id.len() >= 3 {
                        return Some(room_id);
                    }
                }
            }
        }
    }

    None
}

#[wasm_bindgen]
pub fn update_url_with_room(room_id: &str) -> Result<(), JsValue> {
    let window = web_sys::window().ok_or_else(|| JsValue::from_str("No window object"))?;
    let location = window.location();
    let history = window
        .history()
        .map_err(|_| JsValue::from_str("No history object"))?;

    let pathname = location
        .pathname()
        .map_err(|_| JsValue::from_str("Failed to get pathname"))?;

    let new_url = if room_id.is_empty() {
        pathname
    } else {
        let encoded_room_id = js_sys::encode_uri_component(room_id);
        format!("{}?r={}", pathname, encoded_room_id)
    };

    history
        .replace_state_with_url(&JsValue::NULL, "", Some(&new_url))
        .map_err(|_| JsValue::from_str("Failed to update URL"))?;

    console_log!("URL updated with room ID: {}", room_id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_uuid_format() {
        let uuid = generate_uuid();

        // Length should be 36
        assert_eq!(uuid.len(), 36);

        // Should have 5 parts separated by hyphens
        let parts: Vec<&str> = uuid.split('-').collect();
        assert_eq!(parts.len(), 5);
        assert_eq!(parts[0].len(), 8);
        assert_eq!(parts[1].len(), 4);
        assert_eq!(parts[2].len(), 4);
        assert_eq!(parts[3].len(), 4);
        assert_eq!(parts[4].len(), 12);

        // All characters (except hyphens) should be valid lowercase hex digits
        for c in uuid.chars() {
            if c != '-' {
                assert!(
                    c.is_ascii_hexdigit(),
                    "Character {} is not a valid hex digit",
                    c
                );
                if c.is_alphabetic() {
                    assert!(c.is_lowercase(), "Character {} is not lowercase", c);
                }
            }
        }

        // UUID v4 specific checks
        assert!(parts[2].starts_with('4'));
        let variant_char = parts[3].chars().next().unwrap();
        assert!(matches!(variant_char, '8' | '9' | 'a' | 'b'));
    }

    #[test]
    fn test_generate_uuid_uniqueness() {
        use std::collections::HashSet;

        let mut uuids = HashSet::new();
        // Generate a reasonable number of UUIDs to test uniqueness
        for _ in 0..1000 {
            let uuid = generate_uuid();
            assert!(uuids.insert(uuid), "Generated duplicate UUID");
        }
    }
}
