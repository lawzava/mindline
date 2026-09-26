import { describe, it, expect } from 'vitest';
import { encodeQr, qrPath, QR_QUIET_ZONE } from '../../src/lib/qr';

// A realistic invite: origin + UUID room id + 32-byte base64url key.
const INVITE =
	'https://mindline.chat/0f8e2a4c-1b3d-4e5f-8a9b-7c6d5e4f3a2b#k=' +
	'Q2hhbmdlIHRoaXMga2V5IGJlZm9yZSBzaGlwcGluZyBpdCBwbGVhc2UhIQ';

function darkCount(modules: boolean[][]): number {
	return modules.flat().filter(Boolean).length;
}

describe('encodeQr', () => {
	it('encodes a ~110 character invite URL at a phone-scannable version', () => {
		expect(INVITE.length).toBeGreaterThanOrEqual(105);
		const qr = encodeQr(INVITE);
		// Byte mode at ECC M: 106 bytes fit version 6, 122 fit version 7.
		expect(qr.version).toBeGreaterThanOrEqual(6);
		expect(qr.version).toBeLessThanOrEqual(8);
		expect(qr.size).toBe(17 + 4 * qr.version + 2 * QR_QUIET_ZONE);
	});

	it('produces a square matrix', () => {
		const qr = encodeQr(INVITE);
		expect(qr.modules).toHaveLength(qr.size);
		for (const row of qr.modules) expect(row).toHaveLength(qr.size);
	});

	it('keeps a quiet zone of light modules on every side', () => {
		const { modules, size } = encodeQr(INVITE);
		for (let i = 0; i < size; i++) {
			for (let q = 0; q < QR_QUIET_ZONE; q++) {
				expect(modules[q][i]).toBe(false);
				expect(modules[size - 1 - q][i]).toBe(false);
				expect(modules[i][q]).toBe(false);
				expect(modules[i][size - 1 - q]).toBe(false);
			}
		}
	});

	it('places the finder pattern just inside the quiet zone', () => {
		const { modules } = encodeQr(INVITE);
		const o = QR_QUIET_ZONE;
		// 7x7 dark ring, light ring, 3x3 dark core.
		for (let i = 0; i < 7; i++) {
			expect(modules[o][o + i]).toBe(true);
			expect(modules[o + 6][o + i]).toBe(true);
			expect(modules[o + i][o]).toBe(true);
			expect(modules[o + i][o + 6]).toBe(true);
		}
		expect(modules[o + 1][o + 1]).toBe(false);
		expect(modules[o + 3][o + 3]).toBe(true);
	});

	it('is deterministic and grows with the payload', () => {
		expect(encodeQr(INVITE).modules).toEqual(encodeQr(INVITE).modules);
		expect(encodeQr('https://mindline.chat/a').version).toBeLessThan(encodeQr(INVITE).version);
	});
});

describe('qrPath', () => {
	it('covers exactly the dark modules', () => {
		const { modules } = encodeQr(INVITE);
		const d = qrPath(modules);
		const runs = [...d.matchAll(/M(\d+) (\d+)h(\d+)v1h-(\d+)z/g)];
		expect(runs.map((m) => m[0]).join('')).toBe(d);
		let area = 0;
		for (const [, x, y, w, back] of runs) {
			expect(back).toBe(w);
			for (let i = 0; i < Number(w); i++) expect(modules[Number(y)][Number(x) + i]).toBe(true);
			area += Number(w);
		}
		expect(area).toBe(darkCount(modules));
	});

	it('emits nothing for an all-light matrix', () => {
		expect(
			qrPath([
				[false, false],
				[false, false]
			])
		).toBe('');
	});
});
