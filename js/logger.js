/**
 * Production-safe logging utility for Mindline
 * Automatically disables verbose logging in production environments
 */

class Logger {
  constructor() {
    this.isDevelopment = this.detectDevelopmentMode();
    this.isDebugEnabled = true;
    this.logSocket = null;
    this.logQueue = [];
    this.isConnectedToLogServer = false;
    this.wasmInitialized = false;
    this.isLoggingToWasm = false;

    // Initialize logger
    if (this.isDevelopment) {
      console.log('%c🔧 Development Mode - Logging Enabled', 'color: #3498db; font-weight: bold;');
      this.initializeLogSocket();
      this.initializeWasmLogger();
    }
  }

  detectDevelopmentMode() {
    // Check multiple indicators for development mode
    const hostname = window.location.hostname;
    const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname.includes('localhost');
    const hasDevFlag = window.location.search.includes('debug=true');
    const isDevServer = window.location.port === '8080' || window.location.port === '8088' || window.location.port === '3000';

    return isLocalhost || hasDevFlag || isDevServer;
  }

  initializeWasmLogger() {
    // Wait for WASM to be available
    const checkWasm = () => {
      if (window.safeWasm && window.safeWasm.initialize_logger) {
        try {
          window.safeWasm.initialize_logger(this.isDevelopment, this.isDebugEnabled);
          window.safeWasm.configure_logger(1000, true, true, false);
          this.wasmInitialized = true;
          console.log('%c✅ WASM Logger Initialized', 'color: #27ae60; font-weight: bold;');
        } catch (error) {
          console.warn('Failed to initialize WASM logger:', error);
        }
      } else {
        // Retry after 100ms if WASM not ready
        setTimeout(checkWasm, 100);
      }
    };
    checkWasm();
  }

