# Phase 5: Logging System Migration

## Overview
Migrate the logging system from JavaScript to Rust for centralized, efficient, and consistent logging across the entire application. This phase provides better performance, structured logging, and advanced debugging capabilities.

## Current State Analysis

### JavaScript Logging System (`js/logger.js` - 135 lines)
- **Logger class**: Production-safe logging with development mode detection
- **Log levels**: Debug, info, warn, error with conditional output
- **Component-specific logging**: WebRTC, WASM, UI, P2P specialized loggers
- **Performance logging**: Time measurement and grouping
- **Development features**: Enhanced console formatting and debug controls

### Benefits of Rust Migration
- **Performance**: Faster log processing and formatting
- **Memory efficiency**: More efficient log buffering and rotation
- **Consistency**: Same logging behavior across all components
- **Structured logging**: Better log format standardization
- **Advanced features**: Log filtering, searching, and export capabilities

## Implementation Plan

### 5.1 Core Logging System in Rust

```rust
// Create src/logger.rs

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use wasm_bindgen::prelude::*;
use web_sys::console;

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum LogLevel {
    Debug = 0,
    Info = 1,
    Warn = 2,
    Error = 3,
}

impl LogLevel {
    pub fn from_str(level: &str) -> Option<Self> {
        match level.to_lowercase().as_str() {
            "debug" => Some(LogLevel::Debug),
            "info" => Some(LogLevel::Info),
            "warn" => Some(LogLevel::Warn),
            "error" => Some(LogLevel::Error),
            _ => None,
        }
    }

    pub fn to_str(self) -> &'static str {
        match self {
            LogLevel::Debug => "DEBUG",
            LogLevel::Info => "INFO",
            LogLevel::Warn => "WARN",
            LogLevel::Error => "ERROR",
        }
    }

    pub fn to_color(self) -> &'static str {
        match self {
            LogLevel::Debug => "#9b59b6", // Purple
            LogLevel::Info => "#3498db",  // Blue
            LogLevel::Warn => "#f39c12",  // Orange
            LogLevel::Error => "#e74c3c", // Red
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub enum LogComponent {
    Core,
    WebRTC,
    WASM,
    UI,
    P2P,
    State,
    Messages,
    Sanitizer,
    Network,
    Storage,
    Custom(String),
}

impl LogComponent {
    pub fn from_str(component: &str) -> Self {
        match component.to_lowercase().as_str() {
            "core" => LogComponent::Core,
            "webrtc" => LogComponent::WebRTC,
            "wasm" => LogComponent::WASM,
            "ui" => LogComponent::UI,
            "p2p" => LogComponent::P2P,
            "state" => LogComponent::State,
            "messages" => LogComponent::Messages,
            "sanitizer" => LogComponent::Sanitizer,
            "network" => LogComponent::Network,
            "storage" => LogComponent::Storage,
            _ => LogComponent::Custom(component.to_string()),
        }
    }

    pub fn to_str(&self) -> String {
        match self {
            LogComponent::Core => "CORE".to_string(),
            LogComponent::WebRTC => "WebRTC".to_string(),
            LogComponent::WASM => "WASM".to_string(),
            LogComponent::UI => "UI".to_string(),
            LogComponent::P2P => "P2P".to_string(),
            LogComponent::State => "STATE".to_string(),
            LogComponent::Messages => "MSGS".to_string(),
            LogComponent::Sanitizer => "SANIT".to_string(),
            LogComponent::Network => "NET".to_string(),
            LogComponent::Storage => "STORE".to_string(),
            LogComponent::Custom(name) => name.to_uppercase(),
        }
    }

    pub fn to_color(&self) -> &'static str {
        match self {
            LogComponent::Core => "#2c3e50",
            LogComponent::WebRTC => "#27ae60",
            LogComponent::WASM => "#e67e22",
            LogComponent::UI => "#8e44ad",
            LogComponent::P2P => "#16a085",
            LogComponent::State => "#34495e",
            LogComponent::Messages => "#2980b9",
            LogComponent::Sanitizer => "#c0392b",
            LogComponent::Network => "#7f8c8d",
            LogComponent::Storage => "#8c5f1e",
            LogComponent::Custom(_) => "#95a5a6",
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct LogEntry {
    pub id: String,
    pub timestamp: u64,
    pub level: LogLevel,
    pub component: LogComponent,
    pub message: String,
    pub data: Option<String>, // JSON serialized additional data
    pub file: Option<String>,
    pub line: Option<u32>,
    pub function: Option<String>,
    pub session_id: String,
    pub user_id: Option<String>,
    pub room_id: Option<String>,
}

impl LogEntry {
    pub fn new(
        level: LogLevel,
        component: LogComponent,
        message: String,
        session_id: String,
    ) -> Self {
        Self {
            id: generate_log_id(),
            timestamp: js_sys::Date::now() as u64,
            level,
            component,
            message,
            data: None,
            file: None,
            line: None,
            function: None,
            session_id,
            user_id: None,
            room_id: None,
        }
    }

    pub fn with_data(mut self, data: &str) -> Self {
        self.data = Some(data.to_string());
        self
    }

    pub fn with_context(mut self, user_id: Option<String>, room_id: Option<String>) -> Self {
        self.user_id = user_id;
        self.room_id = room_id;
        self
    }

    pub fn with_location(mut self, file: &str, line: u32, function: &str) -> Self {
        self.file = Some(file.to_string());
        self.line = Some(line);
        self.function = Some(function.to_string());
        self
    }

    pub fn format_for_console(&self) -> String {
        let timestamp = format_timestamp(self.timestamp);
        let level_str = self.level.to_str();
        let component_str = self.component.to_str();

        let mut formatted = format!("[{}] [{}] [{}] {}",
            timestamp, level_str, component_str, self.message);

        if let Some(ref data) = self.data {
            formatted.push_str(&format!(" | Data: {}", data));
        }

        if let (Some(ref file), Some(line)) = (&self.file, self.line) {
            formatted.push_str(&format!(" | {}:{}", file, line));
        }

        formatted
    }

    pub fn should_display_in_production(&self) -> bool {
        matches!(self.level, LogLevel::Warn | LogLevel::Error)
    }

    pub fn get_search_text(&self) -> String {
        let mut search_text = format!("{} {} {}",
            self.level.to_str(), self.component.to_str(), self.message);

        if let Some(ref data) = self.data {
            search_text.push_str(&format!(" {}", data));
        }

        if let Some(ref user_id) = self.user_id {
            search_text.push_str(&format!(" user:{}", user_id));
        }

        if let Some(ref room_id) = self.room_id {
            search_text.push_str(&format!(" room:{}", room_id));
        }

        search_text.to_lowercase()
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct LogFilter {
    pub min_level: LogLevel,
    pub components: Option<Vec<LogComponent>>,
    pub search_text: Option<String>,
    pub start_time: Option<u64>,
    pub end_time: Option<u64>,
    pub user_id: Option<String>,
    pub room_id: Option<String>,
}

impl LogFilter {
    pub fn new() -> Self {
        Self {
            min_level: LogLevel::Debug,
            components: None,
            search_text: None,
            start_time: None,
            end_time: None,
            user_id: None,
            room_id: None,
        }
    }

    pub fn matches(&self, entry: &LogEntry) -> bool {
        // Check log level
        if entry.level < self.min_level {
            return false;
        }

        // Check components
        if let Some(ref components) = self.components {
            if !components.contains(&entry.component) {
                return false;
            }
        }

        // Check time range
        if let Some(start) = self.start_time {
            if entry.timestamp < start {
                return false;
            }
        }

        if let Some(end) = self.end_time {
            if entry.timestamp > end {
                return false;
            }
        }

        // Check user ID
        if let Some(ref filter_user) = self.user_id {
            if entry.user_id.as_ref() != Some(filter_user) {
                return false;
            }
        }

        // Check room ID
        if let Some(ref filter_room) = self.room_id {
            if entry.room_id.as_ref() != Some(filter_room) {
                return false;
            }
        }

        // Check search text
        if let Some(ref search) = self.search_text {
            if !entry.get_search_text().contains(&search.to_lowercase()) {
                return false;
            }
        }

        true
    }
}

#[derive(Debug, Clone)]
pub struct LoggerConfig {
    pub is_development: bool,
    pub debug_enabled: bool,
    pub max_log_entries: usize,
    pub console_output_enabled: bool,
    pub buffer_logs: bool,
    pub auto_export_errors: bool,
    pub session_id: String,
}

impl Default for LoggerConfig {
    fn default() -> Self {
        Self {
            is_development: detect_development_mode(),
            debug_enabled: false,
            max_log_entries: 1000,
            console_output_enabled: true,
            buffer_logs: true,
            auto_export_errors: false,
            session_id: generate_session_id(),
        }
    }
}

pub struct Logger {
    config: LoggerConfig,
    log_buffer: VecDeque<LogEntry>,
    performance_timers: HashMap<String, u64>,
    group_stack: Vec<String>,
    current_context: LogContext,
}

#[derive(Debug, Clone, Default)]
pub struct LogContext {
    pub user_id: Option<String>,
    pub room_id: Option<String>,
    pub component: Option<LogComponent>,
}

impl Logger {
    pub fn new(config: LoggerConfig) -> Self {
        Self {
            config,
            log_buffer: VecDeque::new(),
            performance_timers: HashMap::new(),
            group_stack: Vec::new(),
            current_context: LogContext::default(),
        }
    }

    pub fn set_context(&mut self, context: LogContext) {
        self.current_context = context;
    }

    pub fn log(&mut self, level: LogLevel, component: LogComponent, message: &str) {
        self.log_with_data(level, component, message, None);
    }

    pub fn log_with_data(&mut self, level: LogLevel, component: LogComponent, message: &str, data: Option<&str>) {
        let mut entry = LogEntry::new(level, component, message.to_string(), self.config.session_id.clone())
            .with_context(self.current_context.user_id.clone(), self.current_context.room_id.clone());

        if let Some(data) = data {
            entry = entry.with_data(data);
        }

        self.add_log_entry(entry);
    }

    pub fn debug(&mut self, component: LogComponent, message: &str) {
        if self.config.debug_enabled {
            self.log(LogLevel::Debug, component, message);
        }
    }

    pub fn info(&mut self, component: LogComponent, message: &str) {
        self.log(LogLevel::Info, component, message);
    }

    pub fn warn(&mut self, component: LogComponent, message: &str) {
        self.log(LogLevel::Warn, component, message);
    }

    pub fn error(&mut self, component: LogComponent, message: &str) {
        self.log(LogLevel::Error, component, message);

        if self.config.auto_export_errors {
            self.export_recent_logs(50); // Export last 50 logs when error occurs
        }
    }

    fn add_log_entry(&mut self, entry: LogEntry) {
        // Output to console if enabled
        if self.config.console_output_enabled {
            self.output_to_console(&entry);
        }

        // Add to buffer if enabled
        if self.config.buffer_logs {
            self.log_buffer.push_back(entry);

            // Maintain buffer size
            while self.log_buffer.len() > self.config.max_log_entries {
                self.log_buffer.pop_front();
            }
        }
    }

    fn output_to_console(&self, entry: &LogEntry) {
        // Only show debug logs in development or when explicitly enabled
        if entry.level == LogLevel::Debug && !self.config.is_development && !self.config.debug_enabled {
            return;
        }

        // Always show warnings and errors
        if entry.level >= LogLevel::Warn || self.config.is_development {
            let formatted = entry.format_for_console();

            match entry.level {
                LogLevel::Debug => {
                    console::log_1(&format!("%c{}", formatted).into());
                },
                LogLevel::Info => {
                    console::info_1(&format!("%c{}", formatted).into());
                },
                LogLevel::Warn => {
                    console::warn_1(&format!("%c{}", formatted).into());
                },
                LogLevel::Error => {
                    console::error_1(&format!("%c{}", formatted).into());
                },
            }
        }
    }

    pub fn start_timer(&mut self, label: &str) {
        let start_time = js_sys::Date::now() as u64;
        self.performance_timers.insert(label.to_string(), start_time);

        if self.config.is_development {
            console::time_with_label(label);
        }
    }

    pub fn end_timer(&mut self, label: &str) -> Option<u64> {
        if let Some(start_time) = self.performance_timers.remove(label) {
            let duration = (js_sys::Date::now() as u64).saturating_sub(start_time);

            if self.config.is_development {
                console::time_end_with_label(label);
            }

            self.info(LogComponent::Core, &format!("⏱️  {} completed in {}ms", label, duration));
            Some(duration)
        } else {
            self.warn(LogComponent::Core, &format!("Timer '{}' was not started", label));
            None
        }
    }

    pub fn group(&mut self, label: &str) {
        self.group_stack.push(label.to_string());

        if self.config.is_development {
            console::group_1(&label.into());
        }
    }

    pub fn group_end(&mut self) {
        if let Some(label) = self.group_stack.pop() {
            if self.config.is_development {
                console::group_end();
            }
        }
    }

    pub fn table(&mut self, data: &JsValue) {
        if self.config.is_development {
            console::table_1(data);
        }
    }

    pub fn get_logs(&self, filter: Option<LogFilter>) -> Vec<LogEntry> {
        if let Some(filter) = filter {
            self.log_buffer.iter()
                .filter(|entry| filter.matches(entry))
                .cloned()
                .collect()
        } else {
            self.log_buffer.iter().cloned().collect()
        }
    }

    pub fn clear_logs(&mut self) {
        self.log_buffer.clear();
        self.info(LogComponent::Core, "Log buffer cleared");
    }

    pub fn export_logs(&self, filter: Option<LogFilter>) -> String {
        let logs = self.get_logs(filter);
        serde_json::to_string_pretty(&logs).unwrap_or_else(|_| "Failed to serialize logs".to_string())
    }

    pub fn export_recent_logs(&self, count: usize) -> String {
        let recent_logs: Vec<LogEntry> = self.log_buffer.iter()
            .rev()
            .take(count)
            .cloned()
            .collect();

        serde_json::to_string_pretty(&recent_logs).unwrap_or_else(|_| "Failed to serialize logs".to_string())
    }

    pub fn get_log_stats(&self) -> LogStats {
        let mut stats = LogStats::default();

        for entry in &self.log_buffer {
            stats.total_logs += 1;

            match entry.level {
                LogLevel::Debug => stats.debug_count += 1,
                LogLevel::Info => stats.info_count += 1,
                LogLevel::Warn => stats.warn_count += 1,
                LogLevel::Error => stats.error_count += 1,
            }

            *stats.component_counts.entry(entry.component.clone()).or_insert(0) += 1;
        }

        if let Some(oldest) = self.log_buffer.front() {
            stats.oldest_log_time = Some(oldest.timestamp);
        }

        if let Some(newest) = self.log_buffer.back() {
            stats.newest_log_time = Some(newest.timestamp);
        }

        stats
    }
}

#[derive(Serialize, Deserialize, Debug, Default)]
pub struct LogStats {
    pub total_logs: usize,
    pub debug_count: usize,
    pub info_count: usize,
    pub warn_count: usize,
    pub error_count: usize,
    pub component_counts: HashMap<LogComponent, usize>,
    pub oldest_log_time: Option<u64>,
    pub newest_log_time: Option<u64>,
}

// Utility functions
fn generate_log_id() -> String {
    let timestamp = js_sys::Date::now() as u64;
    let random = (js_sys::Math::random() * 1000000.0) as u32;
    format!("log_{}_{}", timestamp, random)
}

fn generate_session_id() -> String {
    let timestamp = js_sys::Date::now() as u64;
    let random = (js_sys::Math::random() * 1000000.0) as u32;
    format!("session_{}_{}", timestamp, random)
}

fn detect_development_mode() -> bool {
    let window = web_sys::window().unwrap();
    let location = window.location();

    if let Ok(hostname) = location.hostname() {
        hostname.contains("localhost") || hostname.contains("127.0.0.1")
    } else {
        false
    }
}

fn format_timestamp(timestamp: u64) -> String {
    let date = js_sys::Date::new_0();
    date.set_time(timestamp as f64);

    format!("{:02}:{:02}:{:02}.{:03}",
        date.get_hours(),
        date.get_minutes(),
        date.get_seconds(),
        date.get_milliseconds()
    )
}

// Global logger instance
thread_local! {
    static GLOBAL_LOGGER: std::cell::RefCell<Option<Logger>> = std::cell::RefCell::new(None);
}

fn with_logger<F, R>(f: F) -> Result<R, JsValue>
where
    F: FnOnce(&mut Logger) -> R,
{
    GLOBAL_LOGGER.with(|logger| {
        let mut logger_ref = logger.borrow_mut();
        if logger_ref.is_none() {
            *logger_ref = Some(Logger::new(LoggerConfig::default()));
        }
        Ok(f(logger_ref.as_mut().unwrap()))
    })
}
```

