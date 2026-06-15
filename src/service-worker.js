/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

const sw = /** @type {ServiceWorkerGlobalScope} */ (/** @type {unknown} */ (self));
import { build, files, version } from '$service-worker';

const CACHE = `mindline-${version}`;
// env-config.js is injected per deploy at publish time; caching it would
// freeze stale runtime config (signaling host) across releases.
const ASSETS = [...build, ...files.filter((f) => !f.includes('env-config'))];

sw.addEventListener('install', (event) => {
	event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
	);
});

sw.addEventListener('fetch', (event) => {
	if (event.request.method !== 'GET') return;
	const url = new URL(event.request.url);
	// Cache-first for immutable build assets only; rooms stay network-first.
	if (ASSETS.includes(url.pathname)) {
		event.respondWith(
			caches
				.open(CACHE)
				.then(async (cache) => (await cache.match(event.request)) ?? fetch(event.request))
		);
	}
});
