// src/logger.rs - Comprehensive Logging System

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
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, Hash)]
pub enum LogComponent {
    Core,
    WebRTC,
    Wasm,
    Ui,
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
            "wasm" => LogComponent::Wasm,
            "ui" => LogComponent::Ui,
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
            LogComponent::Wasm => "WASM".to_string(),
            LogComponent::Ui => "UI".to_string(),
            LogComponent::P2P => "P2P".to_string(),
            LogComponent::State => "STATE".to_string(),
            LogComponent::Messages => "MSGS".to_string(),
            LogComponent::Sanitizer => "SANIT".to_string(),
            LogComponent::Network => "NET".to_string(),
            LogComponent::Storage => "STORE".to_string(),
            LogComponent::Custom(name) => name.to_uppercase(),
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
    pub data: Option<String>,
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

    pub fn format_for_console(&self) -> String {
        let timestamp = format_timestamp(self.timestamp);
        let level_str = self.level.to_str();
        let component_str = self.component.to_str();

        let mut formatted = format!(
            "[{}] [{}] [{}] {}",
            timestamp, level_str, component_str, self.message
        );

        if let Some(ref data) = self.data {
            formatted.push_str(&format!(" | Data: {}", data));
        }

        if let (Some(ref file), Some(line)) = (&self.file, self.line) {
            formatted.push_str(&format!(" | {}:{}", file, line));
        }

        formatted
    }

    pub fn get_search_text(&self) -> String {
        let mut search_text = format!(
            "{} {} {}",
            self.level.to_str(),
            self.component.to_str(),
            self.message
        );

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

#[allow(dead_code)]
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

#[derive(Debug, Clone, Serialize, Deserialize)]
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
    pub config: LoggerConfig,
    log_buffer: VecDeque<LogEntry>,
    #[allow(dead_code)]
    performance_timers: HashMap<String, u64>,
    group_stack: Vec<String>,
    current_context: LogContext,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct LogContext {
    pub user_id: Option<String>,
    pub room_id: Option<String>,
    pub component: Option<LogComponent>,
}

#[allow(dead_code)]
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

    pub fn log_with_data(
        &mut self,
        level: LogLevel,
        component: LogComponent,
        message: &str,
        data: Option<&str>,
    ) {
        let mut entry = LogEntry::new(
            level,
            component,
            message.to_string(),
            self.config.session_id.clone(),
        )
        .with_context(
            self.current_context.user_id.clone(),
            self.current_context.room_id.clone(),
        );

        if let Some(data) = data {
            entry = entry.with_data(data);
        }

        self.add_log_entry(entry);
    }

    pub fn debug(&mut self, component: LogComponent, message: &str) {
        if self.config.debug_enabled || self.config.is_development {
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
            self.export_recent_logs(50);
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
        if entry.level == LogLevel::Debug
            && !self.config.is_development
            && !self.config.debug_enabled
        {
            return;
        }

        // Always show warnings and errors, or everything in development
        if entry.level >= LogLevel::Warn || self.config.is_development {
            let formatted = entry.format_for_console();

            match entry.level {
                LogLevel::Debug => console::log_1(&formatted.into()),
                LogLevel::Info => console::info_1(&formatted.into()),
                LogLevel::Warn => console::warn_1(&formatted.into()),
                LogLevel::Error => console::error_1(&formatted.into()),
            }
        }
    }

    pub fn group(&mut self, label: &str) {
        self.group_stack.push(label.to_string());

        if self.config.is_development {
            console::group_1(&label.into());
        }
    }

    pub fn group_end(&mut self) {
        if self.group_stack.pop().is_some() && self.config.is_development {
            console::group_end();
        }
    }

    pub fn table(&mut self, data: &JsValue) {
        if self.config.is_development {
            console::table_1(data);
        }
    }

    pub fn get_logs(&self, filter: Option<LogFilter>) -> Vec<LogEntry> {
        if let Some(filter) = filter {
            self.log_buffer
                .iter()
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
        serde_json::to_string_pretty(&logs)
            .unwrap_or_else(|_| "Failed to serialize logs".to_string())
    }

    pub fn export_recent_logs(&self, count: usize) -> String {
        let recent_logs: Vec<LogEntry> =
            self.log_buffer.iter().rev().take(count).cloned().collect();

        serde_json::to_string_pretty(&recent_logs)
            .unwrap_or_else(|_| "Failed to serialize logs".to_string())
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

            *stats
                .component_counts
                .entry(entry.component.clone())
                .or_insert(0) += 1;
        }

        if let Some(oldest) = self.log_buffer.front() {
            stats.oldest_log_time = Some(oldest.timestamp);
        }

        if let Some(newest) = self.log_buffer.back() {
            stats.newest_log_time = Some(newest.timestamp);
        }

        stats
    }

    pub fn search_logs(&self, query: &str, limit: Option<usize>) -> Vec<LogEntry> {
        let query_lower = query.to_lowercase();
        let mut results: Vec<LogEntry> = self
            .log_buffer
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

    pub fn get_logs_by_component(
        &self,
        component: LogComponent,
        limit: Option<usize>,
    ) -> Vec<LogEntry> {
        let mut results: Vec<LogEntry> = self
            .log_buffer
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
        let cutoff_time =
            (js_sys::Date::now() as u64).saturating_sub(last_n_minutes as u64 * 60 * 1000);

        let recent_errors: Vec<&LogEntry> = self
            .log_buffer
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

// Utility functions
fn generate_log_id() -> String {
    let timestamp = js_sys::Date::now() as u64;
    format!("log_{}_{}", timestamp, crate::utils::generate_uuid())
}

fn generate_session_id() -> String {
    let timestamp = js_sys::Date::now() as u64;
    format!("session_{}_{}", timestamp, crate::utils::generate_uuid())
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

    format!(
        "{:02}:{:02}:{:02}.{:03}",
        date.get_hours(),
        date.get_minutes(),
        date.get_seconds(),
        date.get_milliseconds()
    )
}

// Global logger instance
thread_local! {
    pub static GLOBAL_LOGGER: std::cell::RefCell<Option<Logger>> = const { std::cell::RefCell::new(None) };
}

pub fn with_logger<F, R>(f: F) -> Result<R, JsValue>
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

// Convenience macros for internal use
#[macro_export]
macro_rules! log_debug {
    ($component:expr, $($arg:tt)*) => {
        let _ = $crate::logger::with_logger(|logger| {
            logger.debug($component, &format!($($arg)*));
        });
    };
}

#[macro_export]
macro_rules! log_info {
    ($component:expr, $($arg:tt)*) => {
        let _ = $crate::logger::with_logger(|logger| {
            logger.info($component, &format!($($arg)*));
        });
    };
}

#[macro_export]
macro_rules! log_warn {
    ($component:expr, $($arg:tt)*) => {
        let _ = $crate::logger::with_logger(|logger| {
            logger.warn($component, &format!($($arg)*));
        });
    };
}

#[macro_export]
macro_rules! log_error {
    ($component:expr, $($arg:tt)*) => {
        let _ = $crate::logger::with_logger(|logger| {
            logger.error($component, &format!($($arg)*));
        });
    };
}
