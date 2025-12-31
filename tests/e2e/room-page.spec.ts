import { test, expect } from '@playwright/test';
import {
	generateTestRoomId,
	waitForConnectionStatus,
	createRoom,
	joinRoom,
	goToLandingPage
} from './helpers/test-utils';

test.describe('Room Page', () => {
	test.describe.configure({ mode: 'serial' });

	test('should load room page with room ID in URL', async ({ page }) => {
		const roomId = generateTestRoomId();
		await joinRoom(page, roomId);

		// Check URL contains the room ID
		expect(page.url()).toContain(roomId);

		// Room elements should be visible
		await expect(page.locator('[data-testid="copy-room-btn"]')).toBeVisible();
		await expect(page.locator('[data-testid="leave-room-btn"]')).toBeVisible();
		await expect(page.locator('[data-testid="message-input"]')).toBeVisible();
		await expect(page.locator('[data-testid="message-list"]')).toBeVisible();
	});

	test('should display truncated room ID', async ({ page }) => {
		const roomId = generateTestRoomId();
		await joinRoom(page, roomId);

		// Room ID should show truncated version
		const copyBtn = page.locator('[data-testid="copy-room-btn"]');
		const buttonText = await copyBtn.textContent();
		expect(buttonText).toContain('...');
		// Should show first 8 characters
		expect(buttonText).toContain(roomId.slice(0, 8));
	});

	test('should copy room ID to clipboard', async ({ page, context }) => {
		// Grant clipboard permissions
		await context.grantPermissions(['clipboard-read', 'clipboard-write']);

		const roomId = generateTestRoomId();
		await joinRoom(page, roomId);

		// Click copy button
		await page.locator('[data-testid="copy-room-btn"]').click();

		// Toast should appear
		await expect(page.getByText('Room ID copied!')).toBeVisible({ timeout: 3000 });

		// Verify clipboard contains room ID
		const clipboardContent = await page.evaluate(() => navigator.clipboard.readText());
		expect(clipboardContent).toBe(roomId);
	});

	test('should show leave room confirmation dialog', async ({ page }) => {
		const roomId = generateTestRoomId();
		await joinRoom(page, roomId);

		// Click leave button
		await page.locator('[data-testid="leave-room-btn"]').click();

		// Dialog should appear
		await expect(page.getByText('Leave Room?')).toBeVisible();
		await expect(
			page.getByText('Are you sure you want to leave this room?')
		).toBeVisible();

		// Cancel and Leave buttons should be visible
		await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Leave Room' })).toBeVisible();
	});

	test('should cancel leave room and stay in room', async ({ page }) => {
		const roomId = generateTestRoomId();
		await joinRoom(page, roomId);

		// Click leave button
		await page.locator('[data-testid="leave-room-btn"]').click();

		// Click Cancel
		await page.getByRole('button', { name: 'Cancel' }).click();

		// Dialog should close
		await expect(page.getByText('Leave Room?')).toBeHidden();

		// Should still be in the room
		expect(page.url()).toContain(roomId);
		await expect(page.locator('[data-testid="message-input"]')).toBeVisible();
	});

	test('should leave room and navigate to home', async ({ page }) => {
		const roomId = generateTestRoomId();
		await joinRoom(page, roomId);

		// Click leave button
		await page.locator('[data-testid="leave-room-btn"]').click();

		// Click Leave Room
		await page.getByRole('button', { name: 'Leave Room' }).click();

		// Should navigate to home page
		await page.waitForURL('/');
		await expect(page.getByText('Welcome to Mindline')).toBeVisible();
	});

	test('should show empty message state initially', async ({ page }) => {
		const roomId = generateTestRoomId();
		await joinRoom(page, roomId);

		// Empty state message should be visible
		await expect(page.getByText('No messages yet. Start the conversation!')).toBeVisible();
	});

	test('should focus message input on load', async ({ page }) => {
		const roomId = generateTestRoomId();
		await joinRoom(page, roomId);

		// Give time for focus to be set
		await page.waitForTimeout(500);

		// Message input should be focused
		const input = page.locator('[data-testid="message-input"]');
		await expect(input).toBeFocused();
	});

	test('should navigate between rooms', async ({ page }) => {
		// Create first room
		const roomId1 = await createRoom(page);

		// Navigate to home
		await goToLandingPage(page);

		// Create second room
		const roomId2 = await createRoom(page);

		// Verify different room IDs
		expect(roomId1).not.toBe(roomId2);
		expect(page.url()).toContain(roomId2);
	});
});
