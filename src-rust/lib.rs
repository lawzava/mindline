// src/lib.rs
// Version 1.0.2 - Added encryption key persistence

// Core modules
pub mod core;
pub mod state;
pub mod types;

// API modules
pub mod advanced_api;
pub mod crypto_api;
pub mod logging_api;
pub mod message_api;
pub mod state_api;
pub mod utils;
pub mod validation_api;

// Note: p2p_api.rs removed - all P2P coordination now in JavaScript

// Internal modules
mod crypto;
mod logger;
mod messages;
mod performance;
mod sanitizer;
mod storage;

// Re-export all public functions from modules for backward compatibility
pub use advanced_api::*;
pub use core::*;
pub use crypto_api::*;
pub use logging_api::*;
pub use message_api::*;
pub use state_api::*;
pub use utils::*;
pub use validation_api::*;

// Re-export the console_log macro
pub use core::log;
