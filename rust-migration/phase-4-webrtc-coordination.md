# Phase 4: WebRTC Connection Coordination Migration

## Overview
Move P2P connection coordination logic from JavaScript to Rust while keeping WebRTC APIs in JavaScript. This phase focuses on peer discovery, connection strategies, state management, and mesh network coordination for more reliable P2P communication.

## Current State Analysis

### JavaScript WebRTC Logic (`js/webrtc.js` - 734 lines)
- **P2PConnection class**: Complete WebRTC implementation
- **Connection management**: Peer lifecycle, connection states
- **Mesh networking**: Full mesh connectivity logic
- **Signaling**: WebSocket-based peer discovery
- **Message broadcasting**: Data channel management
- **Connection recovery**: Reconnection and failure handling

### Browser Limitations
- **WebRTC APIs**: Must remain in JavaScript (browser limitation)
- **WebSocket APIs**: Must remain in JavaScript
- **DOM event handling**: JavaScript only
- **ICE handling**: JavaScript WebRTC APIs required

### Benefits of Partial Migration
- **State consistency**: Centralized peer state management
- **Connection logic**: Better connection decision algorithms
- **Performance**: Faster peer discovery and routing
- **Reliability**: More robust mesh management
- **Memory efficiency**: Better peer state tracking

## Implementation Plan

### 4.1 P2P State Management in Rust