### 5.2 WASM Binding Functions

```rust
// Add to src/lib.rs

#[wasm_bindgen]
pub fn initialize_logger(is_development: bool, debug_enabled: bool) -> Result<(), JsValue> {
    let config = LoggerConfig {
        is_development,
        debug_enabled,
        ..LoggerConfig::default()
    };

    GLOBAL_LOGGER.with(|logger| {
        let mut logger_ref = logger.borrow_mut();
        *logger_ref = Some(Logger::new(config));
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
    let _ = with_logger(|logger| {
        logger.debug(LogComponent::from_str(component), message);
    });
}

#[wasm_bindgen]
pub fn log_info(component: &str, message: &str) {
    let _ = with_logger(|logger| {
        logger.info(LogComponent::from_str(component), message);
    });
}

#[wasm_bindgen]
pub fn log_warn(component: &str, message: &str) {
    let _ = with_logger(|logger| {
        logger.warn(LogComponent::from_str(component), message);
    });
}

#[wasm_bindgen]
pub fn log_error(component: &str, message: &str) {
    let _ = with_logger(|logger| {
        logger.error(LogComponent::from_str(component), message);
    });
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
pub fn start_performance_timer(label: &str) -> Result<(), JsValue> {
    with_logger(|logger| {
        logger.start_timer(label);
    })?;
    Ok(())
}

#[wasm_bindgen]
pub fn end_performance_timer(label: &str) -> Option<f64> {
    with_logger(|logger| {
        logger.end_timer(label).map(|duration| duration as f64)
    }).unwrap_or(None)
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

// Convenience macros for internal use
#[macro_export]
macro_rules! log_debug {
    ($component:expr, $($arg:tt)*) => {
        let _ = with_logger(|logger| {
            logger.debug($component, &format!($($arg)*));
        });
    };
}

#[macro_export]
macro_rules! log_info {
    ($component:expr, $($arg:tt)*) => {
        let _ = with_logger(|logger| {
            logger.info($component, &format!($($arg)*));
        });
    };
}

#[macro_export]
macro_rules! log_warn {
    ($component:expr, $($arg:tt)*) => {
        let _ = with_logger(|logger| {
            logger.warn($component, &format!($($arg)*));
        });
    };
}

#[macro_export]
macro_rules! log_error {
    ($component:expr, $($arg:tt)*) => {
        let _ = with_logger(|logger| {
            logger.error($component, &format!($($arg)*));
        });
    };
}
```

