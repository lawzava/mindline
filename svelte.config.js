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
		// Strict CSP with hashed inline hydration scripts. The room key lives
		// in the URL fragment, so no third-party script may ever run
		// (PROTOCOL.md §6). Fonts/styles are self-hosted; style attributes
		// (progress widths) need unsafe-inline for styles only.
		csp: {
			mode: 'hash',
			directives: {
				'default-src': ['self'],
				'script-src': ['self'],
				'style-src': ['self', 'unsafe-inline'],
				'font-src': ['self'],
				'img-src': ['self', 'data:', 'blob:'],
				'media-src': ['self', 'blob:'],
				'connect-src': ['self', 'wss:', 'ws:'],
				'object-src': ['none'],
				'base-uri': ['self'],
				'form-action': ['self'],
				'frame-ancestors': ['none']
			}
		}
	}
};

export default config;