```rust
// Create src/p2p.rs

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use wasm_bindgen::prelude::*;

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub enum ConnectionState {
    Disconnected,
    Connecting,
    Connected,
    Failed,
    Reconnecting,
    Closing,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub enum PeerRole {
    Initiator,   // This peer initiated the connection
    Responder,   // This peer responded to connection
    Unknown,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PeerConnection {
    pub peer_id: String,
    pub connection_state: ConnectionState,
    pub peer_role: PeerRole,
    pub last_seen: u64,
    pub last_ping: u64,
    pub connection_attempts: u32,
    pub last_attempt: u64,
    pub data_channel_state: String,
    pub ice_connection_state: String,
    pub signaling_state: String,
    pub messages_sent: u32,
    pub messages_received: u32,
    pub bytes_sent: u64,
    pub bytes_received: u64,
    pub latency_ms: Option<u32>,
    pub connection_quality: f32, // 0.0 to 1.0
}

impl PeerConnection {
    pub fn new(peer_id: String, role: PeerRole) -> Self {
        let now = js_sys::Date::now() as u64;
        Self {
            peer_id,
            connection_state: ConnectionState::Disconnected,
            peer_role: role,
            last_seen: now,
            last_ping: now,
            connection_attempts: 0,
            last_attempt: 0,
            data_channel_state: "closed".to_string(),
            ice_connection_state: "new".to_string(),
            signaling_state: "stable".to_string(),
            messages_sent: 0,
            messages_received: 0,
            bytes_sent: 0,
            bytes_received: 0,
            latency_ms: None,
            connection_quality: 0.0,
        }
    }

    pub fn update_connection_state(&mut self, state: ConnectionState) {
        self.connection_state = state;
        self.last_seen = js_sys::Date::now() as u64;

        // Update connection quality based on state
        self.connection_quality = match self.connection_state {
            ConnectionState::Connected => {
                let base_quality = 1.0;
                let attempt_penalty = (self.connection_attempts as f32 * 0.1).min(0.3);
                let latency_penalty = self.latency_ms
                    .map(|ms| (ms as f32 / 1000.0).min(0.3))
                    .unwrap_or(0.0);
                (base_quality - attempt_penalty - latency_penalty).max(0.1)
            },
            ConnectionState::Connecting => 0.3,
            ConnectionState::Reconnecting => 0.2,
            _ => 0.0,
        };
    }

    pub fn should_reconnect(&self, max_attempts: u32, min_interval_ms: u64) -> bool {
        if self.connection_attempts >= max_attempts {
            return false;
        }

        let now = js_sys::Date::now() as u64;
        let time_since_last = now.saturating_sub(self.last_attempt);

        matches!(self.connection_state, ConnectionState::Failed | ConnectionState::Disconnected)
            && time_since_last >= min_interval_ms
    }

    pub fn record_message_sent(&mut self, size_bytes: u64) {
        self.messages_sent += 1;
        self.bytes_sent += size_bytes;
        self.last_seen = js_sys::Date::now() as u64;
    }

    pub fn record_message_received(&mut self, size_bytes: u64) {
        self.messages_received += 1;
        self.bytes_received += size_bytes;
        self.last_seen = js_sys::Date::now() as u64;
    }

    pub fn update_latency(&mut self, ping_time: u32) {
        self.latency_ms = Some(ping_time);
        self.last_ping = js_sys::Date::now() as u64;
    }

    pub fn is_stale(&self, timeout_ms: u64) -> bool {
        let now = js_sys::Date::now() as u64;
        now.saturating_sub(self.last_seen) > timeout_ms
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct P2PNetworkState {
    pub client_id: String,
    pub room_id: String,
    pub peers: HashMap<String, PeerConnection>,
    pub all_known_peers: HashSet<String>,
    pub reconnect_attempts: u32,
    pub max_reconnect_attempts: u32,
    pub is_reconnecting: bool,
    pub mesh_check_interval: u64,
    pub last_mesh_check: u64,
    pub signaling_connected: bool,
    pub connection_strategy: ConnectionStrategy,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub enum ConnectionStrategy {
    FullMesh,      // Connect to all peers
    Selective,     // Connect to subset based on quality
    Hub,           // One peer acts as hub
    Adaptive,      // Change strategy based on network conditions
}

impl P2PNetworkState {
    pub fn new(client_id: String, room_id: String) -> Self {
        Self {
            client_id,
            room_id,
            peers: HashMap::new(),
            all_known_peers: HashSet::new(),
            reconnect_attempts: 0,
            max_reconnect_attempts: 5,
            is_reconnecting: false,
            mesh_check_interval: 10000, // 10 seconds
            last_mesh_check: js_sys::Date::now() as u64,
            signaling_connected: false,
            connection_strategy: ConnectionStrategy::FullMesh,
        }
    }

    pub fn add_peer(&mut self, peer_id: String) -> bool {
        if peer_id == self.client_id {
            return false; // Don't add self
        }

        let was_new = self.all_known_peers.insert(peer_id.clone());

        if was_new {
            console_log!("Added new peer to known peers: {}", peer_id);
        }

        was_new
    }

    pub fn remove_peer(&mut self, peer_id: &str) {
        self.peers.remove(peer_id);
        self.all_known_peers.remove(peer_id);
        console_log!("Removed peer: {}", peer_id);
    }

    pub fn get_peer_mut(&mut self, peer_id: &str) -> Option<&mut PeerConnection> {
        self.peers.get_mut(peer_id)
    }

    pub fn get_or_create_peer(&mut self, peer_id: &str, role: PeerRole) -> &mut PeerConnection {
        self.peers.entry(peer_id.to_string()).or_insert_with(|| {
            console_log!("Creating new peer connection: {} (role: {:?})", peer_id, role);
            PeerConnection::new(peer_id.to_string(), role)
        })
    }

    pub fn should_initiate_connection(&self, peer_id: &str) -> bool {
        match self.connection_strategy {
            ConnectionStrategy::FullMesh => {
                // Use lexicographic comparison for deterministic connection initiation
                self.client_id > peer_id
            },
            ConnectionStrategy::Selective => {
                // More complex logic for selective connections
                let connected_count = self.get_connected_peers().len();
                connected_count < 3 && self.client_id > peer_id
            },
            ConnectionStrategy::Hub => {
                // Hub strategy - one peer connects to all others
                self.is_designated_hub()
            },
            ConnectionStrategy::Adaptive => {
                // Adaptive based on current network health
                self.adaptive_should_connect(peer_id)
            },
        }
    }

    pub fn get_connected_peers(&self) -> Vec<String> {
        self.peers
            .iter()
            .filter(|(_, peer)| peer.connection_state == ConnectionState::Connected)
            .map(|(id, _)| id.clone())
            .collect()
    }

    pub fn get_connection_candidates(&self) -> Vec<String> {
        match self.connection_strategy {
            ConnectionStrategy::FullMesh => {
                // Connect to all known peers
                self.all_known_peers
                    .iter()
                    .filter(|id| *id != &self.client_id)
                    .cloned()
                    .collect()
            },
            ConnectionStrategy::Selective => {
                // Select best peers based on quality and latency
                let mut candidates: Vec<_> = self.peers
                    .iter()
                    .filter(|(_, peer)| peer.connection_quality > 0.5)
                    .map(|(id, peer)| (id.clone(), peer.connection_quality))
                    .collect();

                candidates.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
                candidates.into_iter().take(5).map(|(id, _)| id).collect()
            },
            _ => self.get_connected_peers(),
        }
    }

    pub fn needs_mesh_repair(&self) -> bool {
        let now = js_sys::Date::now() as u64;
        let time_since_check = now.saturating_sub(self.last_mesh_check);

        if time_since_check < self.mesh_check_interval {
            return false;
        }

        let connected_count = self.get_connected_peers().len();
        let expected_count = self.all_known_peers.len().saturating_sub(1); // Exclude self

        connected_count < expected_count
    }

    pub fn get_reconnection_candidates(&self) -> Vec<String> {
        let now = js_sys::Date::now() as u64;

        self.peers
            .iter()
            .filter(|(_, peer)| {
                peer.should_reconnect(self.max_reconnect_attempts, 5000) &&
                peer.connection_quality > 0.2 // Don't reconnect to very poor connections
            })
            .map(|(id, _)| id.clone())
            .collect()
    }

    pub fn update_strategy_based_on_network(&mut self) {
        if self.connection_strategy != ConnectionStrategy::Adaptive {
            return;
        }

        let connected_count = self.get_connected_peers().len();
        let known_count = self.all_known_peers.len();
        let avg_quality = self.get_average_connection_quality();

        // Adaptive strategy logic
        if known_count > 10 && avg_quality < 0.6 {
            // Large network with poor quality - use selective
            self.connection_strategy = ConnectionStrategy::Selective;
            console_log!("Switching to selective strategy due to network size and quality");
        } else if known_count > 20 {
            // Very large network - use hub strategy
            self.connection_strategy = ConnectionStrategy::Hub;
            console_log!("Switching to hub strategy due to large network size");
        } else {
            // Small to medium network - use full mesh
            self.connection_strategy = ConnectionStrategy::FullMesh;
        }
    }

    fn get_average_connection_quality(&self) -> f32 {
        if self.peers.is_empty() {
            return 0.0;
        }

        let total_quality: f32 = self.peers.values()
            .map(|peer| peer.connection_quality)
            .sum();

        total_quality / self.peers.len() as f32
    }

    fn is_designated_hub(&self) -> bool {
        // Simple hub designation - peer with lexicographically smallest ID
        self.all_known_peers
            .iter()
            .min()
            .map(|min_id| min_id == &self.client_id)
            .unwrap_or(true)
    }

    fn adaptive_should_connect(&self, peer_id: &str) -> bool {
        let connected_count = self.get_connected_peers().len();
        let avg_quality = self.get_average_connection_quality();

        // Connect if we have few connections or good network quality
        connected_count < 3 || (avg_quality > 0.7 && self.client_id > peer_id)
    }
}

// Global P2P manager
thread_local! {
    static P2P_MANAGER: std::cell::RefCell<Option<P2PNetworkState>> = std::cell::RefCell::new(None);
}

fn with_p2p_manager<F, R>(f: F) -> Result<R, JsValue>
where
    F: FnOnce(&mut P2PNetworkState) -> R,
{
    P2P_MANAGER.with(|manager| {
        let mut manager_ref = manager.borrow_mut();
        if manager_ref.is_none() {
            return Err(JsValue::from_str("P2P manager not initialized"));
        }
        Ok(f(manager_ref.as_mut().unwrap()))
    })
}
```

