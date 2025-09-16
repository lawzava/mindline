/**
 * Debug Utilities
 * Handles debug panel, logging, and development tools
 */

import logger from './logger.js';

// Debug state
let debugVisible = false;
let debugModeEnabled = false;

/**
 * Log debug message to console and visual debug panel
 * @param {string} message - Debug message
 */
export function debugLog(message) {
  logger.debug(message);

  // Also add to visual debug panel
  const debugContent = document.getElementById('debugContent');
  if (debugContent) {
    const timestamp = new Date().toLocaleTimeString();
    debugContent.textContent += `[${timestamp}] ${message}\n`;
    debugContent.scrollTop = debugContent.scrollHeight;

    // Only auto-show debug panel if debug mode is enabled
    if (debugModeEnabled && !debugVisible) {
      showDebugPanel();
    }
  }
}

/**
 * Show debug panel
 */
export function showDebugPanel() {
  const debugPanel = document.getElementById('debugPanel');
  if (debugPanel) {
    debugPanel.style.display = 'block';
    debugVisible = true;
    const toggleBtn = document.getElementById('debugToggleBtn');
    if (toggleBtn) {
      toggleBtn.textContent = '🐛 Hide';
    }
  }
}

/**
 * Hide debug panel
 */
export function hideDebugPanel() {
  const debugPanel = document.getElementById('debugPanel');
  if (debugPanel) {
    debugPanel.style.display = 'none';
    debugVisible = false;
    const toggleBtn = document.getElementById('debugToggleBtn');
    if (toggleBtn) {
      toggleBtn.textContent = '🐛 Debug';
    }
  }
}

/**
 * Clear debug panel content
 */
export function clearDebugPanel() {
  const debugContent = document.getElementById('debugContent');
  if (debugContent) {
    debugContent.textContent = '';
    debugLog('Debug panel cleared');
  }
}

/**
 * Enable debug mode
 */
export function enableDebugMode() {
  debugModeEnabled = true;
  localStorage.setItem('debugEnabled', 'true');

  // Enable WASM debug logging if available
  if (window.safeWasm && window.safeWasm.enable_debug_logging) {
    window.safeWasm.enable_debug_logging();
  }

  debugLog('Debug mode enabled');
  logger.info('Debug mode enabled');
}

/**
 * Disable debug mode
 */
export function disableDebugMode() {
  debugModeEnabled = false;
  localStorage.setItem('debugEnabled', 'false');

  // Disable WASM debug logging if available
  if (window.safeWasm && window.safeWasm.disable_debug_logging) {
    window.safeWasm.disable_debug_logging();
  }

  hideDebugPanel();
  debugLog('Debug mode disabled');
  logger.info('Debug mode disabled');
}

/**
 * Toggle debug panel visibility
 */
export function toggleDebugPanel() {
  if (debugVisible) {
    hideDebugPanel();
  } else {
    showDebugPanel();
  }
}

/**
 * Toggle debug mode
 */
export function toggleDebugMode() {
  if (debugModeEnabled) {
    disableDebugMode();
  } else {
    enableDebugMode();
  }
}

/**
 * Check if debug mode is enabled
 * @returns {boolean} Whether debug mode is enabled
 */
export function isDebugModeEnabled() {
  return debugModeEnabled;
}

/**
 * Check if debug panel is visible
 * @returns {boolean} Whether debug panel is visible
 */
export function isDebugPanelVisible() {
  return debugVisible;
}

/**
 * Initialize debug mode from localStorage
 */
export function initializeDebugMode() {
  const debugEnabled = localStorage.getItem('debugEnabled') === 'true';
  if (debugEnabled) {
    enableDebugMode();
  }
}

/**
 * Show temporary message in debug panel
 * @param {string} message - Message to show
 * @param {number} duration - Duration in milliseconds (default 3000)
 */
export function showTemporaryMessage(message, duration = 3000) {
  debugLog(`[TEMP] ${message}`);

  // Optionally show a toast-like notification
  if (window.toastManager) {
    window.toastManager.show(message, 'info', duration);
  }
}

/**
 * Log connection status for debugging
 * @param {string} status - Connection status
 * @param {Object} details - Additional details
 */
export function logConnectionStatus(status, details = {}) {
  const message = `Connection: ${status}${details ? ` - ${JSON.stringify(details)}` : ''}`;
  debugLog(message);
}

/**
 * Log peer activity for debugging
 * @param {string} peerId - Peer ID
 * @param {string} action - Action performed
 * @param {Object} data - Additional data
 */
export function logPeerActivity(peerId, action, data = {}) {
  const message = `Peer ${peerId}: ${action}${data ? ` - ${JSON.stringify(data)}` : ''}`;
  debugLog(message);
}

// Global functions for HTML onclick handlers
window.showDebugPanel = showDebugPanel;
window.hideDebugPanel = hideDebugPanel;
window.clearDebugPanel = clearDebugPanel;
window.toggleDebugPanel = toggleDebugPanel;
window.enableDebugMode = enableDebugMode;
window.disableDebugMode = disableDebugMode;