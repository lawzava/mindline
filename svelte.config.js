import adapter from '@sveltejs/adapter-cloudflare';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

// CSP connect-src is pinned to the signaling origin at build time. The
// host comes from VITE_SIGNALING_SERVER (a host, or a full ws(s):// origin)
// and defaults to the canonical deploy. Self-hosted deploys set it and
// rebuild — a runtime MINDLINE_ENV.SIGNALING_SERVER override to a
// different host is now blocked by CSP by design (it was an open
// any-host WebSocket exfil channel for any script that ran).
const signalingEnv = process.env.VITE_SIGNALING_SERVER || 'signal.mindline.chat';
const signalingOrigin = signalingEnv.includes('://') ? signalingEnv : `wss://${signalingEnv}`;

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
							// the pinned hash is mode-watcher's SSR'd setInitialMode
							// anti-flash script (kit only hashes its own inlines).
							// If a mode-watcher upgrade changes it, the browser
							// console reports the new hash to pin.
							'script-src': ['self', 'sha256-uQ+6xeJ5jfvD5SmN5W7ZFR4dF9DbDwscZWrWOLfV+RM='],
							'style-src': ['self', 'unsafe-inline'],
							'font-src': ['self'],
							'img-src': ['self', 'data:', 'blob:'],
							'media-src': ['self', 'blob:'],
							// Pinned to self + the build-time signaling origin
							// (above). No scheme-wide ws: — that allowed any script
							// to open a WebSocket to any host (exfil). Self-hosters
							// rebuild with VITE_SIGNALING_SERVER.
							'connect-src': ['self', signalingOrigin],
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
