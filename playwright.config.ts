import { defineConfig, devices } from '@playwright/test';

const appBaseUrl = process.env.APP_BASE_URL || 'http://localhost:5173';
const useLocalWebServer = !process.env.APP_BASE_URL;

export default defineConfig({
	testDir: './tests/e2e',
	timeout: 60000, // Increased for P2P connection tests
	expect: { timeout: 10000 },
	fullyParallel: false, // P2P tests need sequential execution
	retries: 1,
	workers: 1,
	reporter: 'html',
	use: {
		baseURL: appBaseUrl,
		trace: 'on-first-retry',
		video: 'on-first-retry'
	},
	projects: [
		{
			name: 'Desktop Chrome',
			use: { ...devices['Desktop Chrome'] }
		},
		{
			name: 'Mobile Safari',
			use: { ...devices['iPhone 13'] }
		},
		{
			name: 'Mobile Chrome',
			use: { ...devices['Pixel 5'] }
		}
	],
	webServer: useLocalWebServer
		? {
				command: 'pnpm dev',
				port: 5173,
				reuseExistingServer: !process.env.CI
			}
		: undefined
});
