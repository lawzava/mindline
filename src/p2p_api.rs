// src/p2p_api.rs
// Phase 4: P2P Network Coordination WASM Bindings

use crate::p2p::{self, with_p2p_manager, ConnectionDecision, ConnectionState, ConnectionStrategy, PeerRole, QueuedMessage};
use crate::console_log;
use wasm_bindgen::prelude::*;
use uuid::Uuid;

// P2P Network Coordination WASM Bindings

#[wasm_bindgen]
pub fn initialize_p2p_manager(client_id: &str, room_id: &str) -> Result<(), JsValue> {
    if client_id.is_empty() || room_id.is_empty() {
        return Err(JsValue::from_str("Client ID and room ID cannot be empty"));
    }

    p2p::P2P_MANAGER.with(|manager| {
        let mut manager_ref = manager.borrow_mut();
        *manager_ref = Some(p2p::P2PNetworkState::new(client_id.to_string(), room_id.to_string()));
        console_log!("P2P manager initialized for client {} in room {}", client_id, room_id);
    });

    Ok(())
}

#[wasm_bindgen]
pub fn add_known_peer(peer_id: &str) -> Result<bool, JsValue> {
    with_p2p_manager(|manager| {
        manager.add_peer(peer_id.to_string())
    })
}

#[wasm_bindgen]
pub fn remove_peer_from_network(peer_id: &str) -> Result<(), JsValue> {
    with_p2p_manager(|manager| {
        manager.remove_peer(peer_id);
    })?;
    Ok(())
}

#[wasm_bindgen]
pub fn update_peer_connection_state(peer_id: &str, state: &str) -> Result<(), JsValue> {
    let connection_state = match state {
        "connecting" => ConnectionState::Connecting,
        "connected" => ConnectionState::Connected,
        "failed" => ConnectionState::Failed,
        "reconnecting" => ConnectionState::Reconnecting,
        "closing" => ConnectionState::Closing,
        _ => ConnectionState::Disconnected,
    };

    with_p2p_manager(|manager| {
        if let Some(peer) = manager.get_peer_mut(peer_id) {
            peer.update_connection_state(connection_state);
            console_log!("Updated peer {} state to {:?}", peer_id, state);
        } else {
            // Create new peer if doesn't exist
            let mut peer = p2p::PeerConnection::new(peer_id.to_string(), PeerRole::Unknown);
            peer.update_connection_state(connection_state);
            manager.peers.insert(peer_id.to_string(), peer);
        }
    })?;

    Ok(())
}


#[wasm_bindgen]
pub fn get_connection_decision(peer_id: &str) -> JsValue {
    let decision = with_p2p_manager(|manager| {
        manager.evaluate_connection_decision(peer_id)
    }).unwrap_or_else(|_| ConnectionDecision {
        should_connect: false,
        delay_ms: 0,
        priority: 0,
        reason: "P2P manager not available".to_string(),
    });

    serde_wasm_bindgen::to_value(&decision).unwrap_or(JsValue::NULL)
}


#[wasm_bindgen]
pub fn record_peer_message_sent(peer_id: &str, size_bytes: u32) -> Result<(), JsValue> {
    with_p2p_manager(|manager| {
        if let Some(peer) = manager.get_peer_mut(peer_id) {
            peer.record_message_sent(size_bytes as u64);
        }
    })?;
    Ok(())
}

#[wasm_bindgen]
pub fn record_peer_message_received(peer_id: &str, size_bytes: u32) -> Result<(), JsValue> {
    with_p2p_manager(|manager| {
        if let Some(peer) = manager.get_peer_mut(peer_id) {
            peer.record_message_received(size_bytes as u64);
        }
    })?;
    Ok(())
}

#[wasm_bindgen]
pub fn update_peer_latency(peer_id: &str, latency_ms: u32) -> Result<(), JsValue> {
    with_p2p_manager(|manager| {
        if let Some(peer) = manager.get_peer_mut(peer_id) {
            peer.update_latency(latency_ms);
        }
    })?;
    Ok(())
}

#[wasm_bindgen]
pub fn needs_mesh_repair() -> bool {
    with_p2p_manager(|manager| {
        manager.needs_mesh_repair()
    }).unwrap_or(false)
}

#[wasm_bindgen]
pub fn get_mesh_repair_plan() -> JsValue {
    let plan = with_p2p_manager(|manager| {
        manager.get_mesh_repair_plan()
    }).unwrap_or_default();

    serde_wasm_bindgen::to_value(&plan).unwrap_or(JsValue::NULL)
}

