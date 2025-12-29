// src/lib.rs
// Version 1.0.1 - Memory access fix applied - Refactored into modules

// Core modules
pub mod types;
pub mod state;
pub mod core;

// API modules
pub mod state_api;
pub mod utils;
pub mod validation_api;
pub mod message_api;
pub mod p2p_api;
pub mod logging_api;
pub mod advanced_api;

// External modules (Phase 2-6)
mod sanitizer;
mod messages;
// mod p2p; // P2P coordination moved to JavaScript
mod logger;
mod crypto;
mod storage;
mod performance;

// Re-export all public functions from modules for backward compatibility
pub use core::*;
pub use state_api::*;
pub use utils::*;
pub use validation_api::*;
pub use message_api::*;
pub use p2p_api::*;
pub use logging_api::*;
pub use advanced_api::*;

// Re-export the console_log macro
pub use core::log;