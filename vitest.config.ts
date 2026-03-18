import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
  plugins: [sveltekit()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
    globals: true,
  },
  resolve: {
    conditions: ['browser']
  }
});
