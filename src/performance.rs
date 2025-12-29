// src/performance.rs - Performance monitoring system for Phase 6

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use wasm_bindgen::prelude::*;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PerformanceMetric {
    pub id: String,
    pub name: String,
    pub value: f64,
    pub unit: String,
    pub timestamp: u64,
    pub category: MetricCategory,
    pub tags: HashMap<String, String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub enum MetricCategory {
    Memory,
    Network,
    Rendering,
    Computation,
    Storage,
    P2P,
    Wasm,
    Custom,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PerformanceSample {
    pub timestamp: u64,
    pub memory_usage_mb: f64,
    pub wasm_memory_mb: f64,
    pub message_processing_time_ms: f64,
    pub p2p_latency_ms: f64,
    pub active_connections: u32,
    pub messages_per_second: f64,
    pub frame_rate: f64,
    pub cpu_usage_percent: f64,
}

pub struct PerformanceMonitor {
    metrics: VecDeque<PerformanceMetric>,
    samples: VecDeque<PerformanceSample>,
    max_metrics: usize,
    max_samples: usize,
    collection_interval: u64,
    last_collection: u64,
    timers: HashMap<String, f64>,
    counters: HashMap<String, u64>,
}

impl PerformanceMonitor {
    pub fn new(max_metrics: usize, max_samples: usize) -> Self {
        Self {
            metrics: VecDeque::new(),
            samples: VecDeque::new(),
            max_metrics,
            max_samples,
            collection_interval: 1000, // 1 second
            last_collection: 0,
            timers: HashMap::new(),
            counters: HashMap::new(),
        }
    }

    pub fn start_timer(&mut self, name: &str) {
        let start_time = self.get_high_precision_time();
        self.timers.insert(name.to_string(), start_time);
    }

    pub fn end_timer(&mut self, name: &str) -> Option<f64> {
        if let Some(start_time) = self.timers.remove(name) {
            let duration = self.get_high_precision_time() - start_time;
            self.record_metric(name, duration, "ms", MetricCategory::Computation);
            Some(duration)
        } else {
            None
        }
    }

    pub fn record_metric(&mut self, name: &str, value: f64, unit: &str, category: MetricCategory) {
        let metric = PerformanceMetric {
            id: format!("{}_{}", name, self.get_high_precision_time() as u64),
            name: name.to_string(),
            value,
            unit: unit.to_string(),
            timestamp: js_sys::Date::now() as u64,
            category,
            tags: HashMap::new(),
        };

        self.add_metric(metric);
    }

    pub fn increment_counter(&mut self, name: &str) {
        let count = self.counters.entry(name.to_string()).or_insert(0);
        *count += 1;
    }

    pub fn get_counter(&self, name: &str) -> u64 {
        self.counters.get(name).copied().unwrap_or(0)
    }

    pub fn collect_system_metrics(&mut self) {
        let now = js_sys::Date::now() as u64;

        if now - self.last_collection < self.collection_interval {
            return;
        }

        self.last_collection = now;

        // Collect memory metrics if available
        if let Ok(memory) = self.get_memory_info() {
            self.record_metric(
                "js_heap_used",
                memory.used_js_heap_size as f64 / 1024.0 / 1024.0,
                "MB",
                MetricCategory::Memory,
            );
            self.record_metric(
                "js_heap_total",
                memory.total_js_heap_size as f64 / 1024.0 / 1024.0,
                "MB",
                MetricCategory::Memory,
            );
            self.record_metric(
                "js_heap_limit",
                memory.js_heap_size_limit as f64 / 1024.0 / 1024.0,
                "MB",
                MetricCategory::Memory,
            );
        }

        // Collect WASM memory metrics
        if let Ok(wasm_memory) = self.get_wasm_memory_usage() {
            self.record_metric("wasm_memory", wasm_memory, "MB", MetricCategory::Wasm);
        }

        // Create performance sample
        let sample = PerformanceSample {
            timestamp: now,
            memory_usage_mb: self
                .get_memory_info()
                .map(|m| m.used_js_heap_size as f64 / 1024.0 / 1024.0)
                .unwrap_or(0.0),
            wasm_memory_mb: self.get_wasm_memory_usage().unwrap_or(0.0),
            message_processing_time_ms: self
                .get_average_metric("message_processing_time", 10000)
                .unwrap_or(0.0),
            p2p_latency_ms: self.get_average_metric("p2p_latency", 30000).unwrap_or(0.0),
            active_connections: self.get_counter("active_connections") as u32,
            messages_per_second: self.calculate_messages_per_second(),
            frame_rate: self.estimate_frame_rate(),
            cpu_usage_percent: self.estimate_cpu_usage(),
        };

        self.add_sample(sample);
    }

    fn add_metric(&mut self, metric: PerformanceMetric) {
        self.metrics.push_back(metric);

        while self.metrics.len() > self.max_metrics {
            self.metrics.pop_front();
        }
    }

    fn add_sample(&mut self, sample: PerformanceSample) {
        self.samples.push_back(sample);

        while self.samples.len() > self.max_samples {
            self.samples.pop_front();
        }
    }

    pub fn get_average_metric(&self, name: &str, time_window_ms: u64) -> Option<f64> {
        let cutoff_time = (js_sys::Date::now() as u64).saturating_sub(time_window_ms);

        let values: Vec<f64> = self
            .metrics
            .iter()
            .filter(|m| m.name == name && m.timestamp >= cutoff_time)
            .map(|m| m.value)
            .collect();

        if values.is_empty() {
            None
        } else {
            Some(values.iter().sum::<f64>() / values.len() as f64)
        }
    }

    pub fn get_performance_summary(&self) -> PerformanceSummary {
        let recent_sample = self.samples.back().cloned();

        PerformanceSummary {
            current_memory_mb: recent_sample
                .as_ref()
                .map(|s| s.memory_usage_mb)
                .unwrap_or(0.0),
            current_wasm_memory_mb: recent_sample
                .as_ref()
                .map(|s| s.wasm_memory_mb)
                .unwrap_or(0.0),
            average_message_time_ms: self
                .get_average_metric("message_processing_time", 60000)
                .unwrap_or(0.0),
            average_p2p_latency_ms: self.get_average_metric("p2p_latency", 60000).unwrap_or(0.0),
            total_messages_processed: self.get_counter("messages_processed"),
            active_connections: recent_sample
                .as_ref()
                .map(|s| s.active_connections)
                .unwrap_or(0),
            current_frame_rate: recent_sample.as_ref().map(|s| s.frame_rate).unwrap_or(0.0),
            cpu_usage_percent: recent_sample
                .as_ref()
                .map(|s| s.cpu_usage_percent)
                .unwrap_or(0.0),
            uptime_seconds: self.calculate_uptime(),
        }
    }

    // Helper methods for system metrics collection
    fn get_memory_info(&self) -> Result<MemoryInfo, JsValue> {
        let window = web_sys::window().ok_or_else(|| JsValue::from_str("No window object"))?;
        let performance = window
            .performance()
            .ok_or_else(|| JsValue::from_str("No performance object"))?;

        // Try to get memory info (only available in some browsers)
        if let Ok(memory) = js_sys::Reflect::get(&performance, &"memory".into()) {
            if !memory.is_undefined() {
                let used_heap = js_sys::Reflect::get(&memory, &"usedJSHeapSize".into())
                    .unwrap_or(JsValue::from(0));
                let total_heap = js_sys::Reflect::get(&memory, &"totalJSHeapSize".into())
                    .unwrap_or(JsValue::from(0));
                let heap_limit = js_sys::Reflect::get(&memory, &"jsHeapSizeLimit".into())
                    .unwrap_or(JsValue::from(0));

                return Ok(MemoryInfo {
                    used_js_heap_size: used_heap.as_f64().unwrap_or(0.0) as u64,
                    total_js_heap_size: total_heap.as_f64().unwrap_or(0.0) as u64,
                    js_heap_size_limit: heap_limit.as_f64().unwrap_or(0.0) as u64,
                });
            }
        }

        // Return default values if memory info not available
        Ok(MemoryInfo {
            used_js_heap_size: 0,
            total_js_heap_size: 0,
            js_heap_size_limit: 0,
        })
    }

    fn get_wasm_memory_usage(&self) -> Result<f64, JsValue> {
        // Get WASM memory usage
        if let Ok(memory) = js_sys::Reflect::get(&wasm_bindgen::memory(), &"buffer".into()) {
            let buffer: js_sys::ArrayBuffer = memory.dyn_into()?;
            let size_bytes = buffer.byte_length();
            Ok(size_bytes as f64 / 1024.0 / 1024.0) // Convert to MB
        } else {
            Ok(0.0)
        }
    }

    fn get_high_precision_time(&self) -> f64 {
        if let Some(window) = web_sys::window() {
            if let Some(performance) = window.performance() {
                return performance.now();
            }
        }
        js_sys::Date::now()
    }

    fn calculate_messages_per_second(&self) -> f64 {
        // Calculate based on recent message processing metrics
        let recent_messages = self.get_counter("messages_processed");
        let time_window_seconds = 60.0; // Use last 60 seconds
        recent_messages as f64 / time_window_seconds
    }

    fn estimate_frame_rate(&self) -> f64 {
        // Estimate based on recent rendering metrics
        // In a real implementation, this would track requestAnimationFrame timing
        60.0 // Default to 60 FPS as placeholder
    }

    fn estimate_cpu_usage(&self) -> f64 {
        // Rough CPU usage estimation based on processing time
        let recent_processing_time = self
            .get_average_metric("total_processing_time", 1000)
            .unwrap_or(0.0);
        (recent_processing_time / 1000.0 * 100.0).min(100.0)
    }

    fn calculate_uptime(&self) -> u64 {
        // Calculate application uptime
        if let Some(first_sample) = self.samples.front() {
            ((js_sys::Date::now() as u64).saturating_sub(first_sample.timestamp)) / 1000
        } else {
            0
        }
    }
}

#[derive(Debug)]
struct MemoryInfo {
    used_js_heap_size: u64,
    total_js_heap_size: u64,
    js_heap_size_limit: u64,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct PerformanceSummary {
    pub current_memory_mb: f64,
    pub current_wasm_memory_mb: f64,
    pub average_message_time_ms: f64,
    pub average_p2p_latency_ms: f64,
    pub total_messages_processed: u64,
    pub active_connections: u32,
    pub current_frame_rate: f64,
    pub cpu_usage_percent: f64,
    pub uptime_seconds: u64,
}

// Global performance monitor
thread_local! {
    static PERFORMANCE_MONITOR: std::cell::RefCell<PerformanceMonitor> = std::cell::RefCell::new(PerformanceMonitor::new(1000, 300));
}

pub fn with_performance_monitor<F, R>(f: F) -> Result<R, JsValue>
where
    F: FnOnce(&mut PerformanceMonitor) -> R,
{
    PERFORMANCE_MONITOR.with(|monitor| {
        let mut monitor_ref = monitor.borrow_mut();
        Ok(f(&mut monitor_ref))
    })
}
