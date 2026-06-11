/**
 * Sync pagination (PROTOCOL.md §3.5): pages of ≤40 messages and ≤32 KB
 * serialized plaintext, so a wire envelope stays far below DataChannel
 * message-size floors even for thumbnail-heavy history. Sync never
 * relays. Kept store-free so it is testable outside SvelteKit.
 */

import type { Message } from '$lib/types/message';

const MAX_COUNT = 40;
const MAX_BYTES = 32 * 1024;

export function paginateSyncMessages(roomMessages: Message[]): Message[][] {
	const pages: Message[][] = [];
	let page: Message[] = [];
	let bytes = 0;
	for (const msg of roomMessages) {
		const size = new TextEncoder().encode(JSON.stringify(msg)).length;
		if (size > MAX_BYTES) {
			// A single oversized item would blow past DataChannel floors
			// after envelope overhead; it stays local and live-only (§3.5).
			console.warn('[P2P Sync] excluding oversized history item from sync:', msg.id);
			continue;
		}
		if (page.length > 0 && (page.length >= MAX_COUNT || bytes + size > MAX_BYTES)) {
			pages.push(page);
			page = [];
			bytes = 0;
		}
		page.push(msg);
		bytes += size;
	}
	if (page.length > 0) pages.push(page);
	return pages;
}
