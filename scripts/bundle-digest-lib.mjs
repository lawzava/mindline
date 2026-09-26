// Pure helpers for scripts/bundle-digest.mjs (docs/BUNDLE_VERIFICATION.md):
// which bundle files a page or file references, and one digest over a set.

const IMMUTABLE = '/_app/immutable/';

// Quoted or url()-wrapped relative or absolute asset paths.
const REFERENCE = /(?:["'(]|url\()\s*((?:\.{1,2}\/|\/_app\/immutable\/)[^"')\s]+)/g;

/**
 * Immutable-bundle paths referenced by `text` (HTML, JS, or CSS) served at
 * `baseUrl`, resolved and de-duplicated, in first-seen order. Anything that
 * resolves outside /_app/immutable/ or to another origin is ignored.
 *
 * @param {string} text
 * @param {string} baseUrl
 * @returns {string[]}
 */
export function referencedAssets(text, baseUrl) {
	const base = new URL(baseUrl);
	/** @type {string[]} */
	const found = [];
	for (const match of text.matchAll(REFERENCE)) {
		let url;
		try {
			url = new URL(match[1], base);
		} catch {
			continue;
		}
		if (url.origin !== base.origin || !url.pathname.startsWith(IMMUTABLE)) continue;
		if (!found.includes(url.pathname)) found.push(url.pathname);
	}
	return found;
}

/**
 * @param {Uint8Array} bytes
 * @returns {Promise<string>}
 */
async function sha256Hex(bytes) {
	const digest = await crypto.subtle.digest('SHA-256', /** @type {BufferSource} */ (bytes));
	return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Per-file hashes, sorted by path.
 *
 * @param {Map<string, Uint8Array>} files
 * @returns {Promise<[string, string][]>}
 */
export async function fileHashes(files) {
	/** @type {[string, string][]} */
	const entries = [];
	for (const [path, bytes] of files) entries.push([path, await sha256Hex(bytes)]);
	entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
	return entries;
}

/**
 * One digest over sorted "path hash" lines.
 *
 * @param {Map<string, Uint8Array>} files
 * @returns {Promise<string>}
 */
export async function bundleDigest(files) {
	const lines = (await fileHashes(files)).map(([path, hash]) => `${path} ${hash}\n`).join('');
	return sha256Hex(new TextEncoder().encode(lines));
}
