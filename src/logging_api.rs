// src/logging_api.rs
// Phase 5: Logging System WASM Bindings

use crate::logger::{self, with_logger, LogLevel, LogComponent, LogContext, LogFilter};
use crate::console_log;
use std::collections::HashMap;
use wasm_bindgen::prelude::*;

// ========== Phase 5: Logging System WASM Bindings ==========

#[wasm_bindgen]
pub fn initialize_logger(is_development: bool, debug_enabled: bool) -> Result<(), JsValue> {
    let config = logger::LoggerConfig {
        is_development,
        debug_enabled,
        ..logger::LoggerConfig::default()
    };

    logger::GLOBAL_LOGGER.with(|logger| {
        let mut logger_ref = logger.borrow_mut();
        *logger_ref = Some(logger::Logger::new(config));
    });

    console_log!("Logger initialized - dev: {}, debug: {}", is_development, debug_enabled);
    Ok(())
}

#[wasm_bindgen]
pub fn set_log_context(user_id: Option<String>, room_id: Option<String>, component: Option<String>) -> Result<(), JsValue> {
    let context = LogContext {
        user_id,
        room_id,
        component: component.map(|c| LogComponent::from_str(&c)),
    };

    with_logger(|logger| {
        logger.set_context(context);
    })?;

    Ok(())
}

#[wasm_bindgen]
pub fn log_debug(component: &str, message: &str) {
    // Defensive: catch any panics to prevent crashes
    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _ = with_logger(|logger| {
            logger.debug(LogComponent::from_str(component), message);
        });
    }));
}

#[wasm_bindgen]
pub fn log_info(component: &str, message: &str) {
    // Defensive: catch any panics to prevent crashes
    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _ = with_logger(|logger| {
            logger.info(LogComponent::from_str(component), message);
        });
    }));
}

#[wasm_bindgen]
pub fn log_warn(component: &str, message: &str) {
    // Defensive: catch any panics to prevent crashes
    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _ = with_logger(|logger| {
            logger.warn(LogComponent::from_str(component), message);
        });
    }));
}

#[wasm_bindgen]
pub fn log_error(component: &str, message: &str) {
    // Defensive: catch any panics to prevent crashes
    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _ = with_logger(|logger| {
            logger.error(LogComponent::from_str(component), message);
        });
    }));
}

#[wasm_bindgen]
pub fn log_with_data(level: &str, component: &str, message: &str, data: &str) -> Result<(), JsValue> {
    let log_level = LogLevel::from_str(level)
        .ok_or_else(|| JsValue::from_str("Invalid log level"))?;

    with_logger(|logger| {
        logger.log_with_data(log_level, LogComponent::from_str(component), message, Some(data));
    })?;

    Ok(())
}

#[wasm_bindgen]
pub fn start_log_group(label: &str) -> Result<(), JsValue> {
    with_logger(|logger| {
        logger.group(label);
    })?;
    Ok(())
}

#[wasm_bindgen]
pub fn end_log_group() -> Result<(), JsValue> {
    with_logger(|logger| {
        logger.group_end();
    })?;
    Ok(())
}

#[wasm_bindgen]
pub fn log_table(data: &JsValue) -> Result<(), JsValue> {
    with_logger(|logger| {
        logger.table(data);
    })?;
    Ok(())
}

#[wasm_bindgen]
pub fn get_log_entries(filter_json: Option<String>) -> JsValue {
    let filter = filter_json
        .and_then(|json| serde_json::from_str::<LogFilter>(&json).ok());

    let logs = with_logger(|logger| {
        logger.get_logs(filter)
    }).unwrap_or_default();

    serde_wasm_bindgen::to_value(&logs).unwrap_or(JsValue::NULL)
}

#[wasm_bindgen]
pub fn clear_log_buffer() -> Result<(), JsValue> {
    with_logger(|logger| {
        logger.clear_logs();
    })?;
    Ok(())
}

#[wasm_bindgen]
pub fn export_logs_json(filter_json: Option<String>) -> String {
    let filter = filter_json
        .and_then(|json| serde_json::from_str::<LogFilter>(&json).ok());

    with_logger(|logger| {
        logger.export_logs(filter)
    }).unwrap_or_else(|_| "[]".to_string())
}

#[wasm_bindgen]
pub fn export_recent_logs_json(count: u32) -> String {
    with_logger(|logger| {
        logger.export_recent_logs(count as usize)
    }).unwrap_or_else(|_| "[]".to_string())
}

#[wasm_bindgen]
pub fn get_log_statistics() -> JsValue {
    let stats = with_logger(|logger| {
        logger.get_log_stats()
    }).unwrap_or_default();

    serde_wasm_bindgen::to_value(&stats).unwrap_or(JsValue::NULL)
}

#[wasm_bindgen]
pub fn enable_debug_logging() -> Result<(), JsValue> {
    with_logger(|logger| {
        logger.config.debug_enabled = true;
        logger.info(LogComponent::Core, "Debug logging enabled");
    })?;
    Ok(())
}

#[wasm_bindgen]
pub fn disable_debug_logging() -> Result<(), JsValue> {
    with_logger(|logger| {
        logger.config.debug_enabled = false;
        logger.info(LogComponent::Core, "Debug logging disabled");
    })?;
    Ok(())
}

#[wasm_bindgen]
pub fn configure_logger(
    max_entries: u32,
    console_output: bool,
    buffer_logs: bool,
    auto_export_errors: bool,
) -> Result<(), JsValue> {
    with_logger(|logger| {
        logger.config.max_log_entries = max_entries as usize;
        logger.config.console_output_enabled = console_output;
        logger.config.buffer_logs = buffer_logs;
        logger.config.auto_export_errors = auto_export_errors;

        logger.info(LogComponent::Core, "Logger configuration updated");
    })?;
    Ok(())
}

#[wasm_bindgen]
pub fn search_logs(query: &str, limit: Option<u32>) -> JsValue {
    let results = with_logger(|logger| {
        logger.search_logs(query, limit.map(|l| l as usize))
    }).unwrap_or_default();

    serde_wasm_bindgen::to_value(&results).unwrap_or(JsValue::NULL)
}

#[wasm_bindgen]
pub fn get_logs_by_component(component: &str, limit: Option<u32>) -> JsValue {
    let comp = LogComponent::from_str(component);
    let results = with_logger(|logger| {
        logger.get_logs_by_component(comp, limit.map(|l| l as usize))
    }).unwrap_or_default();

    serde_wasm_bindgen::to_value(&results).unwrap_or(JsValue::NULL)
}

#[wasm_bindgen]
pub fn get_error_summary(last_n_minutes: u32) -> JsValue {
    let summary = with_logger(|logger| {
        logger.get_error_summary(last_n_minutes)
    }).unwrap_or_else(|_| logger::ErrorSummary {
        total_errors: 0,
        unique_errors: 0,
        error_counts: HashMap::new(),
        component_errors: HashMap::new(),
        time_range_minutes: last_n_minutes,
        first_error_time: None,
        last_error_time: None,
    });

    serde_wasm_bindgen::to_value(&summary).unwrap_or(JsValue::NULL)
}

#[wasm_bindgen]
pub fn create_debug_report() -> String {
    with_logger(|logger| {
        let report = logger.create_debug_report();
        serde_json::to_string_pretty(&report).unwrap_or_else(|_| "Failed to create debug report".to_string())
    }).unwrap_or_else(|_| "Logger not available".to_string())
}