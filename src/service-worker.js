/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

// Offline and updates (docs/PROTOCOL.md §4 "Offline"): the build's own files
// are served from a per-version cache; pages always come from the network
// first, so an update arrives on the next load exactly as it would without
// a worker. The last pages visited are kept only so they still open with no
// connection: a room then shows its saved history until peers are reachable.
// No version is pinned: the server can replace this worker anyway, so a pin
// would promise more than it could keep.

const sw = /** @type {ServiceWorkerGlobalScope} */ (/** @type {unknown} */ (self));
import { build, files, version } from '$service-worker';

const CACHE = `mindline-${version}`;
// Burn (src/lib/storage/burn.ts) deletes a room's page from caches with this prefix.
const PAGES = `mindline-pages-${version}`;
/** Pages kept for offline use; the oldest go first. */
const MAX_PAGES = 20;
// env-config.js is injected per deploy at publish time; caching it would
// freeze stale runtime config (signaling host) across releases.
const ASSETS = [...build, ...files.filter((f) => !f.includes('env-config'))];

sw.addEventListener('install', (event) => {
	event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
});

sw.addEventListener('activate', (event) => {
	// A page from an older build names files that are gone: drop both.
	event.waitUntil(
		caches
			.keys()
			.then((keys) =>
				Promise.all(keys.filter((k) => k !== CACHE && k !== PAGES).map((k) => caches.delete(k)))
			)
	);
});

/**
 * The cache key for a page: its path alone (fragments never reach here).
 * @param {URL} url
 */
function pageKey(url) {
	return new URL(url.pathname, url.origin).href;
}

/**
 * Keep a page for offline use. Only a page of this worker's own build is
 * kept (x-mindline-build, set in hooks.server.ts): a newer page names files
 * this worker never cached and would open blank offline. Failures here
 * (a full quota) never affect the page itself.
 * @param {string} key
 * @param {Response} response
 */
async function keepPage(key, response) {
	if (response.headers.get('x-mindline-build') !== version) return;
	try {
		const cache = await caches.open(PAGES);
		// Re-inserted so the latest visit sorts last; the oldest go first.
		await cache.delete(key);
		await cache.put(key, response);
		const keys = await cache.keys();
		for (const old of keys.slice(0, Math.max(0, keys.length - MAX_PAGES))) {
			await cache.delete(old);
		}
	} catch {
		/* storage full or unavailable: the page still loads, just not offline */
	}
}

/**
 * @param {FetchEvent} event
 */
async function page(event) {
	const key = pageKey(new URL(event.request.url));
	let response;
	try {
		response = await fetch(event.request);
	} catch (error) {
		const cached = await caches.match(key, { cacheName: PAGES });
		if (cached) return cached;
		throw error;
	}
	if (response.ok && response.type === 'basic') {
		event.waitUntil(keepPage(key, response.clone()));
	}
	return response;
}

sw.addEventListener('fetch', (event) => {
	if (event.request.method !== 'GET') return;
	const url = new URL(event.request.url);
	if (url.origin !== sw.location.origin) return;
	if (event.request.mode === 'navigate') {
		event.respondWith(page(event));
		return;
	}
	// Cache-first for the build's own files only.
	if (ASSETS.includes(url.pathname)) {
		event.respondWith(
			caches
				.open(CACHE)
				.then(async (cache) => (await cache.match(event.request)) ?? fetch(event.request))
		);
	}
});