### 4.2 Connection Strategy Implementation

```rust
// Add to src/p2p.rs

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ConnectionDecision {
    pub should_connect: bool,
    pub delay_ms: u64,
    pub priority: u32, // Higher = more important
    pub reason: String,
}

impl P2PNetworkState {
    pub fn evaluate_connection_decision(&self, peer_id: &str) -> ConnectionDecision {
        if peer_id == self.client_id {
            return ConnectionDecision {
                should_connect: false,
                delay_ms: 0,
                priority: 0,
                reason: "Cannot connect to self".to_string(),
            };
        }

        // Check if already connected
        if let Some(peer) = self.peers.get(peer_id) {
            if peer.connection_state == ConnectionState::Connected {
                return ConnectionDecision {
                    should_connect: false,
                    delay_ms: 0,
                    priority: 0,
                    reason: "Already connected".to_string(),
                };
            }

            // Check if should retry failed connection
            if !peer.should_reconnect(self.max_reconnect_attempts, 5000) {
                return ConnectionDecision {
                    should_connect: false,
                    delay_ms: 0,
                    priority: 0,
                    reason: "Max reconnection attempts reached or too soon to retry".to_string(),
                };
            }
        }

        let should_initiate = self.should_initiate_connection(peer_id);
        if !should_initiate {
            return ConnectionDecision {
                should_connect: false,
                delay_ms: 0,
                priority: 0,
                reason: "Other peer should initiate connection".to_string(),
            };
        }

        // Calculate priority and delay based on various factors
        let priority = self.calculate_connection_priority(peer_id);
        let delay = self.calculate_connection_delay(peer_id);

        ConnectionDecision {
            should_connect: true,
            delay_ms: delay,
            priority,
            reason: format!("Connection needed (priority: {}, delay: {}ms)", priority, delay),
        }
    }

    fn calculate_connection_priority(&self, peer_id: &str) -> u32 {
        let mut priority = 100; // Base priority

        // Higher priority for peers we've successfully connected to before
        if let Some(peer) = self.peers.get(peer_id) {
            if peer.messages_received > 0 {
                priority += 50;
            }
            if peer.connection_quality > 0.7 {
                priority += 30;
            }
            if peer.latency_ms.map(|ms| ms < 100).unwrap_or(false) {
                priority += 20;
            }
        }

        // Lower priority if we have many connections already
        let connected_count = self.get_connected_peers().len();
        if connected_count > 5 {
            priority = priority.saturating_sub(connected_count as u32 * 10);
        }

        // Strategic priority based on peer ID (for mesh stability)
        let id_hash = peer_id.chars().map(|c| c as u32).sum::<u32>();
        priority += (id_hash % 20) as u32;

        priority
    }

    fn calculate_connection_delay(&self, peer_id: &str) -> u64 {
        let mut delay = 500; // Base delay

        // Stagger connections to avoid overwhelming
        let connected_count = self.get_connected_peers().len();
        delay += connected_count as u64 * 1000;

        // Add jitter based on peer ID for collision avoidance
        let id_hash = peer_id.chars().map(|c| c as u64).sum::<u64>();
        delay += (id_hash % 2000) as u64;

        // Longer delay for failed connections
        if let Some(peer) = self.peers.get(peer_id) {
            delay += peer.connection_attempts as u64 * 2000;
        }

        delay.min(10000) // Max 10 second delay
    }

    pub fn get_mesh_repair_plan(&mut self) -> Vec<ConnectionDecision> {
        let mut repair_plan = Vec::new();

        // Update check timestamp
        self.last_mesh_check = js_sys::Date::now() as u64;

        // Find missing connections
        let missing_peers: Vec<String> = self.all_known_peers
            .iter()
            .filter(|peer_id| {
                *peer_id != &self.client_id &&
                !self.peers.contains_key(*peer_id) ||
                self.peers.get(*peer_id).map(|p| p.connection_state != ConnectionState::Connected).unwrap_or(true)
            })
            .cloned()
            .collect();

        // Create connection decisions for missing peers
        for peer_id in missing_peers {
            let decision = self.evaluate_connection_decision(&peer_id);
            if decision.should_connect {
                repair_plan.push(decision);
            }
        }

        // Sort by priority (highest first)
        repair_plan.sort_by(|a, b| b.priority.cmp(&a.priority));

        repair_plan
    }
}
```

