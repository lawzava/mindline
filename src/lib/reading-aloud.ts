/**
 * Read drafts aloud: the peer's forming words go to a screen reader a
 * phrase at a time, never per keystroke. A phrase is ready when the draft
 * ends a sentence or clause, when an unpunctuated run reaches a group of
 * whole words, or when the peer pauses. Only the new part is spoken, so a
 * long draft is heard once, not re-read from the top on every change.
 *
 * Only peers' drafts reach the drafts store (your own typing never does),
 * so the user's own composer is never announced.
 */

/** Stillness that counts as a pause: speak whatever is unspoken. */
export const PAUSE_MS = 1000;
/** Boundaries closer together than this wait for the pause instead. */
export const MIN_GAP_MS = 1000;
/** An unpunctuated run is spoken once it holds this many whole words. */
export const WORD_GROUP = 6;

// Sentence end (with any closing quote or bracket) or clause break, each
// followed by whitespace, or a line break. "3.5" and "e.g" stay whole.
const BOUNDARY = /[.!?…]+["'”’)\]]*\s+|[,;:]\s+|\n+/g;
const WHOLE_WORDS = /^(?:\s*\S+\s+)+/;

/**
 * How much of `tail` (the unspoken end of a draft) is ready to speak while
 * the peer is still typing. 0 means keep listening.
 */
export function readyLength(tail: string): number {
	let end = 0;
	for (const match of tail.matchAll(BOUNDARY)) end = match.index + match[0].length;
	if (end > 0) return end;
	const words = tail.match(WHOLE_WORDS)?.[0] ?? '';
	return words.trim().split(/\s+/).length >= WORD_GROUP ? words.length : 0;
}

/** Cut `text` back to its last word start, so a word is re-read whole. */
function toWordStart(text: string): string {
	const cut = Math.max(text.lastIndexOf(' '), text.lastIndexOf('\n'));
	return cut >= 0 ? text.slice(0, cut + 1) : '';
}

/**
 * Where speaking resumes when the draft changes under what was spoken:
 * after a correction, from the start of the first changed word; after a
 * pause mid-word, from the start of that word once it grows.
 */
export function resumeFrom(spoken: string, content: string): string {
	if (!content.startsWith(spoken)) {
		let i = 0;
		while (i < spoken.length && spoken[i] === content[i]) i++;
		return toWordStart(content.slice(0, i));
	}
	const midWord = /\S$/.test(spoken) && /^\S/.test(content.slice(spoken.length));
	return midWord ? toWordStart(spoken) : spoken;
}

interface PeerDraft {
	name: string;
	content: string;
	spoken: string;
	timer?: ReturnType<typeof setTimeout>;
}

export function createDraftAnnouncer(announce: (text: string) => void) {
	const peers = new Map<string, PeerDraft>();
	let lastSpeaker: string | null = null;
	let lastAt = -Infinity;

	function speak(peerId: string, draft: PeerDraft, upto: number): void {
		const chunk = draft.content.slice(draft.spoken.length, upto).trim();
		draft.spoken = draft.content.slice(0, upto);
		if (!chunk) return;
		// Name the speaker when the voice changes, as a caption would.
		announce(lastSpeaker === peerId ? chunk : `${draft.name}: ${chunk}`);
		lastSpeaker = peerId;
		lastAt = Date.now();
	}

	function forget(peerId: string): void {
		clearTimeout(peers.get(peerId)?.timer);
		peers.delete(peerId);
		if (lastSpeaker === peerId) lastSpeaker = null;
	}

	return {
		/** Feed the peer's current draft; identical content is a no-op. */
		update(peerId: string, name: string, content: string): void {
			let draft = peers.get(peerId);
			if (!draft) {
				draft = { name, content: '', spoken: '' };
				peers.set(peerId, draft);
			}
			draft.name = name;
			if (content === draft.content) return;
			draft.spoken = resumeFrom(draft.spoken, content);
			draft.content = content;
			clearTimeout(draft.timer);
			draft.timer = undefined;

			const ready = readyLength(content.slice(draft.spoken.length));
			if (ready > 0 && Date.now() - lastAt >= MIN_GAP_MS) {
				speak(peerId, draft, draft.spoken.length + ready);
			}
			if (content.length > draft.spoken.length) {
				const pending = draft;
				pending.timer = setTimeout(() => {
					pending.timer = undefined;
					speak(peerId, pending, pending.content.length);
				}, PAUSE_MS);
			}
		},

		/** Keep only these peers; the rest sent, cleared, or left. */
		retain(peerIds: Set<string>): void {
			for (const peerId of [...peers.keys()]) if (!peerIds.has(peerId)) forget(peerId);
		},

		dispose(): void {
			for (const peerId of [...peers.keys()]) forget(peerId);
			lastSpeaker = null;
		}
	};
}
