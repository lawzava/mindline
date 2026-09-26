import { describe, expect, test } from 'vitest';
import jsQR from 'jsqr';
import { encodeQr } from '$lib/qr';
import { compareScanned, parseSafetyQr, safetyQrText } from '$lib/safety-qr';

const NUMBER = '12345 67890 11111 22222 33333 44444 55555 66666 77777 88888 99999 00000';

/** The QR as camera-like grey pixels, 6 px per module. */
function render(text: string): { data: Uint8ClampedArray; width: number; height: number } {
	const { modules, size } = encodeQr(text);
	const scale = 6;
	const width = size * scale;
	const data = new Uint8ClampedArray(width * width * 4);
	for (let y = 0; y < width; y++) {
		for (let x = 0; x < width; x++) {
			const dark = modules[Math.floor(y / scale)][Math.floor(x / scale)];
			const i = (y * width + x) * 4;
			data[i] = data[i + 1] = data[i + 2] = dark ? 20 : 240;
			data[i + 3] = 255;
		}
	}
	return { data, width, height: width };
}

describe('safety number QR', () => {
	test('the code carries the number and nothing else', () => {
		expect(safetyQrText(NUMBER)).toBe(`MINDLINE-SAFETY:1:${NUMBER.replace(/ /g, '')}`);
		expect(parseSafetyQr(safetyQrText(NUMBER))).toBe(NUMBER);
	});

	test('anything else is not a safety code', () => {
		for (const text of [
			'https://mindline.chat/f_abc#k=xyz',
			'MINDLINE-SAFETY:1:123',
			'MINDLINE-SAFETY:2:' + '1'.repeat(60),
			''
		]) {
			expect(parseSafetyQr(text)).toBeNull();
		}
	});

	test('a scan matches only the same number', () => {
		expect(compareScanned(safetyQrText(NUMBER), NUMBER)).toBe('match');
		const other = NUMBER.replace('12345', '12346');
		expect(compareScanned(safetyQrText(other), NUMBER)).toBe('mismatch');
		expect(compareScanned('hello', NUMBER)).toBe('invalid');
	});

	test('the rendered code reads back through the scanner', () => {
		const image = render(safetyQrText(NUMBER));
		const read = jsQR(image.data, image.width, image.height);
		expect(read?.data && parseSafetyQr(read.data)).toBe(NUMBER);
	});
});
