import type { Handle } from '@sveltejs/kit';
import { version } from '$app/environment';

// Security and cache headers. The Content-Security-Policy itself is emitted by
// SvelteKit (see svelte.config.js `kit.csp`); these are the complementary
// headers, applied to every response that flows through SvelteKit (documents,
// endpoints, SSR). Note: adapter-node serves prebuilt static assets
// (/_app/immutable, service-worker.js, /icons, ...) via its own middleware
// *before* hooks run, so those responses don't pass through here — in
// production set blanket headers at the TLS reverse proxy in front of the app.
// Keep in sync with PROTOCOL.md §6.
const SECURITY_HEADERS: Record<string, string> = {
	'X-Content-Type-Options': 'nosniff',
	'X-Frame-Options': 'DENY',
	'Referrer-Policy': 'no-referrer',
	'X-DNS-Prefetch-Control': 'off',
	'Permissions-Policy': 'camera=(self), microphone=(self), geolocation=(), payment=(), usb=()'
};

export const handle: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);

	for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
		response.headers.set(name, value);
	}
	// The service worker keeps a page offline only when it is from its own
	// build (src/service-worker.js); a newer page would name uncached files.
	response.headers.set('x-mindline-build', version);

	// Cache-Control: no-store is load-bearing. A stale, edge-cached HTML document
	// once referenced hashed chunks that no longer existed after a deploy, taking
	// the app down entirely (2026-06-11). Documents and unhashed responses must
	// never be cached; immutable build assets keep their own long-lived header.
	if (!event.url.pathname.startsWith('/_app/immutable/')) {
		response.headers.set('Cache-Control', 'no-store');
	}

	return response;
};