### 5.3 Advanced Logging Features

```rust
// Add to src/logger.rs

impl Logger {
    pub fn search_logs(&self, query: &str, limit: Option<usize>) -> Vec<LogEntry> {
        let query_lower = query.to_lowercase();
        let mut results: Vec<LogEntry> = self.log_buffer
            .iter()
            .filter(|entry| entry.get_search_text().contains(&query_lower))
            .cloned()
            .collect();

        // Sort by timestamp (newest first)
        results.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));

        if let Some(limit) = limit {
            results.truncate(limit);
        }

        results
    }

    pub fn get_logs_by_component(&self, component: LogComponent, limit: Option<usize>) -> Vec<LogEntry> {
        let mut results: Vec<LogEntry> = self.log_buffer
            .iter()
            .filter(|entry| entry.component == component)
            .cloned()
            .collect();

        results.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));

        if let Some(limit) = limit {
            results.truncate(limit);
        }

        results
    }

    pub fn get_error_summary(&self, last_n_minutes: u32) -> ErrorSummary {
        let cutoff_time = (js_sys::Date::now() as u64).saturating_sub(last_n_minutes as u64 * 60 * 1000);

        let recent_errors: Vec<&LogEntry> = self.log_buffer
            .iter()
            .filter(|entry| entry.level == LogLevel::Error && entry.timestamp >= cutoff_time)
            .collect();

        let mut error_counts: HashMap<String, u32> = HashMap::new();
        let mut component_errors: HashMap<LogComponent, u32> = HashMap::new();

        for error in &recent_errors {
            *error_counts.entry(error.message.clone()).or_insert(0) += 1;
            *component_errors.entry(error.component.clone()).or_insert(0) += 1;
        }

        ErrorSummary {
            total_errors: recent_errors.len(),
            unique_errors: error_counts.len(),
            error_counts,
            component_errors,
            time_range_minutes: last_n_minutes,
            first_error_time: recent_errors.first().map(|e| e.timestamp),
            last_error_time: recent_errors.last().map(|e| e.timestamp),
        }
    }

    pub fn create_debug_report(&self) -> DebugReport {
        let stats = self.get_log_stats();
        let error_summary = self.get_error_summary(60); // Last hour
        let recent_errors = self.get_logs(Some(LogFilter {
            min_level: LogLevel::Error,
            start_time: Some((js_sys::Date::now() as u64).saturating_sub(10 * 60 * 1000)), // Last 10 minutes
            ..LogFilter::new()
        }));

        DebugReport {
            session_id: self.config.session_id.clone(),
            generated_at: js_sys::Date::now() as u64,
            config: self.config.clone(),
            stats,
            error_summary,
            recent_errors,
            performance_timers: self.performance_timers.clone(),
            context: self.current_context.clone(),
        }
    }
}

#[derive(Serialize, Deserialize, Debug)]
pub struct ErrorSummary {
    pub total_errors: usize,
    pub unique_errors: usize,
    pub error_counts: HashMap<String, u32>,
    pub component_errors: HashMap<LogComponent, u32>,
    pub time_range_minutes: u32,
    pub first_error_time: Option<u64>,
    pub last_error_time: Option<u64>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct DebugReport {
    pub session_id: String,
    pub generated_at: u64,
    pub config: LoggerConfig,
    pub stats: LogStats,
    pub error_summary: ErrorSummary,
    pub recent_errors: Vec<LogEntry>,
    pub performance_timers: HashMap<String, u64>,
    pub context: LogContext,
}

// Additional WASM bindings for advanced features
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
    }).unwrap_or_else(|_| ErrorSummary {
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
```

