// rust-logger.js - JavaScript wrapper for Rust logging system

class RustLoggerWrapper {
  constructor() {
    this.isDevelopment = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    this.isDebugEnabled = false;
    this.fallbackToConsole = true; // Fallback when WASM not available
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
    if (this.isDevelopment) {
      if (window.safeWasm && window.safeWasm.log_info) {
        window.safeWasm.log_info('core', args.join(' '));
      } else if (this.fallbackToConsole) {
        console.log('[CORE]', ...args);
      }
    }
  }

  info(...args) {
    if (window.safeWasm && window.safeWasm.log_info) {
      window.safeWasm.log_info('core', args.join(' '));
    } else if (this.fallbackToConsole) {
      console.info('[INFO]', ...args);
    }
  }

  warn(...args) {
    if (window.safeWasm && window.safeWasm.log_warn) {
      window.safeWasm.log_warn('core', args.join(' '));
    } else {
      console.warn('[WARN]', ...args);
    }
  }

  error(...args) {
    if (window.safeWasm && window.safeWasm.log_error) {
      window.safeWasm.log_error('core', args.join(' '));
    } else {
      console.error('[ERROR]', ...args);
    }
  }

  debug(...args) {
    if (this.isDevelopment && this.isDebugEnabled) {
      if (window.safeWasm && window.safeWasm.log_debug) {
        window.safeWasm.log_debug('core', args.join(' '));
      } else if (this.fallbackToConsole) {
        console.debug('[DEBUG]', ...args);
      }
    }
  }

  // Component-specific logging
  webrtc(...args) {
    if (this.isDevelopment) {
      if (window.safeWasm && window.safeWasm.log_info) {
        window.safeWasm.log_info('webrtc', args.join(' '));
      } else if (this.fallbackToConsole) {
        console.log('[WebRTC]', ...args);
      }
    }
  }

  wasm(...args) {
    if (this.isDevelopment) {
      if (window.safeWasm && window.safeWasm.log_info) {
        window.safeWasm.log_info('wasm', args.join(' '));
      } else if (this.fallbackToConsole) {
        console.log('[WASM]', ...args);
      }
    }
  }

  ui(...args) {
    if (this.isDevelopment) {
      if (window.safeWasm && window.safeWasm.log_info) {
        window.safeWasm.log_info('ui', args.join(' '));
      } else if (this.fallbackToConsole) {
        console.log('[UI]', ...args);
      }
    }
  }

  p2p(...args) {
    if (this.isDevelopment) {
      if (window.safeWasm && window.safeWasm.log_info) {
        window.safeWasm.log_info('p2p', args.join(' '));
      } else if (this.fallbackToConsole) {
        console.log('[P2P]', ...args);
      }
    }
  }

  // Performance logging
  time(label) {
    if (this.isDevelopment) {
      if (window.safeWasm && window.safeWasm.start_performance_timer) {
        window.safeWasm.start_performance_timer(label);
      } else {
        console.time(label);
      }
    }
  }

  timeEnd(label) {
    if (this.isDevelopment) {
      if (window.safeWasm && window.safeWasm.end_performance_timer) {
        return window.safeWasm.end_performance_timer(label);
      } else {
        console.timeEnd(label);
        return null;
      }
    }
    return null;
  }

  // Group logging
  group(label) {
    if (this.isDevelopment) {
      if (window.safeWasm && window.safeWasm.start_log_group) {
        window.safeWasm.start_log_group(label);
      } else {
        console.group(label);
      }
    }
  }

  groupEnd() {
    if (this.isDevelopment) {
      if (window.safeWasm && window.safeWasm.end_log_group) {
        window.safeWasm.end_log_group();
      } else {
        console.groupEnd();
      }
    }
  }

  // Table logging
  table(data) {
    if (this.isDevelopment) {
      if (window.safeWasm && window.safeWasm.log_table) {
        window.safeWasm.log_table(data);
      } else {
        console.table(data);
      }
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

  // Configuration
  configure(options = {}) {
    if (window.safeWasm && window.safeWasm.configure_logger) {
      const {
        maxEntries = 1000,
        consoleOutput = true,
        bufferLogs = true,
        autoExportErrors = false
      } = options;

      window.safeWasm.configure_logger(maxEntries, consoleOutput, bufferLogs, autoExportErrors);
    }
  }

  // Clear logs
  clear() {
    if (window.safeWasm && window.safeWasm.clear_log_buffer) {
      window.safeWasm.clear_log_buffer();
    }
    console.clear();
  }

  // Get error summary
  getErrorSummary(minutes = 60) {
    if (window.safeWasm && window.safeWasm.get_error_summary) {
      return window.safeWasm.get_error_summary(minutes);
    }
    return null;
  }

  // Get logs by component
  getLogsByComponent(component, limit = 50) {
    if (window.safeWasm && window.safeWasm.get_logs_by_component) {
      return window.safeWasm.get_logs_by_component(component, limit);
    }
    return [];
  }

  // Export recent logs
  exportRecentLogs(count = 100) {
    if (window.safeWasm && window.safeWasm.export_recent_logs_json) {
      return window.safeWasm.export_recent_logs_json(count);
    }
    return '[]';
  }
}

// Create singleton instance
const logger = new RustLoggerWrapper();

// Make debug functions available globally for convenience
window.enableDebugLogging = () => logger.enableDebug();
window.disableDebugLogging = () => logger.disableDebug();
window.clearLogs = () => logger.clear();

// Advanced debugging functions
window.searchLogs = (query, limit) => logger.searchLogs(query, limit);
window.getLogStats = () => logger.getLogStats();
window.exportLogs = (filter) => logger.exportLogs(filter);
window.createDebugReport = () => logger.createDebugReport();
window.getErrorSummary = (minutes) => logger.getErrorSummary(minutes);
window.exportRecentLogs = (count) => logger.exportRecentLogs(count);

// Configure logger globally
window.configureLogger = (options) => logger.configure(options);

// Export both the logger instance and class
export default logger;
export { RustLoggerWrapper };