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

window.MINDLINE_ENV = {
  // These will be replaced by actual values during deployment
  SIGNALING_SERVER: '__SIGNALING_SERVER__',
  USE_SSL: '__USE_SSL__'
};