### 4.3 WASM Binding Functions

```rust
// Add to src/lib.rs

#[wasm_bindgen]
pub fn initialize_p2p_manager(client_id: &str, room_id: &str) -> Result<(), JsValue> {
    if client_id.is_empty() || room_id.is_empty() {
        return Err(JsValue::from_str("Client ID and room ID cannot be empty"));
    }

    P2P_MANAGER.with(|manager| {
        let mut manager_ref = manager.borrow_mut();
        *manager_ref = Some(P2PNetworkState::new(client_id.to_string(), room_id.to_string()));
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
        }
    })?;

    Ok(())
}

#[wasm_bindgen]
pub fn should_initiate_connection_to_peer(peer_id: &str) -> bool {
    with_p2p_manager(|manager| {
        manager.should_initiate_connection(peer_id)
    }).unwrap_or(false)
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
pub fn get_connected_peer_list() -> JsValue {
    let peers = with_p2p_manager(|manager| {
        manager.get_connected_peers()
    }).unwrap_or_default();

    serde_wasm_bindgen::to_value(&peers).unwrap_or(JsValue::NULL)
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
pub fn set_connection_strategy(strategy: &str) -> Result<(), JsValue> {
    let new_strategy = match strategy {
        "full_mesh" => ConnectionStrategy::FullMesh,
        "selective" => ConnectionStrategy::Selective,
        "hub" => ConnectionStrategy::Hub,
        "adaptive" => ConnectionStrategy::Adaptive,
        _ => return Err(JsValue::from_str("Invalid connection strategy")),
    };

    with_p2p_manager(|manager| {
        manager.connection_strategy = new_strategy;
        console_log!("Connection strategy set to: {:?}", manager.connection_strategy);
    })?;

    Ok(())
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
```

