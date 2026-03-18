import { describe, it, expect, vi, beforeEach } from 'vitest';
import { webcryptoRandomBytes } from './crypto';

describe('webcryptoRandomBytes', () => {
	beforeEach(() => {
		vi.stubGlobal('window', {
			crypto: {
				getRandomValues: vi.fn((arr: Uint8Array) => {
					for (let i = 0; i < arr.length; i++) {
						arr[i] = i + 1;
					}
					return arr;
				})
			}
		});
	});

	it('should use window.crypto.getRandomValues if available', () => {
		const result = webcryptoRandomBytes(5);
		expect(window.crypto.getRandomValues).toHaveBeenCalledTimes(1);
		expect(result).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
	});

	it('should fallback to Math.random if window.crypto is unavailable', () => {
		vi.stubGlobal('window', { crypto: undefined });
		const mockMath = Object.create(Math);
		mockMath.random = vi.fn().mockReturnValue(0.5);
		vi.stubGlobal('Math', mockMath);

		const result = webcryptoRandomBytes(3);

		expect(Math.random).toHaveBeenCalledTimes(3);
		expect(result).toEqual(new Uint8Array([128, 128, 128]));
	});

	it('should fallback to Math.random if window is undefined', () => {
		vi.stubGlobal('window', undefined);
		const mockMath = Object.create(Math);
		mockMath.random = vi.fn().mockReturnValue(0.25);
		vi.stubGlobal('Math', mockMath);

		const result = webcryptoRandomBytes(4);

		expect(Math.random).toHaveBeenCalledTimes(4);
		expect(result).toEqual(new Uint8Array([64, 64, 64, 64]));
	});

	it('should generate an empty array if length is 0', () => {
		const result = webcryptoRandomBytes(0);
		expect(result.length).toBe(0);
	});
});
