/**
 * P2P Configuration
 * Environment-aware config with TURN servers and mobile optimizations
 */

import { browser, dev } from '$app/environment';
import type { P2PConfig } from './types';

/**
 * TURN comes only from explicit configuration (runtime MINDLINE_ENV or
 * VITE_TURN_* build vars). The previous hardcoded free openrelay tier is
 * discontinued/throttled and gave a false sense of NAT coverage; deploys
 * should provision real TURN (see docs/analysis/DECISIONS.md D4).
 */
function turnServersFromEnv(): RTCIceServer[] {
	const urls = import.meta.env.VITE_TURN_URLS as string | undefined;
	if (!urls) return [];
	return [
		{
			urls: urls.split(',').map((u) => u.trim()),
			username: import.meta.env.VITE_TURN_USERNAME as string | undefined,
			credential: import.meta.env.VITE_TURN_CREDENTIAL as string | undefined
		}
	];
}

type RuntimeEnvConfig = {
	SIGNALING_SERVER?: string;
	USE_SSL?: boolean | string;
	TURN_SERVERS?: RTCIceServer[];
};

function getRuntimeEnvConfig(): RuntimeEnvConfig {
	if (!browser) return {};

	const runtimeEnv = (window as Window & { MINDLINE_ENV?: unknown }).MINDLINE_ENV;
	if (!runtimeEnv || typeof runtimeEnv !== 'object') {
		return {};
	}

	return runtimeEnv as RuntimeEnvConfig;
}

function parseUseSsl(value: RuntimeEnvConfig['USE_SSL'], fallback: boolean): boolean {
	if (typeof value === 'boolean') {
		return value;
	}

	if (typeof value === 'string') {
		const normalized = value.trim().toLowerCase();
		if (normalized === 'true') return true;
		if (normalized === 'false') return false;
	}

	return fallback;
}

function getConfiguredTurnServers(runtimeEnv: RuntimeEnvConfig): RTCIceServer[] {
	if (Array.isArray(runtimeEnv.TURN_SERVERS)) {
		return runtimeEnv.TURN_SERVERS;
	}
	return turnServersFromEnv();
}

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

	// Unknown network type (API unsupported); don't assume cellular based on device UA.
	return false;
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

	// Development mode - use localhost. VITE_SIGNALING_PORT lets the e2e
	// harness run signaling on a free port when 3000 is taken.
	if (dev) {
		const devPort = (import.meta.env.VITE_SIGNALING_PORT as string | undefined) || '3000';
		return { server: `localhost:${devPort}`, useSSL: false };
	}

	const runtimeEnv = getRuntimeEnvConfig();
	if (runtimeEnv.SIGNALING_SERVER) {
		return {
			server: runtimeEnv.SIGNALING_SERVER,
			useSSL: parseUseSsl(runtimeEnv.USE_SSL, window.location.protocol === 'https:')
		};
	}

	// Production: Use environment variable or derive from current hostname
	const envServer = import.meta.env.VITE_SIGNALING_SERVER;
	if (envServer) {
		return { server: envServer, useSSL: true };
	}

	// Fallback: Use current hostname with signal subdomain or same-origin
	// This assumes signaling server is deployed alongside the app
	const host = window.location.host;
	// Production build previewed locally (e.g. `pnpm preview`): the dev flag
	// is off but signal.localhost doesn't exist; use the local server.
	if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
		return { server: 'localhost:3000', useSSL: false };
	}
	// If on Cloudflare Pages, signaling might be on a different subdomain
	if (host.includes('pages.dev')) {
		// Production signaling (the old signal-mindline.fly.dev host is gone)
		return { server: 'signal.mindline.chat', useSSL: true };
	}

	// For custom domains, assume signaling on same host different port or subdomain
	return { server: `signal.${host}`, useSSL: window.location.protocol === 'https:' };
}

/**
 * Get optimized P2P configuration based on environment and network conditions
 */
export function getP2PConfig(): P2PConfig {
	const runtimeEnv = getRuntimeEnvConfig();
	const { server, useSSL } = getSignalingConfig();
	const mobile = isMobileDevice();
	const strictDirect = isStrictDirectMode();
	const turnServers = getConfiguredTurnServers(runtimeEnv);

	return {
		signalingServer: server,
		useSSL,
		websocketPath: '/ws',
		turnServers: strictDirect ? [] : turnServers,
		allowRelayFallback: !strictDirect,
		strictDirect,
		// Mobile-optimized settings
		connectionTimeout: mobile ? 5000 : 2000,
		icePoolSize: mobile ? 20 : 10,
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
		turnServers: [],
		allowRelayFallback: true,
		strictDirect: false,
		connectionTimeout: 2000,
		icePoolSize: 10,
		maxReconnectAttempts: 5,
		reconnectBackoffBase: 1000
	};
}

/**
 * Get test config with faster timeouts for E2E tests
 * Use this when ?fastConnect=true is in the URL
 */
export function getTestConfig(): Partial<P2PConfig> {
	return {
		fastConnect: true,
		offerTimeout: 5000,
		meshCheckInterval: 3000
	};
}

/**
 * Check if test mode is enabled via URL parameter
 */
export function isTestMode(): boolean {
	if (!browser) return false;
	const params = new URLSearchParams(window.location.search);
	return params.get('fastConnect') === 'true';
}

/**
 * Strict direct mode:
 * - disables TURN
 * - disables WebSocket relay fallback
 * Enable with ?strictDirect=true or VITE_P2P_STRICT_DIRECT=true
 */
export function isStrictDirectMode(): boolean {
	if (!browser) return false;

	const params = new URLSearchParams(window.location.search);
	const param = params.get('strictDirect');
	if (param !== null) {
		return param === '1' || param.toLowerCase() === 'true';
	}

	return import.meta.env.VITE_P2P_STRICT_DIRECT === 'true';
}
