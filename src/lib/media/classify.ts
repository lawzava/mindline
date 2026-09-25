import type { MediaKind } from './transfer';

/**
 * Pick the attachment kind from a file's MIME type. Images and videos get
 * inline rendering; everything else is a downloadable file card.
 */
export function mediaKindFor(mime: string): MediaKind {
	if (mime.startsWith('image/')) return 'image';
	if (mime.startsWith('video/')) return 'video';
	return 'file';
}

const INLINE_IMAGE_TYPES = new Set([
	'image/jpeg',
	'image/png',
	'image/webp',
	'image/gif',
	'image/avif'
]);

/**
 * The Blob type for a received attachment. The MIME is peer-chosen, and a
 * blob: URL opened in a tab renders at the app origin, so anything that is
 * not plain inline media (HTML, SVG, XML) is downgraded to a download.
 */
export function renderableType(kind: MediaKind, mime: string): string {
	const base = mime.split(';')[0].trim().toLowerCase();
	const ok =
		(kind === 'image' && INLINE_IMAGE_TYPES.has(base)) ||
		(kind === 'video' && base.startsWith('video/')) ||
		(kind === 'voice' && (base.startsWith('audio/') || base.startsWith('video/')));
	return ok ? mime : 'application/octet-stream';
}