## JavaScript Migration Steps

### Step 1: Update Safe WASM Proxy
Add logging functions to the safe WASM proxy:

```javascript
// In js/index.js, update createSafeWasmProxies()
function createSafeWasmProxies() {
  if (!IndexState.wasmModule) {
    logger.warn("WASM module not loaded, cannot create safe proxies");
    return;
  }

  window.safeWasm = {
    // Existing functions...
    initialize: safeWasmCall('initialize', ['userName', 'userId']),

    // New logging functions
    initialize_logger: safeWasmCall('initialize_logger', ['isDevelopment', 'debugEnabled']),
    set_log_context: safeWasmCall('set_log_context', ['userId', 'roomId', 'component']),

    log_debug: safeWasmCall('log_debug', ['component', 'message']),
    log_info: safeWasmCall('log_info', ['component', 'message']),
    log_warn: safeWasmCall('log_warn', ['component', 'message']),
    log_error: safeWasmCall('log_error', ['component', 'message']),
    log_with_data: safeWasmCall('log_with_data', ['level', 'component', 'message', 'data']),

    start_performance_timer: safeWasmCall('start_performance_timer', ['label']),
    end_performance_timer: safeWasmCall('end_performance_timer', ['label']),
    start_log_group: safeWasmCall('start_log_group', ['label']),
    end_log_group: safeWasmCall('end_log_group', []),
    log_table: safeWasmCall('log_table', ['data']),

    get_log_entries: safeWasmCall('get_log_entries', ['filterJson']),
    clear_log_buffer: safeWasmCall('clear_log_buffer', []),
    export_logs_json: safeWasmCall('export_logs_json', ['filterJson']),
    export_recent_logs_json: safeWasmCall('export_recent_logs_json', ['count']),
    get_log_statistics: safeWasmCall('get_log_statistics', []),

    enable_debug_logging: safeWasmCall('enable_debug_logging', []),
    disable_debug_logging: safeWasmCall('disable_debug_logging', []),
    configure_logger: safeWasmCall('configure_logger', ['maxEntries', 'consoleOutput', 'bufferLogs', 'autoExportErrors']),

    search_logs: safeWasmCall('search_logs', ['query', 'limit']),
    get_logs_by_component: safeWasmCall('get_logs_by_component', ['component', 'limit']),
    get_error_summary: safeWasmCall('get_error_summary', ['lastNMinutes']),
    create_debug_report: safeWasmCall('create_debug_report', []),
  };

  log("Safe WASM function proxies created with logging support");
}
```

