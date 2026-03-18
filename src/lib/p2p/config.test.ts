import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getSignalingConfig } from './config';
import * as environment from '$app/environment';

// Hoisted variables for mock values
const mocks = vi.hoisted(() => ({
	browser: true,
	dev: false
}));

// Mock $app/environment with getters
vi.mock('$app/environment', () => ({
	get browser() { return mocks.browser; },
	get dev() { return mocks.dev; }
}));

describe('getSignalingConfig', () => {
	const originalLocation = window.location;
	let originalEnv: any;

	beforeEach(() => {
		// Reset mocks
		vi.resetAllMocks();

		// Reset hoisted variables
		mocks.browser = true;
		mocks.dev = false;

		// Save original env
		originalEnv = import.meta.env;

		// Setup default window mock
		delete (window as any).location;
		(window as any).location = {
			protocol: 'https:',
			host: 'example.com'
		};

		// Make env mutable for testing
		vi.stubEnv('VITE_SIGNALING_SERVER', '');

		// Ensure MINDLINE_ENV is cleared
		delete (window as any).MINDLINE_ENV;
	});

	afterEach(() => {
		(window as any).location = originalLocation;
		delete (window as any).MINDLINE_ENV;
		vi.unstubAllEnvs();
	});

	it('should return localhost config when not in browser', () => {
		mocks.browser = false;

		const config = getSignalingConfig();

		expect(config).toEqual({
			server: 'localhost:3000',
			useSSL: false
		});
	});

	it('should return localhost config when in dev mode', () => {
		mocks.dev = true;

		const config = getSignalingConfig();

		expect(config).toEqual({
			server: 'localhost:3000',
			useSSL: false
		});
	});

	describe('with MINDLINE_ENV runtime configuration', () => {
		it('should use SIGNALING_SERVER and default SSL from protocol', () => {
			(window as any).location.protocol = 'https:';
			(window as any).MINDLINE_ENV = {
				SIGNALING_SERVER: 'runtime.example.com'
			};

			const config = getSignalingConfig();

			expect(config).toEqual({
				server: 'runtime.example.com',
				useSSL: true
			});
		});

		it('should use boolean USE_SSL if provided', () => {
			(window as any).location.protocol = 'https:'; // Even if https, explicit false overrides
			(window as any).MINDLINE_ENV = {
				SIGNALING_SERVER: 'runtime.example.com',
				USE_SSL: false
			};

			const config = getSignalingConfig();

			expect(config).toEqual({
				server: 'runtime.example.com',
				useSSL: false
			});
		});

		it('should parse string USE_SSL if provided', () => {
			(window as any).location.protocol = 'http:'; // Even if http, explicit true string overrides
			(window as any).MINDLINE_ENV = {
				SIGNALING_SERVER: 'runtime.example.com',
				USE_SSL: 'true'
			};

			const config = getSignalingConfig();

			expect(config).toEqual({
				server: 'runtime.example.com',
				useSSL: true
			});
		});

		it('should parse string USE_SSL (false) if provided', () => {
			(window as any).location.protocol = 'https:';
			(window as any).MINDLINE_ENV = {
				SIGNALING_SERVER: 'runtime.example.com',
				USE_SSL: 'false'
			};

			const config = getSignalingConfig();

			expect(config).toEqual({
				server: 'runtime.example.com',
				useSSL: false
			});
		});
	});

	describe('with VITE_SIGNALING_SERVER environment variable', () => {
		it('should use the environment variable and default to useSSL true', () => {
			vi.stubEnv('VITE_SIGNALING_SERVER', 'env.example.com');

			const config = getSignalingConfig();

			expect(config).toEqual({
				server: 'env.example.com',
				useSSL: true
			});
		});
	});

	describe('fallback mechanisms', () => {
		it('should default to Cloudflare Pages generic signal server when on pages.dev', () => {
			(window as any).location.host = 'my-app.pages.dev';
			(window as any).location.protocol = 'https:';

			const config = getSignalingConfig();

			expect(config).toEqual({
				server: 'signal-mindline.fly.dev',
				useSSL: true
			});
		});

		it('should derive signaling server from host for generic domains (https)', () => {
			(window as any).location.host = 'custom.com';
			(window as any).location.protocol = 'https:';

			const config = getSignalingConfig();

			expect(config).toEqual({
				server: 'signal.custom.com',
				useSSL: true
			});
		});

		it('should derive signaling server from host for generic domains (http)', () => {
			(window as any).location.host = 'custom.local:8080';
			(window as any).location.protocol = 'http:';

			const config = getSignalingConfig();

			expect(config).toEqual({
				server: 'signal.custom.local:8080',
				useSSL: false
			});
		});
	});
});