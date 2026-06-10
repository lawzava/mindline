import { describe, it, expect } from 'vitest';
import { mediaKindFor } from '../../src/lib/media/classify';

describe('mediaKindFor', () => {
	it('routes image MIME types to image', () => {
		expect(mediaKindFor('image/jpeg')).toBe('image');
		expect(mediaKindFor('image/webp')).toBe('image');
		expect(mediaKindFor('image/heic')).toBe('image');
	});

	it('routes video MIME types to video so they play inline', () => {
		expect(mediaKindFor('video/mp4')).toBe('video');
		expect(mediaKindFor('video/webm')).toBe('video');
		expect(mediaKindFor('video/quicktime')).toBe('video');
	});

	it('routes everything else to file', () => {
		expect(mediaKindFor('application/pdf')).toBe('file');
		expect(mediaKindFor('audio/mpeg')).toBe('file');
		expect(mediaKindFor('')).toBe('file');
		expect(mediaKindFor('application/octet-stream')).toBe('file');
	});
});
