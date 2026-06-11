import type { Handle } from '@sveltejs/kit';

/**
 * Document responses come from the SvelteKit worker, and Cloudflare Pages
 * applies `_headers` only to static assets — so every header that matters
 * for HTML must be set here.
 *
 * Cache-Control: no-store is load-bearing: a zone-level cache rule once
 * edge-cached the HTML, and after a deploy the stale page referenced hashed
 * chunks that no longer existed, taking the app down entirely (2026-06-11).
 * Documents must never be cached; hashed assets carry their own immutable
 * headers via `_headers`.
 */
export const handle: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);

	response.headers.set('Cache-Control', 'no-store');
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('X-Frame-Options', 'DENY');
	response.headers.set('Referrer-Policy', 'no-referrer');
	response.headers.set(
		'Permissions-Policy',
		'camera=(self), microphone=(self), geolocation=(), payment=(), usb=()'
	);

	return response;
};
