/**
 * Photo path (PROTOCOL.md §5.3).
 *
 * Every image is re-encoded through a canvas before sending: JPEG EXIF,
 * PNG eXIf chunks, and WebP EXIF/XMP all carry GPS metadata, so nothing
 * skips the pass. WebP output is feature-detected (Safari and Firefox
 * encode PNG/JPEG only); orientation is normalized via imageOrientation
 * where the engine supports it.
 */

const MAX_EDGE = 2048;
const THUMB_EDGE = 32;
const QUALITY = 0.82;

export interface ProcessedImage {
	data: Uint8Array;
	mime: string;
	thumb: string; // base64 (no data: prefix)
	thumbMime: string;
	width: number;
	height: number;
}

async function loadBitmap(file: Blob): Promise<ImageBitmap> {
	try {
		// 'from-image' is the modern default; older Firefox throws on the option.
		return await createImageBitmap(file, { imageOrientation: 'from-image' });
	} catch {
		return await createImageBitmap(file);
	}
}

function drawScaled(bitmap: ImageBitmap, maxEdge: number): HTMLCanvasElement {
	const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
	const canvas = document.createElement('canvas');
	canvas.width = Math.max(1, Math.round(bitmap.width * scale));
	canvas.height = Math.max(1, Math.round(bitmap.height * scale));
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('canvas 2d context unavailable');
	ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
	return canvas;
}

/** toBlob with WebP attempt and JPEG fallback, detected via blob.type. */
async function encodeCanvas(canvas: HTMLCanvasElement): Promise<Blob> {
	const tryEncode = (mime: string) =>
		new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, QUALITY));
	const webp = await tryEncode('image/webp');
	if (webp && webp.type === 'image/webp') return webp;
	const jpeg = await tryEncode('image/jpeg');
	if (jpeg && jpeg.type === 'image/jpeg') return jpeg;
	throw new Error('image encoding failed');
}

function blobToBase64(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(blob);
	});
}

export async function processImage(file: Blob): Promise<ProcessedImage> {
	const bitmap = await loadBitmap(file);
	try {
		const full = drawScaled(bitmap, MAX_EDGE);
		const encoded = await encodeCanvas(full);

		const thumbCanvas = drawScaled(bitmap, THUMB_EDGE);
		const thumbBlob = await encodeCanvas(thumbCanvas);

		return {
			data: new Uint8Array(await encoded.arrayBuffer()),
			mime: encoded.type,
			thumb: await blobToBase64(thumbBlob),
			thumbMime: thumbBlob.type,
			width: full.width,
			height: full.height
		};
	} finally {
		bitmap.close();
	}
}