### 4.4 Message Routing and Quality Management

```rust
// Add to src/p2p.rs

impl P2PNetworkState {
    pub fn get_best_peers_for_broadcast(&self, max_peers: usize) -> Vec<String> {
        let mut peer_scores: Vec<(String, f32)> = self.peers
            .iter()
            .filter(|(_, peer)| peer.connection_state == ConnectionState::Connected)
            .map(|(id, peer)| {
                let mut score = peer.connection_quality;

                // Bonus for low latency
                if let Some(latency) = peer.latency_ms {
                    score += (200.0 - latency.min(200) as f32) / 200.0 * 0.3;
                }

                // Bonus for high message throughput
                if peer.messages_sent > 0 {
                    score += 0.2;
                }

                (id.clone(), score)
            })
            .collect();

        // Sort by score (highest first)
        peer_scores.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());

        peer_scores
            .into_iter()
            .take(max_peers)
            .map(|(id, _)| id)
            .collect()
    }

    pub fn should_use_peer_for_message(&self, peer_id: &str, message_priority: u32) -> bool {
        if let Some(peer) = self.peers.get(peer_id) {
            match message_priority {
                0..=2 => peer.connection_quality > 0.3, // Low priority - any connection
                3..=7 => peer.connection_quality > 0.6, // Medium priority - good connection
                8..=10 => peer.connection_quality > 0.8, // High priority - excellent connection
                _ => true,
            }
        } else {
            false
        }
    }

    pub fn get_redundant_broadcast_plan(&self, redundancy_level: u32) -> Vec<Vec<String>> {
        let all_connected = self.get_connected_peers();
        if all_connected.is_empty() {
            return Vec::new();
        }

        match redundancy_level {
            0 => {
                // No redundancy - single best peer
                vec![vec![all_connected[0].clone()]]
            },
            1 => {
                // Low redundancy - top 2 peers
                vec![all_connected.into_iter().take(2).collect()]
            },
            2 => {
                // Medium redundancy - two groups of peers
                let mid = all_connected.len() / 2;
                if mid > 0 {
                    vec![
                        all_connected[..mid].to_vec(),
                        all_connected[mid..].to_vec(),
                    ]
                } else {
                    vec![all_connected]
                }
            },
            _ => {
                // High redundancy - all peers
                vec![all_connected]
            }
        }
    }
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

#[wasm_bindgen]
pub fn get_broadcast_plan(redundancy_level: u32) -> JsValue {
    let plan = with_p2p_manager(|manager| {
        manager.get_redundant_broadcast_plan(redundancy_level)
    }).unwrap_or_default();

    serde_wasm_bindgen::to_value(&plan).unwrap_or(JsValue::NULL)
}
```

## JavaScript Integration Steps

### Step 1: Update P2PConnection Class
Modify `js/webrtc.js` to use Rust coordination:

