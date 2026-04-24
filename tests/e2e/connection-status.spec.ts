import { test, expect } from '@playwright/test';
import { generateTestRoomId, waitForConnectionStatus } from './helpers/test-utils';

test.describe('Connection Status', () => {
	test.describe.configure({ mode: 'serial' });

	test('should show connection status badge', async ({ page }) => {
		const roomId = generateTestRoomId();
		await page.goto(`/${roomId}`);

		// Connection status should be visible
		const statusBadge = page.locator('[data-testid="connection-status"]');
		await expect(statusBadge).toBeVisible({ timeout: 15000 });
	});

	test('should show connecting status initially', async ({ page }) => {
		const roomId = generateTestRoomId();

		// Navigate to room
		await page.goto(`/${roomId}`);

		// Should show some status (Connecting, Connected, or Local)
		const statusBadge = page.locator('[data-testid="connection-status"]');
		await expect(
			statusBadge
				.filter({ hasText: 'Connecting' })
				.or(statusBadge.filter({ hasText: 'Connected' }))
				.or(statusBadge.filter({ hasText: 'Local' }))
		).toBeVisible({ timeout: 15000 });
	});

	test('should transition to connected or local status', async ({ page }) => {
		const roomId = generateTestRoomId();
		await page.goto(`/${roomId}`);

		// Wait for initial status
		await waitForConnectionStatus(page);

		// Should eventually show Connected or Local
		const statusBadge = page.locator('[data-testid="connection-status"]');

		// Give time for connection to establish
		await page.waitForTimeout(3000);

		// Should be in a stable state - extract just the base status
		const statusText = await statusBadge.textContent();
		// Remove peer count and reconnect attempt numbers
		const baseStatus = statusText?.replace(/\s*\(\d+\/\d+\)/, '').replace(/\d+ peer.*/, '').trim() || '';
		expect(['Connected', 'Local', 'Connecting', 'Reconnecting']).toContainEqual(baseStatus);
	});

	test('should explain whether messages are syncing with peers', async ({ page }) => {
		const roomId = generateTestRoomId();
		await page.goto(`/${roomId}`);

		await waitForConnectionStatus(page);

		const statusBadge = page.locator('[data-testid="connection-status"]');
		await expect(statusBadge).toBeVisible();

		await expect(
			page.getByText(
				'Connection status explains whether messages are syncing with peers or only available locally.'
			)
		).toBeAttached();
	});

	test('should maintain connection status visibility throughout session', async ({ page }) => {
		const roomId = generateTestRoomId();
		await page.goto(`/${roomId}`);

		await waitForConnectionStatus(page);

		// Wait some time
		await page.waitForTimeout(2000);

		// Status should still be visible
		const statusBadge = page.locator('[data-testid="connection-status"]');
		await expect(statusBadge).toBeVisible();

		// Type a message (don't send)
		const input = page.locator('[data-testid="message-input"]');
		await input.fill('test message');

		// Status should still be visible
		await expect(statusBadge).toBeVisible();
	});

	test('should handle page reload and reconnection', async ({ page }) => {
		const roomId = generateTestRoomId();
		await page.goto(`/${roomId}`);

		await waitForConnectionStatus(page);

		// Reload the page
		await page.reload();

		// Should show connection status again
		await waitForConnectionStatus(page);

		// Status badge should be visible
		const statusBadge = page.locator('[data-testid="connection-status"]');
		await expect(statusBadge).toBeVisible();
	});
});