  initializeLogSocket() {
    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const hostname = window.location.hostname;
      const logServerUrl = `${protocol}//${hostname}:3001/logs`;

      this.logSocket = new WebSocket(logServerUrl);

      this.logSocket.onopen = () => {
        this.isConnectedToLogServer = true;
        console.log('%c📝 Connected to logging server', 'color: #27ae60; font-weight: bold;');

        // Send any queued logs
        while (this.logQueue.length > 0) {
          const queuedLog = this.logQueue.shift();
          this.sendToLogServer(queuedLog.level, queuedLog.message);
        }
      };

      this.logSocket.onclose = () => {
        this.isConnectedToLogServer = false;
        console.log('%c📝 Disconnected from logging server', 'color: #e67e22; font-weight: bold;');

        // Try to reconnect after 5 seconds
        setTimeout(() => {
          if (!this.isConnectedToLogServer) {
            this.initializeLogSocket();
          }
        }, 5000);
      };

      this.logSocket.onerror = (error) => {
        console.log('%c📝 Logging server connection error:', 'color: #e74c3c;', error);
      };

    } catch (error) {
      console.log('%c📝 Failed to initialize logging server connection:', 'color: #e74c3c;', error);
    }
  }

  sendToLogServer(level, message) {
    if (!this.isDevelopment) return;

    const logData = {
      type: 'log',
      level: level,
      message: typeof message === 'string' ? message : JSON.stringify(message),
      timestamp: new Date().toISOString(),
      source: 'browser',
      url: window.location.href
    };

    if (this.isConnectedToLogServer && this.logSocket && this.logSocket.readyState === WebSocket.OPEN) {
      try {
        this.logSocket.send(JSON.stringify(logData));
      } catch (error) {
        console.error('Failed to send log to server:', error);
      }
    } else {
      // Queue the log if not connected
      this.logQueue.push({ level, message });

      // Limit queue size to prevent memory issues
      if (this.logQueue.length > 100) {
        this.logQueue = this.logQueue.slice(-50); // Keep last 50 logs
      }
    }
  }

  enableDebug() {
    this.isDebugEnabled = true;
    console.log('%c🐛 Debug Mode Enabled', 'color: #f39c12; font-weight: bold;');
    if (this.wasmInitialized && window.safeWasm && window.safeWasm.enable_debug_logging) {
      window.safeWasm.enable_debug_logging();
    }
  }

  disableDebug() {
    this.isDebugEnabled = false;
    console.log('%c🐛 Debug Mode Disabled', 'color: #95a5a6; font-weight: bold;');
    if (this.wasmInitialized && window.safeWasm && window.safeWasm.disable_debug_logging) {
      window.safeWasm.disable_debug_logging();
    }
  }

  // Standard logging methods
  log(...args) {
    if (this.isDevelopment) {
      console.log(...args);
      this.sendToLogServer('log', args.join(' '));
    }
  }

  info(...args) {
    if (this.isDevelopment) {
      console.info('%c[INFO]', 'color: #3498db;', ...args);
      this.sendToLogServer('info', `[INFO] ${args.join(' ')}`);
      // Also log to WASM (with recursion guard)
      if (this.wasmInitialized && window.safeWasm && window.safeWasm.log_info && !this.isLoggingToWasm) {
        this.isLoggingToWasm = true;
        try {
          window.safeWasm.log_info('js', args.join(' '));
        } catch (e) {
          // Silently fail to prevent recursion
        } finally {
          this.isLoggingToWasm = false;
        }
      }
    }
  }

  warn(...args) {
    // Always show warnings
    console.warn('%c[WARN]', 'color: #f39c12;', ...args);
    this.sendToLogServer('warn', `[WARN] ${args.join(' ')}`);
    // Also log to WASM (with recursion guard)
    if (this.wasmInitialized && window.safeWasm && window.safeWasm.log_warn && !this.isLoggingToWasm) {
      this.isLoggingToWasm = true;
      try {
        window.safeWasm.log_warn('js', args.join(' '));
      } catch (e) {
        // Silently fail to prevent recursion
      } finally {
        this.isLoggingToWasm = false;
      }
    }
  }

  error(...args) {
    // Always show errors
    console.error('%c[ERROR]', 'color: #e74c3c;', ...args);
    this.sendToLogServer('error', `[ERROR] ${args.join(' ')}`);
    // Also log to WASM (with recursion guard)
    if (this.wasmInitialized && window.safeWasm && window.safeWasm.log_error && !this.isLoggingToWasm) {
      this.isLoggingToWasm = true;
      try {
        window.safeWasm.log_error('js', args.join(' '));
      } catch (e) {
        // Silently fail to prevent recursion
      } finally {
        this.isLoggingToWasm = false;
      }
    }
  }

  debug(...args) {
    if (this.isDevelopment && this.isDebugEnabled) {
      console.log('%c[DEBUG]', 'color: #9b59b6;', ...args);
      this.sendToLogServer('debug', `[DEBUG] ${args.join(' ')}`);
      // Also log to WASM (with recursion guard)
      if (this.wasmInitialized && window.safeWasm && window.safeWasm.log_debug && !this.isLoggingToWasm) {
        this.isLoggingToWasm = true;
        try {
          window.safeWasm.log_debug('js', args.join(' '));
        } catch (e) {
          // Silently fail to prevent recursion
        } finally {
          this.isLoggingToWasm = false;
        }
      }
    }
  }

  // Specialized logging for different components
  webrtc(...args) {
    if (this.isDevelopment) {
      console.log('%c[WebRTC]', 'color: #27ae60;', ...args);
      this.sendToLogServer('info', `[WebRTC] ${args.join(' ')}`);
    }
  }

  wasm(...args) {
    if (this.isDevelopment) {
      console.log('%c[WASM]', 'color: #e67e22;', ...args);
      this.sendToLogServer('info', `[WASM] ${args.join(' ')}`);
    }
  }

  ui(...args) {
    if (this.isDevelopment) {
      console.log('%c[UI]', 'color: #8e44ad;', ...args);
      this.sendToLogServer('info', `[UI] ${args.join(' ')}`);
    }
  }

  p2p(...args) {
    if (this.isDevelopment) {
      console.log('%c[P2P]', 'color: #16a085;', ...args);
      this.sendToLogServer('info', `[P2P] ${args.join(' ')}`);
    }
  }

  // Performance logging
  time(label) {
    if (this.isDevelopment) {
      console.time(label);
      // Also start WASM timer
      if (this.wasmInitialized && window.safeWasm && window.safeWasm.start_performance_timer) {
        window.safeWasm.start_performance_timer(label);
      }
    }
  }

  timeEnd(label) {
    if (this.isDevelopment) {
      console.timeEnd(label);
      // Also end WASM timer
      if (this.wasmInitialized && window.safeWasm && window.safeWasm.end_performance_timer) {
        window.safeWasm.end_performance_timer(label);
      }
    }
  }

  // Group logging for complex operations
  group(label) {
    if (this.isDevelopment) {
      console.group(label);
      // Also start WASM log group
      if (this.wasmInitialized && window.safeWasm && window.safeWasm.start_log_group) {
        window.safeWasm.start_log_group(label);
      }
    }
  }

  groupEnd() {
    if (this.isDevelopment) {
      console.groupEnd();
      // Also end WASM log group
      if (this.wasmInitialized && window.safeWasm && window.safeWasm.end_log_group) {
        window.safeWasm.end_log_group();
      }
    }
  }

  // Table logging for structured data
  table(data) {
    if (this.isDevelopment) {
      console.table(data);
      // Also log to WASM
      if (this.wasmInitialized && window.safeWasm && window.safeWasm.log_table) {
        window.safeWasm.log_table(data);
      }
    }
  }

  // Export logs for debugging
  exportLogs() {
    if (this.wasmInitialized && window.safeWasm && window.safeWasm.export_logs_json) {
      return window.safeWasm.export_logs_json('');
    }
    return null;
  }

  // Get error summary
  getErrorSummary(minutes = 60) {
    if (this.wasmInitialized && window.safeWasm && window.safeWasm.get_error_summary) {
      return window.safeWasm.get_error_summary(minutes);
    }
    return null;
  }

  // Search logs
  searchLogs(query, limit = 100) {
    if (this.wasmInitialized && window.safeWasm && window.safeWasm.search_logs) {
      return window.safeWasm.search_logs(query, limit);
    }
    return [];
  }

  // Get log statistics
  getStats() {
    if (this.wasmInitialized && window.safeWasm && window.safeWasm.get_log_statistics) {
      return window.safeWasm.get_log_statistics();
    }
    return null;
  }
}

// Create singleton instance
const logger = new Logger();

// Make debug functions available globally for console access
window.enableDebugLogging = () => logger.enableDebug();
window.disableDebugLogging = () => logger.disableDebug();

// Export for use in modules
window.logger = logger;

export default logger;