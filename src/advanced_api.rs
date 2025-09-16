// src/advanced_api.rs
// Phase 6: Advanced Features WASM Bindings (Encryption, Storage, Performance)

use crate::crypto::{with_encryption_manager, EncryptedData};
use crate::storage::{self, StoredMessage, StoredRoom, StorageConfig};
use crate::performance::{with_performance_monitor, MetricCategory, PerformanceSummary};
use crate::console_log;
use wasm_bindgen::prelude::*;

// ===== PHASE 6: ADVANCED FEATURES BINDINGS =====

// Encryption bindings
#[wasm_bindgen]
pub fn generate_room_encryption_key(room_id: &str) -> Result<String, JsValue> {
    with_encryption_manager(|manager| {
        manager.generate_room_key(room_id)
    })?
}

#[wasm_bindgen]
pub fn encrypt_message_content(message: &str, key_id: Option<String>) -> Result<String, JsValue> {
    let encrypted = with_encryption_manager(|manager| {
        manager.encrypt_message(message, key_id.as_deref())
    })??;

    serde_json::to_string(&encrypted)
        .map_err(|_| JsValue::from_str("Failed to serialize encrypted data"))
}

#[wasm_bindgen]
pub fn decrypt_message_content(encrypted_data: &str) -> Result<String, JsValue> {
    let encrypted: EncryptedData = serde_json::from_str(encrypted_data)
        .map_err(|_| JsValue::from_str("Invalid encrypted data format"))?;

    with_encryption_manager(|manager| {
        manager.decrypt_message(&encrypted)
    })?
}

#[wasm_bindgen]
pub fn export_encryption_key(key_id: &str, password: Option<String>) -> Result<String, JsValue> {
    with_encryption_manager(|manager| {
        manager.export_key(key_id, password.as_deref())
    })?
}

#[wasm_bindgen]
pub fn import_encryption_key(exported_key: &str, password: Option<String>) -> Result<String, JsValue> {
    with_encryption_manager(|manager| {
        manager.import_key(exported_key, password.as_deref())
    })?
}

#[wasm_bindgen]
pub fn list_encryption_keys() -> JsValue {
    let keys = with_encryption_manager(|manager| {
        manager.list_keys()
    }).unwrap_or_default();

    serde_wasm_bindgen::to_value(&keys).unwrap_or(JsValue::NULL)
}

#[wasm_bindgen]
pub fn delete_encryption_key(key_id: &str) -> bool {
    with_encryption_manager(|manager| {
        manager.delete_key(key_id)
    }).unwrap_or(false)
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
pub fn store_message_persistent(message_data: &JsValue) -> Result<(), JsValue> {
    let message: StoredMessage = serde_wasm_bindgen::from_value(message_data.clone())?;

    storage::STORAGE_MANAGER.with(|manager| {
        let mut manager_ref = manager.borrow_mut();
        if let Some(ref mut storage) = *manager_ref {
            // Simplified synchronous storage for now
            let _ = futures::executor::block_on(storage.store_message(&message));
            Ok(())
        } else {
            Err(JsValue::from_str("Storage manager not initialized"))
        }
    })
}

#[wasm_bindgen]
pub fn get_stored_messages(room_id: &str, limit: Option<u32>) -> Result<JsValue, JsValue> {
    let messages = storage::STORAGE_MANAGER.with(|manager| {
        let manager_ref = manager.borrow();
        if let Some(ref storage) = *manager_ref {
            futures::executor::block_on(storage.get_messages(room_id, limit))
        } else {
            Err(JsValue::from_str("Storage manager not initialized"))
        }
    })?;

    serde_wasm_bindgen::to_value(&messages)
        .map_err(|_| JsValue::from_str("Failed to serialize messages"))
}

#[wasm_bindgen]
pub fn store_room_persistent(room_data: &JsValue) -> Result<(), JsValue> {
    let room: StoredRoom = serde_wasm_bindgen::from_value(room_data.clone())?;

    storage::STORAGE_MANAGER.with(|manager| {
        let mut manager_ref = manager.borrow_mut();
        if let Some(ref mut storage) = *manager_ref {
            futures::executor::block_on(storage.store_room(&room))
        } else {
            Err(JsValue::from_str("Storage manager not initialized"))
        }
    })
}

#[wasm_bindgen]
pub fn get_stored_room(room_id: &str) -> Result<JsValue, JsValue> {
    let room = storage::STORAGE_MANAGER.with(|manager| {
        let manager_ref = manager.borrow();
        if let Some(ref storage) = *manager_ref {
            futures::executor::block_on(storage.get_room(room_id))
        } else {
            Ok(None)
        }
    })?;

    serde_wasm_bindgen::to_value(&room)
        .map_err(|_| JsValue::from_str("Failed to serialize room"))
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

    serde_wasm_bindgen::to_value(&rooms)
        .map_err(|_| JsValue::from_str("Failed to serialize rooms"))
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
pub fn record_performance_metric(name: &str, value: f64, unit: &str, category: &str) -> Result<(), JsValue> {
    let metric_category = match category {
        "memory" => MetricCategory::Memory,
        "network" => MetricCategory::Network,
        "rendering" => MetricCategory::Rendering,
        "computation" => MetricCategory::Computation,
        "storage" => MetricCategory::Storage,
        "p2p" => MetricCategory::P2P,
        "wasm" => MetricCategory::WASM,
        _ => MetricCategory::Custom,
    };

    with_performance_monitor(|monitor| {
        monitor.record_metric(name, value, unit, metric_category);
    })?;

    Ok(())
}

#[wasm_bindgen]
pub fn get_performance_summary() -> JsValue {
    let summary = with_performance_monitor(|monitor| {
        monitor.get_performance_summary()
    }).unwrap_or_else(|_| PerformanceSummary {
        current_memory_mb: 0.0,
        current_wasm_memory_mb: 0.0,
        average_message_time_ms: 0.0,
        average_p2p_latency_ms: 0.0,
        total_messages_processed: 0,
        active_connections: 0,
        current_frame_rate: 0.0,
        cpu_usage_percent: 0.0,
        uptime_seconds: 0,
    });

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
    with_performance_monitor(|monitor| {
        monitor.end_timer(label)
    }).unwrap_or(None)
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
    with_performance_monitor(|monitor| {
        monitor.get_counter(name)
    }).unwrap_or(0)
}