#[wasm_bindgen]
pub fn get_p2p_network_stats() -> JsValue {
    let stats = with_p2p_manager(|manager| {
        let connected_count = manager.get_connected_peers().len();
        let known_count = manager.all_known_peers.len();
        let avg_quality = manager.get_average_connection_quality();

        let stats_obj = js_sys::Object::new();
        js_sys::Reflect::set(&stats_obj, &"connectedPeers".into(), &(connected_count as u32).into()).unwrap();
        js_sys::Reflect::set(&stats_obj, &"knownPeers".into(), &(known_count as u32).into()).unwrap();
        js_sys::Reflect::set(&stats_obj, &"averageQuality".into(), &avg_quality.into()).unwrap();
        js_sys::Reflect::set(&stats_obj, &"connectionStrategy".into(), &format!("{:?}", manager.connection_strategy).into()).unwrap();
        js_sys::Reflect::set(&stats_obj, &"isReconnecting".into(), &manager.is_reconnecting.into()).unwrap();

        stats_obj.into()
    }).unwrap_or_else(|_| JsValue::NULL);

    stats
}

#[wasm_bindgen]
pub fn handle_connection_failure(peer_id: &str) -> JsValue {
    let strategy = with_p2p_manager(|manager| {
        // Mark peer as failed
        if let Some(peer) = manager.get_peer_mut(peer_id) {
            peer.update_connection_state(ConnectionState::Failed);
            peer.connection_attempts += 1;
            peer.last_attempt = js_sys::Date::now() as u64;
        }

        // Return reconnection strategy
        let decision = manager.evaluate_connection_decision(peer_id);
        decision
    }).unwrap_or_else(|_| ConnectionDecision {
        should_connect: false,
        delay_ms: 0,
        priority: 0,
        reason: "P2P manager not available".to_string(),
    });

    serde_wasm_bindgen::to_value(&strategy).unwrap_or(JsValue::NULL)
}


#[wasm_bindgen]
pub fn cleanup_stale_peers(timeout_minutes: u32) -> u32 {
    let timeout_ms = timeout_minutes as u64 * 60 * 1000;
    let mut removed_count = 0;

    if let Ok(()) = with_p2p_manager(|manager| {
        let stale_peers: Vec<String> = manager.peers
            .iter()
            .filter(|(_, peer)| peer.is_stale(timeout_ms))
            .map(|(id, _)| id.clone())
            .collect();

        for peer_id in stale_peers {
            manager.remove_peer(&peer_id);
            removed_count += 1;
        }

        if removed_count > 0 {
            console_log!("Cleaned up {} stale peers", removed_count);
        }
    }) {};

    removed_count
}

#[wasm_bindgen]
pub fn get_best_peers_for_broadcast(max_peers: u32) -> JsValue {
    let peers = with_p2p_manager(|manager| {
        manager.get_best_peers_for_broadcast(max_peers as usize)
    }).unwrap_or_default();

    serde_wasm_bindgen::to_value(&peers).unwrap_or(JsValue::NULL)
}

#[wasm_bindgen]
pub fn should_send_to_peer(peer_id: &str, message_priority: u32) -> bool {
    with_p2p_manager(|manager| {
        manager.should_use_peer_for_message(peer_id, message_priority)
    }).unwrap_or(false)
}


// Message Queue WASM Bindings
#[wasm_bindgen]
pub fn queue_p2p_message(
    target_peer: Option<String>,
    content: &str,
    message_type: &str,
    priority: u32,
) -> Result<String, JsValue> {
    let message = QueuedMessage {
        id: Uuid::new_v4().to_string(),
        target_peer,
        content: content.to_string(),
        priority,
        attempts: 0,
        max_attempts: 3,
        created_at: js_sys::Date::now() as u64,
        last_attempt: None,
        message_type: message_type.to_string(),
    };

    with_p2p_manager(|manager| {
        manager.queue_message(message)
            .map_err(|e| JsValue::from_str(&e))
    })?
}

#[wasm_bindgen]
pub fn process_p2p_queue() -> JsValue {
    let messages = with_p2p_manager(|manager| {
        manager.process_message_queue()
    }).unwrap_or_default();

    serde_wasm_bindgen::to_value(&messages).unwrap_or(JsValue::NULL)
}

#[wasm_bindgen]
pub fn get_p2p_queue_status() -> JsValue {
    let (pending, high_priority) = with_p2p_manager(|manager| {
        manager.get_queue_status()
    }).unwrap_or((0, 0));

    let status = js_sys::Object::new();
    js_sys::Reflect::set(&status, &"pending".into(), &(pending as u32).into()).unwrap();
    js_sys::Reflect::set(&status, &"highPriority".into(), &(high_priority as u32).into()).unwrap();

    status.into()
}

