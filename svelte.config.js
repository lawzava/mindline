import adapter from '@sveltejs/adapter-cloudflare';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),

	kit: {
		adapter: adapter({
			// See https://svelte.dev/docs/kit/adapter-cloudflare for options
			routes: {
				include: ['/*'],
				exclude: ['<all>']
			}
		}),
		// Strict CSP with hashed inline hydration scripts, production builds
		// only: in dev, Vite injects inline scripts kit cannot hash, which
		// intermittently kills hydration. The room key lives in the URL
		// fragment, so no third-party script may ever run (PROTOCOL.md §6).
		// Style attributes (progress widths) need unsafe-inline for styles.
		csp:
			process.env.NODE_ENV === 'production'
				? {
						mode: 'hash',
						directives: {
							'default-src': ['self'],
							'script-src': ['self'],
							'style-src': ['self', 'unsafe-inline'],
							'font-src': ['self'],
							'img-src': ['self', 'data:', 'blob:'],
							'media-src': ['self', 'blob:'],
							// scheme-wide ws allowance is deliberate: the signaling
							// host is runtime-configurable per deploy (MINDLINE_ENV),
							// so a concrete origin cannot be pinned at build time
							'connect-src': ['self', 'wss:', 'ws:'],
							'object-src': ['none'],
							'base-uri': ['self'],
							'form-action': ['self'],
							'frame-ancestors': ['none']
						}
					}
				: undefined
	}
};

export default config;
