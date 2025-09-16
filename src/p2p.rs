// src/p2p.rs - P2P Network Coordination Module

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use wasm_bindgen::prelude::*;

// Macro for logging to browser console
macro_rules! console_log {
    ($($t:tt)*) => (crate::log(&format!($($t)*)))
}

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

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub enum ConnectionStrategy {
    FullMesh,      // Connect to all peers
    Selective,     // Connect to subset based on quality
    Hub,           // One peer acts as hub
    Adaptive,      // Change strategy based on network conditions
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
                self.client_id.as_str() > peer_id
            },
            ConnectionStrategy::Selective => {
                // More complex logic for selective connections
                let connected_count = self.get_connected_peers().len();
                connected_count < 3 && self.client_id.as_str() > peer_id
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

    pub fn get_average_connection_quality(&self) -> f32 {
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
        connected_count < 3 || (avg_quality > 0.7 && self.client_id.as_str() > peer_id)
    }
}

// Global P2P manager
thread_local! {
    pub static P2P_MANAGER: std::cell::RefCell<Option<P2PNetworkState>> = std::cell::RefCell::new(None);
}

pub fn with_p2p_manager<F, R>(f: F) -> Result<R, JsValue>
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

// Connection Decision Logic
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
        let mut priority: u32 = 100; // Base priority

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
                (!self.peers.contains_key(*peer_id) ||
                self.peers.get(*peer_id).map(|p| p.connection_state != ConnectionState::Connected).unwrap_or(true))
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

