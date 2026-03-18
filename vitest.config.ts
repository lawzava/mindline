import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'path';

export default defineConfig({
  plugins: [svelte({ hot: !process.env.VITEST })],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
    exclude: ['tests/e2e/**/*'],
    alias: {
      '$app/environment': path.resolve(__dirname, './tests/mocks/app-environment.ts')
    },
    coverage: {
      provider: 'v8',
      include: ['src/lib/p2p/handlers.ts']
    }
  },
  resolve: {
    alias: {
      '$lib': path.resolve(__dirname, './src/lib')
    }
  }
});
