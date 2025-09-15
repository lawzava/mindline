// Environment configuration for Mindline
const CONFIG = {
  // Production signaling server from environment variable or fallback
  SIGNALING_SERVER: typeof process !== 'undefined' && process.env && process.env.SIGNALING_SERVER
    ? process.env.SIGNALING_SERVER
    : 'signal.yourdomain.com',

  // SSL configuration from environment or default to true for production
  USE_SSL: typeof process !== 'undefined' && process.env && process.env.USE_SSL
    ? process.env.USE_SSL === 'true'
    : true,

  // WebSocket path
  WEBSOCKET_PATH: '/ws',

  // Development fallback
  DEV_SIGNALING_SERVER: 'localhost:3000',
  DEV_USE_SSL: false
};

// Detect environment
const isProduction = window.location.hostname !== 'localhost' &&
                     window.location.hostname !== '127.0.0.1' &&
                     !window.location.hostname.includes('localhost');

// Export configuration based on environment
window.MINDLINE_CONFIG = {
  SIGNALING_SERVER: isProduction ? CONFIG.SIGNALING_SERVER : CONFIG.DEV_SIGNALING_SERVER,
  USE_SSL: isProduction ? CONFIG.USE_SSL : CONFIG.DEV_USE_SSL,
  WEBSOCKET_PATH: CONFIG.WEBSOCKET_PATH,
  IS_PRODUCTION: isProduction
};

console.log('Mindline Config:', window.MINDLINE_CONFIG);