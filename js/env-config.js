// This file can be used to inject environment-specific configuration
// For Cloudflare Pages deployment, you can set these values in the
// Cloudflare Pages dashboard under Settings > Environment variables
// Then use a build command that injects them here

// Example usage:
// In Cloudflare Pages, set environment variables:
// - SIGNALING_SERVER = your-signal-server.com
// - USE_SSL = true
//
// Then modify this file during build or use Cloudflare Pages Functions
// to dynamically inject the configuration

// Only set environment values if they're not placeholders
const signalingServer = '__SIGNALING_SERVER__';
const useSSL = '__USE_SSL__';

window.MINDLINE_ENV = {};

// Only set values if they're not placeholder strings
if (signalingServer && !signalingServer.includes('__')) {
  window.MINDLINE_ENV.SIGNALING_SERVER = signalingServer;
}

if (useSSL && !useSSL.includes('__')) {
  window.MINDLINE_ENV.USE_SSL = useSSL === 'true';
}