// Unit Tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_peer_connection_new() {
        let peer = PeerConnection::new("peer123".to_string(), PeerRole::Initiator);
        assert_eq!(peer.peer_id, "peer123");
        assert_eq!(peer.connection_state, ConnectionState::Disconnected);
        assert_eq!(peer.peer_role, PeerRole::Initiator);
        assert_eq!(peer.connection_quality, 0.0);
    }

    #[test]
    fn test_connection_state_update() {
        let mut peer = PeerConnection::new("peer123".to_string(), PeerRole::Responder);

        peer.update_connection_state(ConnectionState::Connected);
        assert_eq!(peer.connection_state, ConnectionState::Connected);
        assert!(peer.connection_quality > 0.0);

        peer.update_connection_state(ConnectionState::Failed);
        assert_eq!(peer.connection_state, ConnectionState::Failed);
        assert_eq!(peer.connection_quality, 0.0);
    }

    #[test]
    fn test_should_reconnect() {
        let mut peer = PeerConnection::new("peer123".to_string(), PeerRole::Unknown);

        // Should not reconnect when connected
        peer.update_connection_state(ConnectionState::Connected);
        assert!(!peer.should_reconnect(5, 1000));

        // Should reconnect when failed and attempts < max
        peer.update_connection_state(ConnectionState::Failed);
        peer.connection_attempts = 2;
        peer.last_attempt = 0;
        assert!(peer.should_reconnect(5, 0));

        // Should not reconnect when max attempts reached
        peer.connection_attempts = 5;
        assert!(!peer.should_reconnect(5, 1000));
    }

    #[test]
    fn test_p2p_network_state_new() {
        let network = P2PNetworkState::new("client1".to_string(), "room1".to_string());
        assert_eq!(network.client_id, "client1");
        assert_eq!(network.room_id, "room1");
        assert!(network.peers.is_empty());
        assert!(network.all_known_peers.is_empty());
        assert_eq!(network.connection_strategy, ConnectionStrategy::FullMesh);
    }

    #[test]
    fn test_add_remove_peer() {
        let mut network = P2PNetworkState::new("client1".to_string(), "room1".to_string());

        // Add new peer
        assert!(network.add_peer("peer2".to_string()));
        assert!(network.all_known_peers.contains("peer2"));

        // Adding same peer returns false
        assert!(!network.add_peer("peer2".to_string()));

        // Cannot add self
        assert!(!network.add_peer("client1".to_string()));

        // Remove peer
        network.remove_peer("peer2");
        assert!(!network.all_known_peers.contains("peer2"));
    }

    #[test]
    fn test_should_initiate_connection() {
        let network = P2PNetworkState::new("client1".to_string(), "room1".to_string());

        // FullMesh strategy - lexicographic comparison
        assert!(!network.should_initiate_connection("client2")); // "client1" < "client2"
        assert!(network.should_initiate_connection("client0")); // "client1" > "client0"
    }

    #[test]
    fn test_connection_decision_logic() {
        let mut network = P2PNetworkState::new("client1".to_string(), "room1".to_string());
        network.add_peer("peer2".to_string());

        // Should connect to new peer
        let decision = network.evaluate_connection_decision("peer2");
        assert!(decision.should_connect);
        assert!(decision.priority > 0);
        assert!(decision.delay_ms > 0);

        // Should not connect to self
        let decision = network.evaluate_connection_decision("client1");
        assert!(!decision.should_connect);
        assert_eq!(decision.reason, "Cannot connect to self");
    }

    #[test]
    fn test_mesh_repair_plan() {
        let mut network = P2PNetworkState::new("client1".to_string(), "room1".to_string());

        // Add known peers but no connections
        network.add_peer("peer2".to_string());
        network.add_peer("peer3".to_string());

        let plan = network.get_mesh_repair_plan();
        // Should not include connections we shouldn't initiate (lexicographic comparison)
        // "client1" < "peer2" and "client1" < "peer3", so we shouldn't initiate
        assert_eq!(plan.len(), 0);

        // Add a peer we should connect to
        network.add_peer("client0".to_string());
        let plan = network.get_mesh_repair_plan();
        assert_eq!(plan.len(), 1);
        assert_eq!(plan[0].should_connect, true);
    }

    #[test]
    fn test_broadcast_peer_selection() {
        let mut network = P2PNetworkState::new("client1".to_string(), "room1".to_string());

        // Add peers with different qualities
        for i in 0..5 {
            let peer_id = format!("peer{}", i);
            let mut peer = PeerConnection::new(peer_id.clone(), PeerRole::Responder);
            peer.connection_state = ConnectionState::Connected;
            peer.connection_quality = (i as f32) / 10.0;
            network.peers.insert(peer_id, peer);
        }

        let best_peers = network.get_best_peers_for_broadcast(3);
        assert_eq!(best_peers.len(), 3);

        // Should select highest quality peers (peer4, peer3, peer2)
        assert!(best_peers.contains(&"peer4".to_string()));
        assert!(best_peers.contains(&"peer3".to_string()));
    }

    #[test]
    fn test_message_priority_filtering() {
        let mut network = P2PNetworkState::new("client1".to_string(), "room1".to_string());

        let mut peer = PeerConnection::new("peer1".to_string(), PeerRole::Responder);
        peer.connection_state = ConnectionState::Connected;

        // Low quality peer
        peer.connection_quality = 0.4;
        network.peers.insert("peer1".to_string(), peer);

        // Should send low priority messages
        assert!(network.should_use_peer_for_message("peer1", 1));

        // Should not send high priority messages to low quality peer
        assert!(!network.should_use_peer_for_message("peer1", 9));

        // Unknown peer should return false
        assert!(!network.should_use_peer_for_message("unknown", 5));
    }

    #[test]
    fn test_average_connection_quality() {
        let mut network = P2PNetworkState::new("client1".to_string(), "room1".to_string());

        // Empty network has 0 quality
        assert_eq!(network.get_average_connection_quality(), 0.0);

        // Add peers with known qualities
        for i in 1..=4 {
            let peer_id = format!("peer{}", i);
            let mut peer = PeerConnection::new(peer_id.clone(), PeerRole::Responder);
            peer.connection_quality = i as f32 * 0.25; // 0.25, 0.5, 0.75, 1.0
            network.peers.insert(peer_id, peer);
        }

        // Average should be 0.625
        let avg = network.get_average_connection_quality();
        assert!((avg - 0.625).abs() < 0.001);
    }
}