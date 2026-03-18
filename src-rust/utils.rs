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

/// Pure parsing and validation logic extracted for testability
pub fn extract_room_from_search<F>(search: &str, decode_fn: F) -> Option<String>
where
    F: Fn(&str) -> Option<String>,
{
    if search.is_empty() {
        return None;
    }

    // Parse URL parameters manually
    let params = search.strip_prefix('?').unwrap_or(search);
    for param in params.split('&') {
        if let Some((key, value)) = param.split_once('=') {
            if key == "r" {
                // URL decode the value
                if let Some(room_id) = decode_fn(value) {
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
pub fn get_room_from_url() -> Option<String> {
    let window = web_sys::window()?;

    let location = window.location();
    let search = match location.search() {
        Ok(s) => s,
        Err(_) => return None,
    };

    extract_room_from_search(&search, |value| {
        js_sys::decode_uri_component(value).ok().map(String::from)
    })
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

    // A simple mock decoder for testing.
    // In a real browser, js_sys::decode_uri_component handles %-decoding.
    // For tests, we'll just replace %20 with space as a basic mockup,
    // or just return the string as-is for simplicity unless testing specific decoding.
    fn mock_decoder(val: &str) -> Option<String> {
        Some(val.replace("%20", " ").replace("%2D", "-"))
    }

    #[test]
    fn test_extract_room_happy_path() {
        assert_eq!(
            extract_room_from_search("?r=myroom", mock_decoder),
            Some("myroom".to_string())
        );
        assert_eq!(
            extract_room_from_search("?foo=bar&r=myroom&baz=qux", mock_decoder),
            Some("myroom".to_string())
        );
    }

    #[test]
    fn test_extract_room_empty_or_missing() {
        assert_eq!(extract_room_from_search("", mock_decoder), None);
        assert_eq!(extract_room_from_search("?", mock_decoder), None);
        assert_eq!(extract_room_from_search("?foo=bar", mock_decoder), None);
    }

    #[test]
    fn test_extract_room_too_short() {
        // Room ID must be at least 3 characters
        assert_eq!(extract_room_from_search("?r=ab", mock_decoder), None);
        assert_eq!(extract_room_from_search("?r=a", mock_decoder), None);
        assert_eq!(extract_room_from_search("?r=", mock_decoder), None);
    }

    #[test]
    fn test_extract_room_url_encoded() {
        assert_eq!(
            extract_room_from_search("?r=my%20room", mock_decoder),
            Some("my room".to_string())
        );
        assert_eq!(
            extract_room_from_search("?r=room%2D123", mock_decoder),
            Some("room-123".to_string())
        );
    }

    #[test]
    fn test_extract_room_multiple_r_params() {
        // Should take the first valid 'r' parameter it encounters
        assert_eq!(
            extract_room_from_search("?r=ab&r=validroom", mock_decoder),
            Some("validroom".to_string())
        );
        assert_eq!(
            extract_room_from_search("?r=valid1&r=valid2", mock_decoder),
            Some("valid1".to_string())
        );
    }

    #[test]
    fn test_extract_room_without_question_mark() {
        assert_eq!(
            extract_room_from_search("r=myroom", mock_decoder),
            Some("myroom".to_string())
        );
        assert_eq!(
            extract_room_from_search("foo=bar&r=myroom", mock_decoder),
            Some("myroom".to_string())
        );
    }
}
