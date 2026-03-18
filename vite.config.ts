import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';

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
	},
	test: {
		environment: 'jsdom',
		include: ['src/**/*.test.ts', 'src/**/*.spec.ts']
	}
});
