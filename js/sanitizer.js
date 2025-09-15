/**
 * Input sanitization and validation utilities for Mindline
 * Prevents XSS, injection attacks, and validates user inputs
 */

class InputSanitizer {
  constructor() {
    // Create a DOM parser for safe HTML processing
    this.parser = new DOMParser();
  }

  /**
   * Sanitize HTML content to prevent XSS attacks
   * @param {string} input - Raw HTML input
   * @returns {string} - Sanitized HTML
   */
  sanitizeHTML(input) {
    if (typeof input !== 'string') {
      return '';
    }

    // Remove script tags and event handlers
    let sanitized = input
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/on\w+\s*=\s*"[^"]*"/gi, '')
      .replace(/on\w+\s*=\s*'[^']*'/gi, '')
      .replace(/javascript:/gi, '')
      .replace(/vbscript:/gi, '')
      .replace(/data:/gi, '');

    // Use DOMParser to further sanitize
    const doc = this.parser.parseFromString(sanitized, 'text/html');

    // Remove potentially dangerous elements
    const dangerousElements = doc.querySelectorAll('script, object, embed, iframe, frame, frameset, meta, link, style');
    dangerousElements.forEach(el => el.remove());

    return doc.body.innerHTML || '';
  }

  /**
   * Sanitize plain text content
   * @param {string} input - Raw text input
   * @returns {string} - Sanitized text
   */
  sanitizeText(input) {
    if (typeof input !== 'string') {
      return '';
    }

    // Escape HTML entities
    const div = document.createElement('div');
    div.textContent = input;
    return div.innerHTML;
  }

  /**
   * Validate and sanitize room ID
   * @param {string} roomId - Raw room ID
   * @returns {string|null} - Valid room ID or null if invalid
   */
  validateRoomId(roomId) {
    if (typeof roomId !== 'string') {
      return null;
    }

    // Remove any non-alphanumeric characters except dashes and underscores
    const sanitized = roomId.replace(/[^a-zA-Z0-9\-_]/g, '');

    // Check minimum length (8 characters)
    if (sanitized.length < 8) {
      return null;
    }

    // Check maximum length (64 characters)
    if (sanitized.length > 64) {
      return sanitized.substring(0, 64);
    }

    return sanitized;
  }

  /**
   * Validate and sanitize username
   * @param {string} username - Raw username
   * @returns {string|null} - Valid username or null if invalid
   */
  validateUsername(username) {
    if (typeof username !== 'string') {
      return null;
    }

    // Trim whitespace
    let sanitized = username.trim();

    // Remove potentially dangerous characters
    sanitized = sanitized.replace(/[<>'"&]/g, '');

    // Check minimum length (1 character)
    if (sanitized.length < 1) {
      return null;
    }

    // Check maximum length (32 characters)
    if (sanitized.length > 32) {
      sanitized = sanitized.substring(0, 32);
    }

    return sanitized;
  }

  /**
   * Validate and sanitize chat message
   * @param {string} message - Raw chat message
   * @returns {string|null} - Valid message or null if invalid
   */
  validateMessage(message) {
    if (typeof message !== 'string') {
      return null;
    }

    // Trim whitespace
    let sanitized = message.trim();

    // Check minimum length (1 character)
    if (sanitized.length < 1) {
      return null;
    }

    // Check maximum length (2000 characters)
    if (sanitized.length > 2000) {
      sanitized = sanitized.substring(0, 2000);
    }

    // Sanitize HTML content
    return this.sanitizeHTML(sanitized);
  }

  /**
   * Validate URL parameters
   * @param {string} param - URL parameter value
   * @returns {string|null} - Valid parameter or null if invalid
   */
  validateURLParam(param) {
    if (typeof param !== 'string') {
      return null;
    }

    // Remove potentially dangerous characters
    const sanitized = param.replace(/[<>'"&]/g, '');

    // Check length
    if (sanitized.length === 0 || sanitized.length > 128) {
      return null;
    }

    return sanitized;
  }

  /**
   * Generate a cryptographically secure room ID
   * @returns {string} - Secure room ID
   */
  generateSecureRoomId() {
    // Generate random bytes
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);

    // Convert to hex string
    const hex = Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');

    // Add prefix for readability
    return `room-${hex}`;
  }

  /**
   * Rate limiting helper
   * @param {string} key - Unique key for the action
   * @param {number} maxAttempts - Maximum attempts allowed
   * @param {number} windowMs - Time window in milliseconds
   * @returns {boolean} - True if action is allowed
   */
  checkRateLimit(key, maxAttempts = 10, windowMs = 60000) {
    const now = Date.now();
    const storageKey = `rate_limit_${key}`;

    try {
      const stored = localStorage.getItem(storageKey);
      const data = stored ? JSON.parse(stored) : { attempts: [], windowStart: now };

      // Clean old attempts outside the window
      data.attempts = data.attempts.filter(timestamp => now - timestamp < windowMs);

      // Check if limit exceeded
      if (data.attempts.length >= maxAttempts) {
        return false;
      }

      // Add current attempt
      data.attempts.push(now);
      localStorage.setItem(storageKey, JSON.stringify(data));

      return true;
    } catch (error) {
      // If localStorage fails, allow the action but log error
      console.error('Rate limiting failed:', error);
      return true;
    }
  }

  /**
   * Validate file upload (for future file sharing feature)
   * @param {File} file - File object
   * @returns {boolean} - True if file is valid
   */
  validateFile(file) {
    if (!file || !(file instanceof File)) {
      return false;
    }

    // Check file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      return false;
    }

    // Allowed file types
    const allowedTypes = [
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      'text/plain', 'application/pdf',
      'audio/mpeg', 'audio/wav', 'audio/ogg',
      'video/mp4', 'video/webm', 'video/ogg'
    ];

    return allowedTypes.includes(file.type);
  }
}

// Create singleton instance
const sanitizer = new InputSanitizer();

// Export for use in modules
window.sanitizer = sanitizer;

export default sanitizer;