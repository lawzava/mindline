/**
 * Split message text into plain-text and link segments so the view can
 * render anchors without {@html}. Only http(s) URLs and bare `www.` hosts
 * become links; every other scheme (javascript:, data:, ...) stays text.
 */

export type LinkSegment =
	| { type: 'text'; text: string }
	| { type: 'link'; text: string; href: string };

// A candidate starts at a word boundary with a scheme or `www.` and runs to
// the next whitespace. Validation happens after trimming, via URL().
const CANDIDATE = /\b(?:https?:\/\/|www\.)[^\s<>"]+/gi;

// Sentence punctuation that commonly trails a pasted URL.
const TRAILING = /[.,!?:;'"*_~]/;
const CLOSERS: Record<string, string> = { ')': '(', ']': '[', '}': '{' };

// Longer runs stay plain text: real URLs are far shorter, and the bound
// keeps a hostile message cheap to render for every member.
const MAX_URL_LENGTH = 2048;

/**
 * Drop trailing punctuation, and closing brackets only when unbalanced, so
 * "(see https://en.wikipedia.org/wiki/Foo_(bar))." keeps the inner ")".
 * Bracket balance is counted once and updated as characters are trimmed:
 * rescanning per character was quadratic in the run of closers.
 */
function trimTrailing(url: string): string {
	const balance: Record<string, number> = { ')': 0, ']': 0, '}': 0 };
	for (const c of url) {
		if (c in balance) balance[c]++;
		else if (c === '(') balance[')']--;
		else if (c === '[') balance[']']--;
		else if (c === '{') balance['}']--;
	}
	let end = url.length;
	while (end > 0) {
		const ch = url[end - 1];
		if (TRAILING.test(ch)) {
			end--;
			continue;
		}
		if (CLOSERS[ch] && balance[ch] > 0) {
			balance[ch]--;
			end--;
			continue;
		}
		break;
	}
	return url.slice(0, end);
}

/** The safe href for a candidate, or null if it is not an http(s) URL. */
function toHref(candidate: string): string | null {
	const raw = /^www\./i.test(candidate) ? `https://${candidate}` : candidate;
	try {
		const url = new URL(raw);
		if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
		if (!url.hostname) return null;
		return url.href;
	} catch {
		return null;
	}
}

export function linkify(text: string): LinkSegment[] {
	const segments: LinkSegment[] = [];
	const pushText = (t: string) => {
		if (!t) return;
		const last = segments[segments.length - 1];
		if (last?.type === 'text') last.text += t;
		else segments.push({ type: 'text', text: t });
	};

	let cursor = 0;
	for (const match of text.matchAll(CANDIDATE)) {
		const start = match.index;
		if (match[0].length > MAX_URL_LENGTH) continue;
		const candidate = trimTrailing(match[0]);
		const href = candidate ? toHref(candidate) : null;
		if (!href) continue;
		pushText(text.slice(cursor, start));
		segments.push({ type: 'link', text: candidate, href });
		cursor = start + candidate.length;
	}
	pushText(text.slice(cursor));
	return segments;
}
