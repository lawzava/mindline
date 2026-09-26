/**
 * Check, from the browser, that the code this site serves is the build
 * published for its commit (docs/BUNDLE_VERIFICATION.md). CI publishes each
 * main build's per-file SHA-256 list to the repository's bundle-digests
 * branch; this crawls what the site serves (as scripts/bundle-digest.mjs
 * does) and compares every file. Nothing runs unless the person asks, since
 * fetching the published list tells GitHub this address uses Mindline.
 */

import { fileHashes, referencedAssets } from '../../scripts/bundle-digest-lib.mjs';

export interface PublishedBuild {
	version: string;
	/** Path under /_app/immutable/ to SHA-256 hex. */
	files: Record<string, string>;
}

export interface BuildCheck {
	ok: boolean;
	/** Served files compared. */
	checked: number;
	/** Served files that differ from, or are missing in, the published build. */
	mismatches: string[];
}

const MAX_FILES = 1000;

export function publishedDigestUrl(version: string): string {
	if (!/^[0-9a-f]{40}$/.test(version)) throw new Error('not a commit id');
	return `https://raw.githubusercontent.com/lawzava/mindline/bundle-digests/${version}.json`;
}

type Fetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

async function bytesOf(fetchFn: Fetch, url: URL): Promise<Uint8Array> {
	const response = await fetchFn(url, { cache: 'no-store' });
	if (!response.ok) throw new Error(`${url.pathname}: HTTP ${response.status}`);
	return new Uint8Array(await response.arrayBuffer());
}

/** Crawl the served bundle from the entry page and compare it file by file. */
export async function checkServedBuild(options: {
	origin: string;
	fetch: Fetch;
	published: PublishedBuild;
}): Promise<BuildCheck> {
	const { origin, published } = options;
	const files = new Map<string, Uint8Array>();
	const html = new TextDecoder().decode(await bytesOf(options.fetch, new URL('/', origin)));
	const queue = referencedAssets(html, origin);
	while (queue.length > 0) {
		const path = queue.shift()!;
		if (files.has(path)) continue;
		if (files.size >= MAX_FILES) throw new Error('bundle larger than expected');
		const url = new URL(path, origin);
		const bytes = await bytesOf(options.fetch, url);
		files.set(path, bytes);
		if (/\.(js|css)$/.test(path)) {
			for (const ref of referencedAssets(new TextDecoder().decode(bytes), url.href)) {
				if (!files.has(ref)) queue.push(ref);
			}
		}
	}
	const mismatches: string[] = [];
	for (const [path, hash] of await fileHashes(files)) {
		if (published.files[path] !== hash) mismatches.push(path);
	}
	return { ok: mismatches.length === 0 && files.size > 0, checked: files.size, mismatches };
}

/** Fetch the published list for this build, then check what is served. */
export async function verifyThisBuild(version: string): Promise<BuildCheck> {
	const response = await fetch(publishedDigestUrl(version), { cache: 'no-store' });
	if (response.status === 404) throw new Error('No published digest for this build yet.');
	if (!response.ok) throw new Error('The published digest could not be fetched.');
	const published = (await response.json()) as PublishedBuild;
	if (published.version !== version || typeof published.files !== 'object') {
		throw new Error('The published digest is for another build.');
	}
	return checkServedBuild({ origin: location.origin, fetch: fetch.bind(globalThis), published });
}
