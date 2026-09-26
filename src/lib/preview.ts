/**
 * The line under a room in Recent rooms: who said the last thing, and what.
 * Computed on this device from its own decrypted history each time the list
 * shows; never stored, so no plaintext lands outside the encrypted store.
 */

interface Previewable {
	sender_id: string;
	sender_name: string;
	content: string;
	message_type: string;
	attachment?: { kind: string; name: string };
}

const ATTACHMENT: Record<string, string> = {
	image: 'a photo',
	video: 'a video',
	voice: 'a voice note',
	file: 'a file'
};

export function previewOf(list: readonly Previewable[], selfId: string): string | null {
	for (let i = list.length - 1; i >= 0; i--) {
		const m = list[i];
		if (m.message_type === 'Deleted' || m.content === '[Message deleted]') continue;
		const who = m.sender_id === selfId ? 'You' : m.sender_name;
		if (m.attachment) return `${who} sent ${ATTACHMENT[m.attachment.kind] ?? 'a file'}`;
		const text = m.content.replace(/\s+/g, ' ').trim();
		if (text) return `${who}: ${text}`;
	}
	return null;
}
