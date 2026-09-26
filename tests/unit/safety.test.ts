import { beforeEach, describe, expect, test, vi } from 'vitest';
import { deviceFingerprint, safetyNumber } from '$lib/crypto/safety';
import { verifyStatus, verified } from '$lib/stores/verified';
import { get } from 'svelte/store';

vi.mock('$app/environment', () => ({ browser: false }));
const spkiA = 'AAAA';
const spkiB = 'BBBB';

describe('safety numbers', () => {
	test('both sides compute the same 60-digit number', async () => {
		const a = await deviceFingerprint(spkiA, 'kem-a');
		const b = await deviceFingerprint(spkiB, 'kem-b');
		const ab = await safetyNumber(a, b);
		expect(ab).toBe(await safetyNumber(b, a));
		expect(ab).toMatch(/^(\d{5} ){11}\d{5}$/);
	});

	test('a different post-quantum key changes the number', async () => {
		const a = await deviceFingerprint(spkiA, 'kem-a');
		const b1 = await deviceFingerprint(spkiB, 'kem-b');
		const b2 = await deviceFingerprint(spkiB, 'kem-b2');
		expect(await safetyNumber(a, b1)).not.toBe(await safetyNumber(a, b2));
	});
});

describe('verified devices', () => {
	beforeEach(() => verified.clear());

	test('verification is bound to the fingerprint, and a changed key is flagged', () => {
		expect(verifyStatus(get(verified), 'dev-b', 'fp1', 'Bob')).toBe('unverified');
		verified.mark('dev-b', 'fp1', 'Bob');
		expect(verifyStatus(get(verified), 'dev-b', 'fp1', 'Bob')).toBe('verified');
		expect(verifyStatus(get(verified), 'dev-b', 'fp2', 'Bob')).toBe('changed');
	});

	test('a different device using a verified name is flagged as an impostor', () => {
		verified.mark('dev-b', 'fp1', 'Bob');
		expect(verifyStatus(get(verified), 'dev-x', 'fp9', 'Bob')).toBe('impostor');
		expect(verifyStatus(get(verified), 'dev-x', 'fp9', 'bob ')).toBe('impostor');
		expect(verifyStatus(get(verified), 'dev-x', 'fp9', 'Carol')).toBe('unverified');
	});

	test('clearing a verification returns the device to unverified', () => {
		verified.mark('dev-b', 'fp1', 'Bob');
		verified.unmark('dev-b');
		expect(verifyStatus(get(verified), 'dev-b', 'fp1', 'Bob')).toBe('unverified');
	});
});
