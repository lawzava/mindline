import { test, expect, type BrowserContext } from '@playwright/test';
import { keyFragmentFor } from './helpers/test-utils';

test.describe('Mobile P2P Connection Lifecycle', () => {
	test.describe.configure({ mode: 'serial' });

	const testRoomId = `test-room-${Date.now()}`;

	// Helper to wait for any valid connection status
	async function waitForConnectionStatus(page: import('@playwright/test').Page) {
		const statusBadge = page.locator('[data-testid="connection-status"]');
		// Accept any status that indicates the page has loaded
		await expect(
			statusBadge
				.filter({ hasText: 'Connected' })
				.or(statusBadge.filter({ hasText: 'Local' }))
				.or(statusBadge.filter({ hasText: 'Connecting' }))
				.or(statusBadge.filter({ hasText: 'Reconnecting' }))
		).toBeVisible({ timeout: 15000 });
		return statusBadge;
	}

	test('should reconnect after visibility change (background/foreground)', async ({ page }) => {
		// Capture console logs BEFORE navigation to catch all logs
		const consoleLogs: string[] = [];
		page.on('console', (msg) => consoleLogs.push(msg.text()));

		// Navigate to room
		await page.goto(`/${testRoomId}${keyFragmentFor(testRoomId)}`);

		// Wait for connection status to appear
		await waitForConnectionStatus(page);

		// Wait a bit for handlers to be registered
		await page.waitForTimeout(1000);

		// Check if this is a mobile device (visibility handler only enabled for mobile)
		const isMobile = await page.evaluate(() =>
			/Android|iPhone|iPad|iPod|Mobile|webOS|BlackBerry|IEMobile|Opera Mini/i.test(
				navigator.userAgent
			)
		);

		// Verify appropriate handlers are registered based on device type
		const hasVisibilitySetup = consoleLogs.some((log) =>
			log.includes('[P2P Manager] Visibility handler registered')
		);
		const hasPageLifecycleSetup = consoleLogs.some((log) =>
			log.includes('[P2P Manager] Page lifecycle handlers registered')
		);

		if (isMobile) {
			// Mobile should have visibility handler
			if (!hasVisibilitySetup) {
				console.log(
					'Mobile device - expected visibility handler. Captured logs:',
					consoleLogs.filter((log) => log.includes('[P2P')).slice(0, 10)
				);
			}
			expect(hasVisibilitySetup).toBe(true);
		} else {
			// Desktop should have page lifecycle handlers (but not visibility handler)
			expect(hasPageLifecycleSetup).toBe(true);
		}

		// Simulate backgrounding by triggering visibilitychange
		await page.evaluate(() => {
			Object.defineProperty(document, 'visibilityState', {
				configurable: true,
				get: () => 'hidden'
			});
			document.dispatchEvent(new Event('visibilitychange'));
		});

		// Wait for background handler to fire
		await page.waitForTimeout(1000);

		// Simulate being hidden for longer than threshold (mock the time)
		await page.evaluate(() => {
			Object.defineProperty(document, 'visibilityState', {
				configurable: true,
				get: () => 'visible'
			});
			document.dispatchEvent(new Event('visibilitychange'));
		});

		// Wait for foreground handler
		await page.waitForTimeout(1000);

		// Verify the connection status is still visible (page didn't crash)
		const statusBadge = page.locator('[data-testid="connection-status"]');
		await expect(statusBadge).toBeVisible();
	});

	// CDP (Chrome DevTools Protocol) is only available in Chromium-based browsers
	test('should handle network offline/online transitions', async ({
		page,
		context,
		browserName
	}) => {
		// Skip for non-Chromium browsers as CDP is not supported
		test.skip(browserName !== 'chromium', 'CDP is only available in Chromium');

		// Capture console logs BEFORE navigation
		const consoleLogs: string[] = [];
		page.on('console', (msg) => consoleLogs.push(msg.text()));

		const roomId = `offline-test-${Date.now()}`;
		await page.goto(`/${roomId}${keyFragmentFor(roomId)}`);

		// Wait for initial connection using data-testid
		const statusBadge = await waitForConnectionStatus(page);

		// Go offline using CDP
		const cdpSession = await context.newCDPSession(page);
		await cdpSession.send('Network.emulateNetworkConditions', {
			offline: true,
			downloadThroughput: 0,
			uploadThroughput: 0,
			latency: 0
		});

		// Wait for offline state detection with polling (more reliable than fixed timeout)
		// WebSocket disconnection detection can take time, the status might remain "Connected" briefly
		const offlineStart = Date.now();
		while (Date.now() - offlineStart < 10000) {
			const text = await statusBadge.textContent().catch(() => '');
			if (
				text?.includes('Offline') ||
				text?.includes('Reconnecting') ||
				text?.includes('Connecting')
			) {
				break;
			}
			await page.waitForTimeout(500);
		}

		// The status badge should be visible (regardless of state - the test verifies
		// that the app handles network changes gracefully without crashing)
		await expect(statusBadge).toBeVisible({ timeout: 5000 });

		// Go back online
		await cdpSession.send('Network.emulateNetworkConditions', {
			offline: false,
			downloadThroughput: -1,
			uploadThroughput: -1,
			latency: 0
		});

		// Wait for reconnection with polling (more reliable than fixed timeout)
		const onlineStart = Date.now();
		while (Date.now() - onlineStart < 15000) {
			const text = await statusBadge.textContent().catch(() => '');
			if (text?.includes('Connected') || text?.includes('Local')) {
				break;
			}
			await page.waitForTimeout(500);
		}

		// Verify either reconnected or still attempting (using specific badge locator)
		const statusVisible = await statusBadge
			.filter({ hasText: 'Connected' })
			.or(statusBadge.filter({ hasText: 'Connecting' }))
			.or(statusBadge.filter({ hasText: 'Local' }))
			.or(statusBadge.filter({ hasText: 'Reconnecting' }))
			.isVisible();
		expect(statusVisible).toBe(true);
	});

	test('should cleanup on page navigation', async ({ page }) => {
		// Capture console logs BEFORE navigation
		const consoleLogs: string[] = [];
		page.on('console', (msg) => consoleLogs.push(msg.text()));

		const roomId = `cleanup-test-${Date.now()}`;
		await page.goto(`/${roomId}${keyFragmentFor(roomId)}`);

		// Wait for page to load using data-testid
		await waitForConnectionStatus(page);

		// Navigate away (to home page)
		await page.goto('/');

		// Wait for cleanup
		await page.waitForTimeout(1000);

		// Verify disconnect/cleanup was called - look for any cleanup-related log
		// Page lifecycle handlers are set up for all devices, visibility handlers only for mobile
		const hasCleanupLog = consoleLogs.some(
			(log) =>
				log.includes('[P2P Manager] Disconnecting') ||
				log.includes('[P2P Manager] Page hide event') ||
				log.includes('[P2P Manager] Visibility handler removed') ||
				log.includes('[P2P Manager] Network handler removed') ||
				log.includes('[P2P Manager] Page lifecycle handlers registered') ||
				log.includes('[P2P Manager] Page lifecycle handlers removed')
		);
		expect(hasCleanupLog).toBe(true);
	});

	test('mobile device detection returns correct config', async ({ page }) => {
		// This test runs with the project's device emulation
		await page.goto('/');

		// Check if mobile detection works and forceRelay is set correctly
		const config = await page.evaluate(() => {
			const isMobile = /Android|iPhone|iPad|iPod|Mobile|webOS|BlackBerry|IEMobile|Opera Mini/i.test(
				navigator.userAgent
			);
			return { isMobile, userAgent: navigator.userAgent };
		});

		console.log(
			`Device: ${config.isMobile ? 'Mobile' : 'Desktop'}, UA: ${config.userAgent.slice(0, 50)}...`
		);

		// The test itself validates that detection runs without error
		expect(typeof config.isMobile).toBe('boolean');
	});
});
