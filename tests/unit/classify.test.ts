import { describe, it, expect } from 'vitest';
import { mediaKindFor, renderableType } from '../../src/lib/media/classify';

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

describe('renderableType', () => {
	it('never lets a peer-chosen type render as a document at the app origin', () => {
		expect(renderableType('file', 'text/html')).toBe('application/octet-stream');
		expect(renderableType('image', 'image/svg+xml')).toBe('application/octet-stream');
		expect(renderableType('image', 'text/html')).toBe('application/octet-stream');
		expect(renderableType('video', 'text/html')).toBe('application/octet-stream');
		expect(renderableType('voice', 'application/xhtml+xml')).toBe('application/octet-stream');
	});

	it('keeps inline media types that browsers render as media', () => {
		expect(renderableType('image', 'image/webp')).toBe('image/webp');
		expect(renderableType('image', 'image/jpeg')).toBe('image/jpeg');
		expect(renderableType('video', 'video/mp4')).toBe('video/mp4');
		expect(renderableType('voice', 'audio/webm;codecs=opus')).toBe('audio/webm;codecs=opus');
	});
});