### Step 2: Initialize Rust Logger
```javascript
// Update initializeApp function in js/index.js
async function initializeApp() {
  try {
    // Load WASM module first
    await loadWasmModule();
    createSafeWasmProxies();

    // Initialize Rust logger
    const isDevelopment = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const debugEnabled = localStorage.getItem('debugEnabled') === 'true';

    window.safeWasm.initialize_logger(isDevelopment, debugEnabled);

    // Set initial log context
    const userId = getCurrentUserId();
    const roomId = getCurrentRoomId();
    window.safeWasm.set_log_context(userId, roomId, 'core');

    // Initialize theme preference
    initializeTheme();

    // ... rest of initialization
  } catch (error) {
    console.error('Failed to initialize application:', error);
  }
}
```

### Step 3: Create Logging Wrapper
Create a compatibility wrapper for existing code:

```javascript
// Create js/rust-logger.js
class RustLoggerWrapper {
  constructor() {
    this.isDevelopment = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    this.isDebugEnabled = false;
  }

  detectDevelopmentMode() {
    return this.isDevelopment;
  }

  enableDebug() {
    this.isDebugEnabled = true;
    if (window.safeWasm && window.safeWasm.enable_debug_logging) {
      window.safeWasm.enable_debug_logging();
    }
  }

  disableDebug() {
    this.isDebugEnabled = false;
    if (window.safeWasm && window.safeWasm.disable_debug_logging) {
      window.safeWasm.disable_debug_logging();
    }
  }

  log(...args) {
    if (this.isDevelopment && window.safeWasm && window.safeWasm.log_info) {
      window.safeWasm.log_info('core', args.join(' '));
    }
  }

  info(...args) {
    if (window.safeWasm && window.safeWasm.log_info) {
      window.safeWasm.log_info('core', args.join(' '));
    }
  }

  warn(...args) {
    if (window.safeWasm && window.safeWasm.log_warn) {
      window.safeWasm.log_warn('core', args.join(' '));
    } else {
      console.warn(...args);
    }
  }

  error(...args) {
    if (window.safeWasm && window.safeWasm.log_error) {
      window.safeWasm.log_error('core', args.join(' '));
    } else {
      console.error(...args);
    }
  }

  debug(...args) {
    if (this.isDevelopment && this.isDebugEnabled && window.safeWasm && window.safeWasm.log_debug) {
      window.safeWasm.log_debug('core', args.join(' '));
    }
  }

  // Component-specific logging
  webrtc(...args) {
    if (this.isDevelopment && window.safeWasm && window.safeWasm.log_info) {
      window.safeWasm.log_info('webrtc', args.join(' '));
    }
  }

  wasm(...args) {
    if (this.isDevelopment && window.safeWasm && window.safeWasm.log_info) {
      window.safeWasm.log_info('wasm', args.join(' '));
    }
  }

  ui(...args) {
    if (this.isDevelopment && window.safeWasm && window.safeWasm.log_info) {
      window.safeWasm.log_info('ui', args.join(' '));
    }
  }

  p2p(...args) {
    if (this.isDevelopment && window.safeWasm && window.safeWasm.log_info) {
      window.safeWasm.log_info('p2p', args.join(' '));
    }
  }

  // Performance logging
  time(label) {
    if (this.isDevelopment && window.safeWasm && window.safeWasm.start_performance_timer) {
      window.safeWasm.start_performance_timer(label);
    } else {
      console.time(label);
    }
  }

  timeEnd(label) {
    if (this.isDevelopment && window.safeWasm && window.safeWasm.end_performance_timer) {
      return window.safeWasm.end_performance_timer(label);
    } else {
      console.timeEnd(label);
      return null;
    }
  }

  // Group logging
  group(label) {
    if (this.isDevelopment && window.safeWasm && window.safeWasm.start_log_group) {
      window.safeWasm.start_log_group(label);
    } else {
      console.group(label);
    }
  }

  groupEnd() {
    if (this.isDevelopment && window.safeWasm && window.safeWasm.end_log_group) {
      window.safeWasm.end_log_group();
    } else {
      console.groupEnd();
    }
  }

  // Table logging
  table(data) {
    if (this.isDevelopment && window.safeWasm && window.safeWasm.log_table) {
      window.safeWasm.log_table(data);
    } else {
      console.table(data);
    }
  }

  // Advanced features
  searchLogs(query, limit = 50) {
    if (window.safeWasm && window.safeWasm.search_logs) {
      return window.safeWasm.search_logs(query, limit);
    }
    return [];
  }

  getLogStats() {
    if (window.safeWasm && window.safeWasm.get_log_statistics) {
      return window.safeWasm.get_log_statistics();
    }
    return null;
  }

  exportLogs(filter = null) {
    if (window.safeWasm && window.safeWasm.export_logs_json) {
      return window.safeWasm.export_logs_json(filter ? JSON.stringify(filter) : null);
    }
    return '[]';
  }

  createDebugReport() {
    if (window.safeWasm && window.safeWasm.create_debug_report) {
      return window.safeWasm.create_debug_report();
    }
    return 'Debug report not available';
  }
}

// Create singleton instance and replace the old logger
const rustLogger = new RustLoggerWrapper();

// Make debug functions available globally
window.enableDebugLogging = () => rustLogger.enableDebug();
window.disableDebugLogging = () => rustLogger.disableDebug();

// Advanced debugging functions
window.searchLogs = (query, limit) => rustLogger.searchLogs(query, limit);
window.getLogStats = () => rustLogger.getLogStats();
window.exportLogs = (filter) => rustLogger.exportLogs(filter);
window.createDebugReport = () => rustLogger.createDebugReport();

export default rustLogger;
```

