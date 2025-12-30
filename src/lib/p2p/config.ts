/**
 * P2P Configuration
 * Environment-aware config with TURN servers and mobile optimizations
 */

import { browser, dev } from '$app/environment';
import type { P2PConfig } from './types';

// Free public TURN servers (Open Relay Project - metered.ca free tier)
// Multiple URLs per server for better mobile/Safari compatibility
const PUBLIC_TURN_SERVERS: RTCIceServer[] = [
	{
		urls: [
			'turn:openrelay.metered.ca:80',
			'turn:openrelay.metered.ca:443',
			'turn:openrelay.metered.ca:443?transport=tcp',
			'turns:openrelay.metered.ca:443' // TURN over TLS - preferred by Safari iOS
		],
		username: 'openrelayproject',
		credential: 'openrelayproject'
	}
];

/**
 * Detect if user is on a mobile network
 * Uses Network Information API and user agent detection
 */
export function isMobileNetwork(): boolean {
	if (!browser) return false;

	// Check Network Information API
	const conn = (navigator as unknown as { connection?: { type?: string; effectiveType?: string } })
		.connection;
	if (conn) {
		// Cellular connection type
		if (conn.type === 'cellular') return true;
		// Slow effective connection types
		if (['slow-2g', '2g', '3g'].includes(conn.effectiveType || '')) return true;
	}

	// Check user agent for mobile devices
	return /Android|iPhone|iPad|iPod|Mobile|webOS|BlackBerry|IEMobile|Opera Mini/i.test(
		navigator.userAgent
	);
}

/**
 * Detect if user is on a mobile device (regardless of network)
 */
export function isMobileDevice(): boolean {
	if (!browser) return false;
	return /Android|iPhone|iPad|iPod|Mobile|webOS|BlackBerry|IEMobile|Opera Mini/i.test(
		navigator.userAgent
	);
}

/**
 * Get environment-aware signaling server configuration
 */
export function getSignalingConfig(): { server: string; useSSL: boolean } {
	if (!browser) {
		return { server: 'localhost:3000', useSSL: false };
	}

	// Development mode - use localhost
	if (dev) {
		return { server: 'localhost:3000', useSSL: false };
	}

	// Production: Use environment variable or derive from current hostname
	const envServer = import.meta.env.VITE_SIGNALING_SERVER;
	if (envServer) {
		return { server: envServer, useSSL: true };
	}

	// Fallback: Use current hostname with signal subdomain or same-origin
	// This assumes signaling server is deployed alongside the app
	const host = window.location.host;
	// If on Cloudflare Pages, signaling might be on a different subdomain
	if (host.includes('pages.dev')) {
		// Default signaling server for production
		return { server: 'signal-mindline.fly.dev', useSSL: true };
	}

	// For custom domains, assume signaling on same host different port or subdomain
	return { server: `signal.${host}`, useSSL: window.location.protocol === 'https:' };
}

/**
 * Get optimized P2P configuration based on environment and network conditions
 */
export function getP2PConfig(): P2PConfig {
	const { server, useSSL } = getSignalingConfig();
	const mobile = isMobileDevice();

	return {
		signalingServer: server,
		useSSL,
		websocketPath: '/ws',
		turnServers: PUBLIC_TURN_SERVERS,
		// Mobile-optimized settings
		connectionTimeout: mobile ? 5000 : 2000,
		icePoolSize: mobile ? 20 : 10,
		forceRelay: mobile, // Force TURN relay on mobile for reliable connections through NAT
		maxReconnectAttempts: mobile ? 10 : 7,
		reconnectBackoffBase: 1000
	};
}

/**
 * Get development config (always uses localhost)
 */
export function getDevConfig(): P2PConfig {
	return {
		signalingServer: 'localhost:3000',
		useSSL: false,
		websocketPath: '/ws',
		turnServers: PUBLIC_TURN_SERVERS,
		connectionTimeout: 2000,
		icePoolSize: 10,
		forceRelay: false,
		maxReconnectAttempts: 5,
		reconnectBackoffBase: 1000
	};
}
