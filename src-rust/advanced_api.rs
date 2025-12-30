// src/advanced_api.rs
// Phase 6: Advanced Features WASM Bindings (Encryption, Storage, Performance)

use crate::console_log;
use crate::crypto::with_encryption_manager;
use crate::performance::{with_performance_monitor, MetricCategory, PerformanceSummary};
use crate::storage::{self, StorageConfig};
use wasm_bindgen::prelude::*;

// ===== PHASE 6: ADVANCED FEATURES BINDINGS =====

// Encryption bindings
#[wasm_bindgen]
pub fn generate_room_encryption_key(room_id: &str) -> Result<String, JsValue> {
    with_encryption_manager(|manager| manager.generate_room_key(room_id))?
}

#[wasm_bindgen]
pub fn list_encryption_keys() -> JsValue {
    let keys = with_encryption_manager(|manager| manager.list_keys()).unwrap_or_default();

    serde_wasm_bindgen::to_value(&keys).unwrap_or(JsValue::NULL)
}

#[wasm_bindgen]
pub fn delete_encryption_key(key_id: &str) -> bool {
    with_encryption_manager(|manager| manager.delete_key(key_id)).unwrap_or(false)
}

// Storage bindings
#[wasm_bindgen]
pub fn initialize_storage(database_name: &str, version: u32) -> Result<(), JsValue> {
    let config = StorageConfig {
        database_name: database_name.to_string(),
        version,
        max_messages_per_room: 1000,
        auto_cleanup_days: 30,
        compression_enabled: true,
    };

    storage::init_storage_manager(config);
    console_log!("Storage initialized with database: {}", database_name);
    Ok(())
}

#[wasm_bindgen]
pub fn list_stored_rooms() -> Result<JsValue, JsValue> {
    let rooms = storage::STORAGE_MANAGER.with(|manager| {
        let manager_ref = manager.borrow();
        if let Some(ref storage) = *manager_ref {
            futures::executor::block_on(storage.list_rooms())
        } else {
            Ok(Vec::new())
        }
    })?;

    serde_wasm_bindgen::to_value(&rooms).map_err(|_| JsValue::from_str("Failed to serialize rooms"))
}

#[wasm_bindgen]
pub fn cleanup_old_storage_data(days_old: u32) -> Result<u32, JsValue> {
    storage::STORAGE_MANAGER.with(|manager| {
        let mut manager_ref = manager.borrow_mut();
        if let Some(ref mut storage) = *manager_ref {
            futures::executor::block_on(storage.cleanup_old_data(days_old))
        } else {
            Ok(0)
        }
    })
}

// Performance monitoring bindings
#[wasm_bindgen]
pub fn start_performance_monitoring() -> Result<(), JsValue> {
    with_performance_monitor(|monitor| {
        monitor.collect_system_metrics();
        console_log!("Performance monitoring started");
    })?;
    Ok(())
}

#[wasm_bindgen]
pub fn record_performance_metric(
    name: &str,
    value: f64,
    unit: &str,
    category: &str,
) -> Result<(), JsValue> {
    let metric_category = match category {
        "memory" => MetricCategory::Memory,
        "network" => MetricCategory::Network,
        "rendering" => MetricCategory::Rendering,
        "computation" => MetricCategory::Computation,
        "storage" => MetricCategory::Storage,
        "p2p" => MetricCategory::P2P,
        "wasm" => MetricCategory::Wasm,
        _ => MetricCategory::Custom,
    };

    with_performance_monitor(|monitor| {
        monitor.record_metric(name, value, unit, metric_category);
    })?;

    Ok(())
}

#[wasm_bindgen]
pub fn get_performance_summary() -> JsValue {
    let summary = with_performance_monitor(|monitor| monitor.get_performance_summary()).unwrap_or(
        PerformanceSummary {
            current_memory_mb: 0.0,
            current_wasm_memory_mb: 0.0,
            average_message_time_ms: 0.0,
            average_p2p_latency_ms: 0.0,
            total_messages_processed: 0,
            active_connections: 0,
            current_frame_rate: 0.0,
            cpu_usage_percent: 0.0,
            uptime_seconds: 0,
        },
    );

    serde_wasm_bindgen::to_value(&summary).unwrap_or(JsValue::NULL)
}

#[wasm_bindgen]
pub fn start_performance_timer(label: &str) -> Result<(), JsValue> {
    with_performance_monitor(|monitor| {
        monitor.start_timer(label);
    })?;
    Ok(())
}

#[wasm_bindgen]
pub fn end_performance_timer(label: &str) -> Option<f64> {
    with_performance_monitor(|monitor| monitor.end_timer(label)).unwrap_or(None)
}

#[wasm_bindgen]
pub fn increment_performance_counter(name: &str) -> Result<(), JsValue> {
    with_performance_monitor(|monitor| {
        monitor.increment_counter(name);
    })?;
    Ok(())
}

#[wasm_bindgen]
pub fn get_performance_counter(name: &str) -> u64 {
    with_performance_monitor(|monitor| monitor.get_counter(name)).unwrap_or(0)
}
