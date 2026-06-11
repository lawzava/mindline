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
