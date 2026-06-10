#!/usr/bin/env node

// This script injects environment variables into the env-config.js file
// It's meant to be run during the Cloudflare Pages build process

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get environment variables
const SIGNALING_SERVER = process.env.SIGNALING_SERVER || 'signal.yourdomain.com';
const USE_SSL = process.env.USE_SSL || 'true';
const TURN_SERVERS = process.env.TURN_SERVERS || '';

// Path to the env-config.js file
// The Cloudflare adapter publishes .svelte-kit/cloudflare (audit fix:
// this previously wrote to dist/, which was never deployed).
const envConfigPath = path.join(__dirname, '..', '.svelte-kit', 'cloudflare', 'js', 'env-config.js');

// Ensure the directory exists
const dir = path.dirname(envConfigPath);
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

const runtimeConfig = {
  SIGNALING_SERVER,
  USE_SSL: USE_SSL === 'true'
};

if (TURN_SERVERS) {
  try {
    const parsedTurnServers = JSON.parse(TURN_SERVERS);
    if (Array.isArray(parsedTurnServers)) {
      runtimeConfig.TURN_SERVERS = parsedTurnServers;
    } else {
      console.warn('Warning: TURN_SERVERS must be a JSON array of RTCIceServer entries, skipping');
    }
  } catch (e) {
    console.warn('Warning: Invalid TURN_SERVERS JSON format, skipping');
  }
}

// Create the env-config.js content with actual values
const content = `// Auto-generated configuration for Cloudflare Pages
// Generated at: ${new Date().toISOString()}

window.MINDLINE_ENV = ${JSON.stringify(runtimeConfig, null, 2)};

console.log('Loaded MINDLINE_ENV configuration:', window.MINDLINE_ENV);
`;

// Write the file
fs.writeFileSync(envConfigPath, content);

console.log('Environment configuration injected:');
console.log(`  SIGNALING_SERVER: ${SIGNALING_SERVER}`);
console.log(`  USE_SSL: ${USE_SSL}`);
console.log(`  TURN_SERVERS: ${TURN_SERVERS ? 'configured' : 'not configured'}`);
console.log(`  Written to: ${envConfigPath}`);
