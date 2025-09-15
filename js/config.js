// Environment configuration for Mindline

// Function to get configuration from various sources
function getSignalingServer() {
  // First, check for URL parameters (useful for testing)
  const urlParams = new URLSearchParams(window.location.search);
  const urlSignalingServer = urlParams.get('signaling_server');
  if (urlSignalingServer) {
    console.log('Using signaling server from URL parameter:', urlSignalingServer);
    return urlSignalingServer;
  }

  // Second, check for webpack-injected environment variable
  if (typeof process !== 'undefined' && process.env && process.env.SIGNALING_SERVER && process.env.SIGNALING_SERVER !== 'localhost:3000') {
    console.log('Using signaling server from build env:', process.env.SIGNALING_SERVER);
    return process.env.SIGNALING_SERVER;
  }

  // Third, check for a global configuration object (can be injected by deployment)
  if (window.MINDLINE_ENV && window.MINDLINE_ENV.SIGNALING_SERVER) {
    console.log('Using signaling server from window.MINDLINE_ENV:', window.MINDLINE_ENV.SIGNALING_SERVER);
    return window.MINDLINE_ENV.SIGNALING_SERVER;
  }

  // Finally, use default based on hostname
  const hostname = window.location.hostname;
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    console.log('Using default localhost signaling server');
    return 'localhost:3000';
  }

  // For production, derive from current domain or use a default
  // If deployed to mindline.example.com, use signal.example.com
  const domain = hostname.split('.').slice(-2).join('.');
  const defaultServer = domain !== hostname ? `signal.${domain}` : 'signal.yourdomain.com';
  console.log('Using derived signaling server:', defaultServer);
  return defaultServer;
}

function getUseSSL() {
  // Check URL parameter
  const urlParams = new URLSearchParams(window.location.search);
  const urlUseSSL = urlParams.get('use_ssl');
  if (urlUseSSL !== null) {
    return urlUseSSL === 'true';
  }

  // Check webpack-injected environment variable
  if (typeof process !== 'undefined' && process.env && process.env.USE_SSL) {
    return process.env.USE_SSL === 'true';
  }

  // Check global configuration
  if (window.MINDLINE_ENV && window.MINDLINE_ENV.USE_SSL !== undefined) {
    return window.MINDLINE_ENV.USE_SSL === true || window.MINDLINE_ENV.USE_SSL === 'true';
  }

  // Default based on protocol
  return window.location.protocol === 'https:';
}

// Detect environment
const isProduction = window.location.hostname !== 'localhost' &&
                     window.location.hostname !== '127.0.0.1' &&
                     !window.location.hostname.includes('localhost');

// Export configuration
window.MINDLINE_CONFIG = {
  SIGNALING_SERVER: getSignalingServer(),
  USE_SSL: getUseSSL(),
  WEBSOCKET_PATH: '/ws',
  IS_PRODUCTION: isProduction
};

console.log('Mindline Config:', window.MINDLINE_CONFIG);