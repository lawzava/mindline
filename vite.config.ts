import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	optimizeDeps: {
		exclude: ['@anthropic-ai/claude-wasm']
	},
	build: {
		target: 'esnext'
	},
	server: {
		fs: {
			// Allow serving files from pkg directory
			allow: ['..', 'pkg']
		}
	}
});
