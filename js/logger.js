/**
 * Production-safe logging utility for Mindline
 * Automatically disables verbose logging in production environments
 */

class Logger {
  constructor() {
    this.isDevelopment = this.detectDevelopmentMode();
    this.isDebugEnabled = false;

    // Initialize logger
    if (this.isDevelopment) {
      console.log('%c🔧 Development Mode - Logging Enabled', 'color: #3498db; font-weight: bold;');
    }
  }

  detectDevelopmentMode() {
    // Check multiple indicators for development mode
    const hostname = window.location.hostname;
    const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname.includes('localhost');
    const hasDevFlag = window.location.search.includes('debug=true');
    const isDevServer = window.location.port === '8080' || window.location.port === '3000';

    return isLocalhost || hasDevFlag || isDevServer;
  }

  enableDebug() {
    this.isDebugEnabled = true;
    console.log('%c🐛 Debug Mode Enabled', 'color: #f39c12; font-weight: bold;');
  }

  disableDebug() {
    this.isDebugEnabled = false;
    console.log('%c🐛 Debug Mode Disabled', 'color: #95a5a6; font-weight: bold;');
  }

  // Standard logging methods
  log(...args) {
    if (this.isDevelopment) {
      console.log(...args);
    }
  }

  info(...args) {
    if (this.isDevelopment) {
      console.info('%c[INFO]', 'color: #3498db;', ...args);
    }
  }

  warn(...args) {
    // Always show warnings
    console.warn('%c[WARN]', 'color: #f39c12;', ...args);
  }

  error(...args) {
    // Always show errors
    console.error('%c[ERROR]', 'color: #e74c3c;', ...args);
  }

  debug(...args) {
    if (this.isDevelopment && this.isDebugEnabled) {
      console.log('%c[DEBUG]', 'color: #9b59b6;', ...args);
    }
  }

  // Specialized logging for different components
  webrtc(...args) {
    if (this.isDevelopment) {
      console.log('%c[WebRTC]', 'color: #27ae60;', ...args);
    }
  }

  wasm(...args) {
    if (this.isDevelopment) {
      console.log('%c[WASM]', 'color: #e67e22;', ...args);
    }
  }

  ui(...args) {
    if (this.isDevelopment) {
      console.log('%c[UI]', 'color: #8e44ad;', ...args);
    }
  }

  p2p(...args) {
    if (this.isDevelopment) {
      console.log('%c[P2P]', 'color: #16a085;', ...args);
    }
  }

  // Performance logging
  time(label) {
    if (this.isDevelopment) {
      console.time(label);
    }
  }

  timeEnd(label) {
    if (this.isDevelopment) {
      console.timeEnd(label);
    }
  }

  // Group logging for complex operations
  group(label) {
    if (this.isDevelopment) {
      console.group(label);
    }
  }

  groupEnd() {
    if (this.isDevelopment) {
      console.groupEnd();
    }
  }

  // Table logging for structured data
  table(data) {
    if (this.isDevelopment) {
      console.table(data);
    }
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