```javascript
export class P2PConnection {
  constructor(clientId, roomId, signalServer) {
    this.clientId = clientId;
    this.roomId = roomId;
    this.signalServer = signalServer;

    // Initialize Rust P2P manager
    window.safeWasm.initialize_p2p_manager(clientId, roomId);

    // Keep existing WebRTC-specific properties
    this.peers = new Map();
    this.dataChannels = new Map();
    this.pendingCandidates = new Map();

    // Callbacks remain the same
    this.onMessageCallback = null;
    this.onPeerConnectedCallback = null;
    this.onPeerDisconnectedCallback = null;
    this.onConnectionLostCallback = null;

    // ICE configuration remains in JavaScript
    this.iceConfig = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' }
      ],
      iceCandidatePoolSize: 10
    };
  }

  // Update peer joining logic
  async handleSignalingMessage(message) {
    switch (message.type) {
      case 'room-joined':
        console.log('Joined room:', message.roomId, 'with existing peers:', message.peers);

        // Add all peers to Rust manager
        for (const peerId of message.peers) {
          window.safeWasm.add_known_peer(peerId);
        }

        // Use Rust logic to determine connection strategy
        const repairPlan = window.safeWasm.get_mesh_repair_plan();
        this.executeConnectionPlan(repairPlan);
        break;

      case 'peer-joined':
        console.log('Peer joined:', message.clientId);

        if (message.clientId !== this.clientId) {
          // Add to Rust manager
          window.safeWasm.add_known_peer(message.clientId);

          // Get connection decision from Rust
          const decision = window.safeWasm.get_connection_decision(message.clientId);

          if (decision.should_connect) {
            console.log(`Connecting to ${message.clientId} with priority ${decision.priority}, delay ${decision.delay_ms}ms`);
            setTimeout(() => {
              this.createPeerConnection(message.clientId, true);
            }, decision.delay_ms);
          } else {
            console.log(`Not connecting to ${message.clientId}: ${decision.reason}`);
          }
        }
        break;

      // ... other cases remain similar
    }
  }

  // Execute connection plan from Rust
  async executeConnectionPlan(plan) {
    for (const decision of plan) {
      if (decision.should_connect) {
        setTimeout(async () => {
          try {
            await this.createPeerConnection(decision.peer_id, true);
          } catch (error) {
            console.error(`Failed to execute connection plan for ${decision.peer_id}:`, error);
            window.safeWasm.handle_connection_failure(decision.peer_id);
          }
        }, decision.delay_ms);
      }
    }
  }

  // Update connection state tracking
  async createPeerConnection(peerId, createOffer = false) {
    console.log(`Creating peer connection to ${peerId}, createOffer: ${createOffer}`);

    // Update Rust state
    window.safeWasm.update_peer_connection_state(peerId, 'connecting');

    // ... existing WebRTC logic ...

    pc.onconnectionstatechange = () => {
      console.log(`Connection state with ${peerId}:`, pc.connectionState);

      // Update Rust state
      window.safeWasm.update_peer_connection_state(peerId, pc.connectionState);

      if (pc.connectionState === 'connected') {
        console.log(`✅ Successfully connected to peer ${peerId}`);
        if (this.onPeerConnectedCallback) {
          this.onPeerConnectedCallback(peerId);
        }
      } else if (pc.connectionState === 'failed') {
        console.log(`❌ Connection failed with peer ${peerId}`);

        // Get reconnection strategy from Rust
        const strategy = window.safeWasm.handle_connection_failure(peerId);

        if (strategy.should_connect) {
          console.log(`Will retry connection to ${peerId} in ${strategy.delay_ms}ms`);
          setTimeout(() => {
            this.createPeerConnection(peerId, true);
          }, strategy.delay_ms);
        }

        this.removePeer(peerId);
      }
    };

    // ... rest of existing WebRTC logic ...
  }
}
```

