#!/usr/bin/env node

// This script injects environment variables into the env-config.js file
// It's meant to be run during the Cloudflare Pages build process

const fs = require('fs');
const path = require('path');

// Get environment variables
const SIGNALING_SERVER = process.env.SIGNALING_SERVER || 'signal.yourdomain.com';
const USE_SSL = process.env.USE_SSL || 'true';
const TURN_SERVERS = process.env.TURN_SERVERS || '';

// Path to the env-config.js file
const envConfigPath = path.join(__dirname, '..', 'dist', 'js', 'env-config.js');

// Ensure the directory exists
const dir = path.dirname(envConfigPath);
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

// Build TURN servers configuration
let turnServersConfig = '';
if (TURN_SERVERS) {
  try {
    // Validate JSON format
    JSON.parse(TURN_SERVERS);
    turnServersConfig = `,
  TURN_SERVERS: ${TURN_SERVERS}`;
  } catch (e) {
    console.warn('Warning: Invalid TURN_SERVERS JSON format, skipping');
  }
}

// Create the env-config.js content with actual values
const content = `// Auto-generated configuration for Cloudflare Pages
// Generated at: ${new Date().toISOString()}

window.MINDLINE_ENV = {
  SIGNALING_SERVER: '${SIGNALING_SERVER}',
  USE_SSL: ${USE_SSL}${turnServersConfig}
};

console.log('Loaded MINDLINE_ENV configuration:', window.MINDLINE_ENV);
`;

// Write the file
fs.writeFileSync(envConfigPath, content);

console.log('Environment configuration injected:');
console.log(`  SIGNALING_SERVER: ${SIGNALING_SERVER}`);
console.log(`  USE_SSL: ${USE_SSL}`);
console.log(`  TURN_SERVERS: ${TURN_SERVERS ? 'configured' : 'not configured'}`);
console.log(`  Written to: ${envConfigPath}`);