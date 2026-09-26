import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	build: {
		target: 'esnext'
	},
	server: {
		// The in-browser code check shares scripts/bundle-digest-lib.mjs with
		// the command-line verifier; SvelteKit's dev server allows src/ only.
		fs: { allow: ['scripts'] }
	}
});