### Step 2: Update Broadcasting Logic
```javascript
// Enhanced broadcast function using Rust coordination
broadcast(message) {
  const messageStr = JSON.stringify(message);
  const messageSize = new Blob([messageStr]).size;

  // Get optimal peers for broadcast from Rust
  const bestPeers = window.safeWasm.get_best_peers_for_broadcast(10);
  let deliveredCount = 0;

  console.log(`📡 Broadcasting message type '${message.type}' to ${bestPeers.length} optimal peers`);

  for (const peerId of bestPeers) {
    const channel = this.dataChannels.get(peerId);

    if (channel && channel.readyState === 'open') {
      // Check if we should send to this peer based on message priority
      const priority = message.priority || 5; // Default medium priority
      if (window.safeWasm.should_send_to_peer(peerId, priority)) {
        try {
          channel.send(messageStr);

          // Record successful send in Rust
          window.safeWasm.record_peer_message_sent(peerId, messageSize);
          deliveredCount++;

          console.log(`✅ Message sent to ${peerId}`);
        } catch (error) {
          console.error(`❌ Error sending to ${peerId}:`, error);
          window.safeWasm.handle_connection_failure(peerId);
        }
      }
    }
  }

  console.log(`📊 Broadcast result: ${deliveredCount}/${bestPeers.length} delivered`);
  return deliveredCount;
}

// Update message reception tracking
setupDataChannel(dataChannel, peerId) {
  dataChannel.onmessage = (event) => {
    if (this.onMessageCallback) {
      try {
        const message = JSON.parse(event.data);
        const messageSize = new Blob([event.data]).size;

        // Record message reception in Rust
        window.safeWasm.record_peer_message_received(peerId, messageSize);

        this.onMessageCallback(message, peerId);
      } catch (error) {
        console.error('Error parsing message:', error);
      }
    }
  };

  // ... rest of existing setup logic ...
}
```

### Step 3: Add Mesh Monitoring
```javascript
// Enhanced mesh monitoring using Rust logic
startMeshMonitoring() {
  if (this.meshCheckInterval) {
    clearInterval(this.meshCheckInterval);
  }

  this.meshCheckInterval = setInterval(() => {
    // Check if mesh repair is needed
    if (window.safeWasm.needs_mesh_repair()) {
      console.log('🔍 Mesh repair needed, getting repair plan...');

      const repairPlan = window.safeWasm.get_mesh_repair_plan();
      this.executeConnectionPlan(repairPlan);
    }

    // Clean up stale peers
    const removedCount = window.safeWasm.cleanup_stale_peers(5); // 5 minute timeout
    if (removedCount > 0) {
      console.log(`🧹 Cleaned up ${removedCount} stale peers`);
    }

    // Log network stats
    const stats = window.safeWasm.get_p2p_network_stats();
    console.log('📊 Network stats:', stats);
  }, 10000); // Every 10 seconds
}
```

### Step 4: Latency Measurement
```javascript
// Add ping/pong system for latency measurement
startLatencyMeasurement() {
  setInterval(() => {
    const connectedPeers = window.safeWasm.get_connected_peer_list();

    for (const peerId of connectedPeers) {
      const channel = this.dataChannels.get(peerId);
      if (channel && channel.readyState === 'open') {
        const pingStart = performance.now();
        const pingMessage = {
          type: 'ping',
          timestamp: pingStart,
          sender_id: this.clientId
        };

        try {
          channel.send(JSON.stringify(pingMessage));

          // Store ping time for pong response
          this.pendingPings = this.pendingPings || new Map();
          this.pendingPings.set(peerId, pingStart);
        } catch (error) {
          console.error(`Failed to send ping to ${peerId}:`, error);
        }
      }
    }
  }, 30000); // Every 30 seconds
}

// Handle ping/pong messages
handlePingPong(message, peerId) {
  if (message.type === 'ping') {
    // Respond with pong
    const pongMessage = {
      type: 'pong',
      timestamp: message.timestamp,
      sender_id: this.clientId
    };

    const channel = this.dataChannels.get(peerId);
    if (channel && channel.readyState === 'open') {
      channel.send(JSON.stringify(pongMessage));
    }
  } else if (message.type === 'pong') {
    // Calculate latency
    this.pendingPings = this.pendingPings || new Map();
    const pingStart = this.pendingPings.get(peerId);

    if (pingStart) {
      const latency = Math.round(performance.now() - pingStart);
      console.log(`Latency to ${peerId}: ${latency}ms`);

      // Update latency in Rust
      window.safeWasm.update_peer_latency(peerId, latency);

      this.pendingPings.delete(peerId);
    }
  }
}
```

