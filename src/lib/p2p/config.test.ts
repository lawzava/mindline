import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isMobileNetwork, isMobileDevice } from './config';

// Mock $app/environment
vi.mock('$app/environment', () => ({
	browser: true,
	dev: true
}));

describe('isMobileNetwork', () => {
	beforeEach(() => {
		vi.resetAllMocks();

		// Reset navigator for each test
		Object.defineProperty(window, 'navigator', {
			value: {
				userAgent: '',
				connection: undefined
			},
			configurable: true,
			writable: true
		});
	});

	it('should return false if no connection object exists', () => {
		expect(isMobileNetwork()).toBe(false);
	});

	it('should return true if connection.type is cellular', () => {
		(window as any).navigator.connection = { type: 'cellular' };
		expect(isMobileNetwork()).toBe(true);
	});

	it('should return false if connection.type is wifi', () => {
		(window as any).navigator.connection = { type: 'wifi' };
		expect(isMobileNetwork()).toBe(false);
	});

	it('should return true if effectiveType is 2g', () => {
		(window as any).navigator.connection = { effectiveType: '2g' };
		expect(isMobileNetwork()).toBe(true);
	});

	it('should return true if effectiveType is 3g', () => {
		(window as any).navigator.connection = { effectiveType: '3g' };
		expect(isMobileNetwork()).toBe(true);
	});

	it('should return true if effectiveType is slow-2g', () => {
		(window as any).navigator.connection = { effectiveType: 'slow-2g' };
		expect(isMobileNetwork()).toBe(true);
	});

	it('should return false if effectiveType is 4g', () => {
		(window as any).navigator.connection = { effectiveType: '4g' };
		expect(isMobileNetwork()).toBe(false);
	});
});

describe('isMobileDevice', () => {
	beforeEach(() => {
		vi.resetAllMocks();

		// Reset navigator for each test
		Object.defineProperty(window, 'navigator', {
			value: {
				userAgent: '',
			},
			configurable: true,
			writable: true
		});
	});

	it('should return true for iPhone', () => {
		(window as any).navigator.userAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1';
		expect(isMobileDevice()).toBe(true);
	});

	it('should return true for Android', () => {
		(window as any).navigator.userAgent = 'Mozilla/5.0 (Linux; Android 10; SM-A205U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0.4280.141 Mobile Safari/537.36';
		expect(isMobileDevice()).toBe(true);
	});

	it('should return false for Desktop Chrome', () => {
		(window as any).navigator.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';
		expect(isMobileDevice()).toBe(false);
	});

	it('should return false for Desktop Safari', () => {
		(window as any).navigator.userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.1 Safari/605.1.15';
		expect(isMobileDevice()).toBe(false);
	});
});