### Step 4: Update Existing Code
Replace logger imports across all files:

```javascript
// OLD import - REMOVE
import logger from './logger.js';

// NEW import - REPLACE WITH
import logger from './rust-logger.js';

// All existing logger calls remain the same:
logger.info('Message');
logger.error('Error message');
logger.debug('Debug info');
// etc.
```

### Step 5: Add Context Updates
Update context when user or room changes:

```javascript
// In state management functions
function setCurrentUserId(userId) {
  AppState.currentUserId = userId;

  // Update Rust logger context
  if (window.safeWasm && window.safeWasm.set_log_context) {
    window.safeWasm.set_log_context(userId, getCurrentRoomId(), null);
  }
}

function setCurrentRoomId(roomId) {
  AppState.currentRoomId = roomId;

  // Update Rust logger context
  if (window.safeWasm && window.safeWasm.set_log_context) {
    window.safeWasm.set_log_context(getCurrentUserId(), roomId, null);
  }
}
```

### Step 6: Remove Old Logger
After migration is complete:
1. Delete `js/logger.js`
2. Remove any remaining imports
3. Update any global window.logger references

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
  "Window",
  "Location",
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
    fn test_log_entry_creation() {
        let entry = LogEntry::new(
            LogLevel::Info,
            LogComponent::Core,
            "Test message".to_string(),
            "session_123".to_string(),
        );

        assert_eq!(entry.level, LogLevel::Info);
        assert_eq!(entry.component, LogComponent::Core);
        assert_eq!(entry.message, "Test message");
        assert!(entry.timestamp > 0);
    }

    #[test]
    fn test_log_filtering() {
        let mut filter = LogFilter::new();
        filter.min_level = LogLevel::Warn;
        filter.components = Some(vec![LogComponent::Core]);

        let debug_entry = LogEntry::new(LogLevel::Debug, LogComponent::Core, "Debug".to_string(), "session".to_string());
        let warn_entry = LogEntry::new(LogLevel::Warn, LogComponent::Core, "Warning".to_string(), "session".to_string());
        let error_ui_entry = LogEntry::new(LogLevel::Error, LogComponent::UI, "Error".to_string(), "session".to_string());

        assert!(!filter.matches(&debug_entry)); // Too low level
        assert!(filter.matches(&warn_entry)); // Correct level and component
        assert!(!filter.matches(&error_ui_entry)); // Wrong component
    }

    #[test]
    fn test_logger_buffer_management() {
        let config = LoggerConfig {
            max_log_entries: 3,
            ..LoggerConfig::default()
        };
        let mut logger = Logger::new(config);

        // Add more entries than buffer size
        for i in 0..5 {
            logger.info(LogComponent::Core, &format!("Message {}", i));
        }

        let logs = logger.get_logs(None);
        assert_eq!(logs.len(), 3); // Should only keep last 3
        assert!(logs[0].message.contains("Message 2")); // Oldest kept message
        assert!(logs[2].message.contains("Message 4")); // Newest message
    }

    #[test]
    fn test_search_functionality() {
        let mut logger = Logger::new(LoggerConfig::default());

        logger.info(LogComponent::Core, "User login successful");
        logger.error(LogComponent::WebRTC, "Connection failed");
        logger.debug(LogComponent::UI, "Button clicked");

        let search_results = logger.search_logs("user", None);
        assert_eq!(search_results.len(), 1);
        assert!(search_results[0].message.contains("User login"));

        let component_results = logger.get_logs_by_component(LogComponent::WebRTC, None);
        assert_eq!(component_results.len(), 1);
        assert!(component_results[0].message.contains("Connection failed"));
    }
}
```

### Performance Tests
1. **Logging Performance**: Compare Rust vs JavaScript logging speed
2. **Memory Usage**: Monitor memory consumption with large log buffers
3. **Search Performance**: Test log search with large datasets
4. **Export Performance**: Measure JSON export performance

## Success Criteria

- [ ] All logging functionality moved to Rust
- [ ] `js/logger.js` file deleted
- [ ] All existing logging calls work without changes
- [ ] Performance equal or better than JavaScript logger
- [ ] Advanced features (search, filtering, export) working
- [ ] Memory usage optimized
- [ ] Debug report generation functional
- [ ] No logging functionality lost

## Timeline: Week 9-10 (14 days)

### Days 1-3: Rust Implementation
- Implement core logging system in Rust
- Add WASM bindings
- Create structured logging features
- Write comprehensive unit tests

### Days 4-7: JavaScript Integration
- Create compatibility wrapper
- Update WASM proxy with logging functions
- Test basic logging functionality
- Migrate critical logging calls

### Days 8-10: Advanced Features
- Implement search and filtering
- Add debug report generation
- Test performance and memory usage
- Create export/import functionality

### Days 11-14: Migration and Testing
- Complete migration of all logging calls
- Remove old logger file
- Performance optimization
- Integration testing and validation

## Risks and Mitigation

### Risk: Performance Overhead
- **Mitigation**: Benchmark logging operations, optimize hot paths
- **Solution**: Efficient serialization and selective console output

### Risk: Missing Log Messages During Migration
- **Mitigation**: Gradual migration with fallback to console logging
- **Solution**: Comprehensive wrapper that handles missing WASM functions

### Risk: Advanced Features Complexity
- **Mitigation**: Implement core features first, advanced features optional
- **Solution**: Progressive enhancement of logging capabilities

This phase provides a robust, centralized logging system that improves debugging capabilities while maintaining all existing functionality and adding powerful new features for troubleshooting and monitoring.