## Dependencies to Add

Add to `Cargo.toml`:

```toml
[dependencies]
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
serde-wasm-bindgen = "0.6"

[dependencies.web-sys]
features = [
  "console",
  "Performance",
]
```

## Testing Strategy

### Unit Tests in Rust
```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_connection_decision_logic() {
        let mut network = P2PNetworkState::new("peer1".to_string(), "room1".to_string());
        network.add_peer("peer2".to_string());

        let decision = network.evaluate_connection_decision("peer2");
        assert!(decision.should_connect);
        assert!(decision.priority > 0);
    }

    #[test]
    fn test_mesh_repair_detection() {
        let mut network = P2PNetworkState::new("peer1".to_string(), "room1".to_string());

        // Add known peers but no connections
        network.add_peer("peer2".to_string());
        network.add_peer("peer3".to_string());

        assert!(network.needs_mesh_repair());

        let plan = network.get_mesh_repair_plan();
        assert_eq!(plan.len(), 2); // Should have plans for both peers
    }

    #[test]
    fn test_connection_priority_calculation() {
        let mut network = P2PNetworkState::new("peer1".to_string(), "room1".to_string());

        // Add a high-quality peer
        let mut peer = PeerConnection::new("peer2".to_string(), PeerRole::Responder);
        peer.connection_quality = 0.9;
        peer.latency_ms = Some(50);
        peer.messages_received = 100;
        network.peers.insert("peer2".to_string(), peer);

        let priority = network.calculate_connection_priority("peer2");
        assert!(priority > 150); // Should be high priority
    }

    #[test]
    fn test_broadcast_peer_selection() {
        let mut network = P2PNetworkState::new("peer1".to_string(), "room1".to_string());

        // Add peers with different qualities
        for i in 0..5 {
            let mut peer = PeerConnection::new(format!("peer{}", i), PeerRole::Responder);
            peer.connection_state = ConnectionState::Connected;
            peer.connection_quality = (i as f32) / 10.0;
            network.peers.insert(format!("peer{}", i), peer);
        }

        let best_peers = network.get_best_peers_for_broadcast(3);
        assert_eq!(best_peers.len(), 3);

        // Should select highest quality peers
        assert!(best_peers.contains(&"peer4".to_string()));
        assert!(best_peers.contains(&"peer3".to_string()));
    }
}
```

### Integration Tests
1. **Connection Strategy Testing**: Verify different strategies work correctly
2. **Mesh Repair Testing**: Test automatic connection recovery
3. **Performance Testing**: Measure decision-making speed
4. **Reliability Testing**: Test under network failures

## Success Criteria

- [ ] P2P state management moved to Rust
- [ ] Connection strategies implemented and working
- [ ] Mesh repair automation functioning
- [ ] Message routing optimization active
- [ ] Latency measurement and quality tracking working
- [ ] Performance equal or better than JavaScript-only version
- [ ] All WebRTC functionality preserved
- [ ] Connection reliability improved

## Timeline: Week 7-8 (14 days)

### Days 1-5: Rust Implementation
- Implement P2P state management structures
- Create connection strategy algorithms
- Add mesh repair logic
- Write comprehensive unit tests

### Days 6-10: JavaScript Integration
- Update P2PConnection class to use Rust coordination
- Implement enhanced broadcasting logic
- Add latency measurement system
- Test connection strategies

### Days 11-14: Optimization and Testing
- Performance optimization and benchmarking
- Reliability testing under various network conditions
- Connection strategy tuning
- Bug fixes and documentation

## Risks and Mitigation

### Risk: Increased Complexity
- **Mitigation**: Clear separation between Rust logic and WebRTC APIs
- **Solution**: Comprehensive documentation and testing

### Risk: Performance Overhead
- **Mitigation**: Benchmark decision-making vs connection benefits
- **Solution**: Optimize Rust algorithms and minimize WASM calls

### Risk: WebRTC Compatibility Issues
- **Mitigation**: Keep all WebRTC APIs in JavaScript unchanged
- **Solution**: Only migrate coordination logic, not browser APIs

This phase provides intelligent P2P networking while keeping WebRTC APIs in their native JavaScript environment, resulting in more reliable and efficient mesh networking.