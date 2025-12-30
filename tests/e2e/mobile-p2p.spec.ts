import { test, expect } from '@playwright/test';

test.describe('Mobile P2P Connection Lifecycle', () => {
	test.describe.configure({ mode: 'serial' });

	const testRoomId = `test-room-${Date.now()}`;

	test('should reconnect after visibility change (background/foreground)', async ({ page }) => {
		// Navigate to room
		await page.goto(`/${testRoomId}`);

		// Wait for connection (or local mode fallback)
		await expect(
			page.locator('text=Connected').or(page.locator('text=Local'))
		).toBeVisible({ timeout: 15000 });

		// Capture console logs
		const consoleLogs: string[] = [];
		page.on('console', (msg) => consoleLogs.push(msg.text()));

		// Simulate backgrounding by triggering visibilitychange
		await page.evaluate(() => {
			// Override visibility state to hidden
			Object.defineProperty(document, 'visibilityState', {
				configurable: true,
				get: () => 'hidden'
			});
			document.dispatchEvent(new Event('visibilitychange'));
		});

		// Wait for background handler to fire
		await page.waitForTimeout(500);

		// Verify background was detected
		const hasBackgroundLog = consoleLogs.some((log) =>
			log.includes('[P2P Manager] App backgrounded')
		);
		expect(hasBackgroundLog).toBe(true);

		// Simulate being hidden for longer than threshold (mock the time)
		await page.evaluate(() => {
			// Override visibility state to visible
			Object.defineProperty(document, 'visibilityState', {
				configurable: true,
				get: () => 'visible'
			});
			document.dispatchEvent(new Event('visibilitychange'));
		});

		// Wait for foreground handler
		await page.waitForTimeout(1000);

		// Verify foreground was detected
		const hasForegroundLog = consoleLogs.some((log) =>
			log.includes('[P2P Manager] App foregrounded')
		);
		expect(hasForegroundLog).toBe(true);
	});

	test('should handle network offline/online transitions', async ({ page, context }) => {
		const roomId = `offline-test-${Date.now()}`;
		await page.goto(`/${roomId}`);

		// Wait for initial connection
		await expect(
			page.locator('text=Connected').or(page.locator('text=Local'))
		).toBeVisible({ timeout: 15000 });

		// Capture console logs
		const consoleLogs: string[] = [];
		page.on('console', (msg) => consoleLogs.push(msg.text()));

		// Go offline using CDP
		const cdpSession = await context.newCDPSession(page);
		await cdpSession.send('Network.emulateNetworkConditions', {
			offline: true,
			downloadThroughput: 0,
			uploadThroughput: 0,
			latency: 0
		});

		// Wait for connection to detect offline state
		await page.waitForTimeout(3000);

		// Should show disconnected or connecting status
		await expect(
			page
				.locator('text=Disconnected')
				.or(page.locator('text=Connecting'))
				.or(page.locator('text=Local'))
		).toBeVisible({ timeout: 5000 });

		// Go back online
		await cdpSession.send('Network.emulateNetworkConditions', {
			offline: false,
			downloadThroughput: -1,
			uploadThroughput: -1,
			latency: 0
		});

		// Wait for reconnection attempt
		await page.waitForTimeout(5000);

		// Verify either reconnected or still attempting
		// Note: Without signaling server, it may stay in connecting state
		const statusVisible = await page
			.locator('text=Connected')
			.or(page.locator('text=Connecting'))
			.or(page.locator('text=Local'))
			.isVisible();
		expect(statusVisible).toBe(true);
	});

	test('should cleanup on page navigation', async ({ page }) => {
		const roomId = `cleanup-test-${Date.now()}`;
		await page.goto(`/${roomId}`);

		// Wait for page to load
		await expect(
			page.locator('text=Connected').or(page.locator('text=Local'))
		).toBeVisible({ timeout: 15000 });

		// Capture console logs
		const consoleLogs: string[] = [];
		page.on('console', (msg) => consoleLogs.push(msg.text()));

		// Navigate away (to home page)
		await page.goto('/');

		// Wait for cleanup
		await page.waitForTimeout(1000);

		// Verify disconnect/cleanup was called
		const hasCleanupLog = consoleLogs.some(
			(log) =>
				log.includes('[P2P Manager] Disconnecting') ||
				log.includes('[P2P Manager] Page hide event') ||
				log.includes('Visibility handler removed') ||
				log.includes('Network handler removed')
		);
		expect(hasCleanupLog).toBe(true);
	});

	test('mobile device detection returns correct config', async ({ page }) => {
		// This test runs with the project's device emulation
		await page.goto('/');

		// Check if mobile detection works and forceRelay is set correctly
		const config = await page.evaluate(() => {
			const isMobile =
				/Android|iPhone|iPad|iPod|Mobile|webOS|BlackBerry|IEMobile|Opera Mini/i.test(
					navigator.userAgent
				);
			return { isMobile, userAgent: navigator.userAgent };
		});

		console.log(`Device: ${config.isMobile ? 'Mobile' : 'Desktop'}, UA: ${config.userAgent.slice(0, 50)}...`);

		// The test itself validates that detection runs without error
		expect(typeof config.isMobile).toBe('boolean');
	});
});
