import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// First we mock the environment variable because it is imported at module load
vi.mock('$app/environment', () => ({
	browser: true,
	dev: false
}));

// We must import after setting up the mock
import { isMobileNetwork, isMobileDevice } from '../config';

describe('isMobileNetwork', () => {
	let originalNavigator: any;

	beforeEach(() => {
		originalNavigator = window.navigator;
		// @ts-ignore
		window.navigator = { ...originalNavigator };
	});

	afterEach(() => {
		window.navigator = originalNavigator;
	});

	it('returns false if connection object is missing', () => {
		// @ts-ignore
		delete window.navigator.connection;
		expect(isMobileNetwork()).toBe(false);
	});

	it('returns true if connection.type is cellular', () => {
		// @ts-ignore
		window.navigator.connection = { type: 'cellular' };
		expect(isMobileNetwork()).toBe(true);
	});

	it('returns false if connection.type is wifi and effectiveType is fast', () => {
		// @ts-ignore
		window.navigator.connection = { type: 'wifi', effectiveType: '4g' };
		expect(isMobileNetwork()).toBe(false);
	});

	it('returns true if effectiveType is slow-2g', () => {
		// @ts-ignore
		window.navigator.connection = { effectiveType: 'slow-2g' };
		expect(isMobileNetwork()).toBe(true);
	});

	it('returns true if effectiveType is 2g', () => {
		// @ts-ignore
		window.navigator.connection = { effectiveType: '2g' };
		expect(isMobileNetwork()).toBe(true);
	});

	it('returns true if effectiveType is 3g', () => {
		// @ts-ignore
		window.navigator.connection = { effectiveType: '3g' };
		expect(isMobileNetwork()).toBe(true);
	});

	it('returns false if effectiveType is 4g', () => {
		// @ts-ignore
		window.navigator.connection = { effectiveType: '4g' };
		expect(isMobileNetwork()).toBe(false);
	});

	it('returns true if both type and effectiveType indicate mobile', () => {
		// @ts-ignore
		window.navigator.connection = { type: 'cellular', effectiveType: '3g' };
		expect(isMobileNetwork()).toBe(true);
	});

	it('returns true if type is cellular but effectiveType is fast', () => {
		// @ts-ignore
		window.navigator.connection = { type: 'cellular', effectiveType: '4g' };
		expect(isMobileNetwork()).toBe(true);
	});
});

describe('isMobileDevice', () => {
	let originalNavigator: any;

	beforeEach(() => {
		originalNavigator = window.navigator;
		// @ts-ignore
		window.navigator = { ...originalNavigator };
	});

	afterEach(() => {
		window.navigator = originalNavigator;
	});

	it('returns true for Android user agents', () => {
		// @ts-ignore
		window.navigator.userAgent = 'Mozilla/5.0 (Linux; Android 10; SM-G973F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.149 Mobile Safari/537.36';
		expect(isMobileDevice()).toBe(true);
	});

	it('returns true for iPhone user agents', () => {
		// @ts-ignore
		window.navigator.userAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 13_3_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.5 Mobile/15E148 Safari/604.1';
		expect(isMobileDevice()).toBe(true);
	});

	it('returns true for iPad user agents', () => {
		// @ts-ignore
		window.navigator.userAgent = 'Mozilla/5.0 (iPad; CPU OS 13_3_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.5 Mobile/15E148 Safari/604.1';
		expect(isMobileDevice()).toBe(true);
	});

	it('returns false for desktop Windows user agents', () => {
		// @ts-ignore
		window.navigator.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.149 Safari/537.36';
		expect(isMobileDevice()).toBe(false);
	});

	it('returns false for desktop Mac user agents', () => {
		// @ts-ignore
		window.navigator.userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.149 Safari/537.36';
		expect(isMobileDevice()).toBe(false);
	});
});
