import { test, expect } from '@playwright/test';
import {
	generateTestRoomId,
	joinRoom,
	sendMessage,
	waitForMessage,
	createRoom
} from './helpers/test-utils';

// Override touch detection for desktop tests - Chromium reports maxTouchPoints > 0 even on desktop
test.beforeEach(async ({ page }) => {
	await page.addInitScript(() => {
		Object.defineProperty(navigator, 'maxTouchPoints', { value: 0, writable: false });
		if ('ontouchstart' in window) {
			delete (window as any).ontouchstart;
		}
	});
});

// Helper to check if message actions are available (for edit/reaction persistence tests)
async function isActionsAvailable(page: import('@playwright/test').Page): Promise<boolean> {
	const message = page.locator('[data-testid="message-bubble"]').first();
	await message.hover();
	await page.waitForTimeout(200);
	const menuButton = message.getByRole('button', { name: 'Message options' }).first();
	try {
		await expect(menuButton).toBeVisible({ timeout: 2000 });
		return true;
	} catch {
		return false;
	}
}

// Helper to get the menu button for a message
function getMenuButton(message: import('@playwright/test').Locator) {
	return message.getByRole('button', { name: 'Message options' }).first();
}

test.describe('User Data Persistence', () => {
	test.describe.configure({ mode: 'serial' });

	test('should persist user ID after page reload', async ({ page }) => {
		const roomId = generateTestRoomId();
		await joinRoom(page, roomId);

		// Get the user ID from localStorage
		const userId = await page.evaluate(() => localStorage.getItem('mindline_userId'));
		expect(userId).toBeTruthy();

		// Reload the page
		await page.reload();
		await page.waitForTimeout(1000);

		// User ID should be the same
		const userIdAfterReload = await page.evaluate(() => localStorage.getItem('mindline_userId'));
		expect(userIdAfterReload).toBe(userId);
	});

	test('should persist user name after page reload', async ({ page }) => {
		const roomId = generateTestRoomId();
		await joinRoom(page, roomId);

		// Set a custom user name via the room menu
		await page.locator('[data-testid="room-menu-btn"]').click();
		const nameInput = page.getByPlaceholder('Your name');
		await nameInput.fill('TestUser123');
		await nameInput.press('Enter');

		// Wait for toast confirmation
		await expect(page.getByText('Name updated!')).toBeVisible({ timeout: 3000 });
		await page.keyboard.press('Escape');

		// Reload the page
		await page.reload();
		await page.waitForTimeout(1000);

		// Name should persist
		const nameAfterReload = await page.evaluate(() => localStorage.getItem('mindline_userName'));
		expect(nameAfterReload).toBe('TestUser123');

		// Also verify it's displayed in the input
		await page.locator('[data-testid="room-menu-btn"]').click();
		await expect(page.getByPlaceholder('Your name')).toHaveValue('TestUser123');
	});

	test('should persist theme preference after page reload', async ({ page }) => {
		const roomId = generateTestRoomId();
		await joinRoom(page, roomId);

		// Get initial theme state
		const isDarkBefore = await page.evaluate(() => document.documentElement.classList.contains('dark'));

		// Toggle theme via the room menu
		await page.locator('[data-testid="room-menu-btn"]').click();
		await page.getByRole('button', { name: /(light|dark) theme/i }).click();
		await page.keyboard.press('Escape');
		await page.waitForTimeout(500);

		// Verify theme changed
		const isDarkAfter = await page.evaluate(() => document.documentElement.classList.contains('dark'));
		expect(isDarkAfter).not.toBe(isDarkBefore);

		// Reload page
		await page.reload();
		await page.waitForTimeout(1000);

		// Theme should persist
		const isDarkAfterReload = await page.evaluate(() => document.documentElement.classList.contains('dark'));
		expect(isDarkAfterReload).toBe(isDarkAfter);
	});
});

test.describe('Message Persistence', () => {
	test.describe.configure({ mode: 'serial' });

	test('should persist messages after page reload', async ({ page }) => {
		const roomId = generateTestRoomId();
		await joinRoom(page, roomId);

		// Send some messages
		await sendMessage(page, 'First message');
		await waitForMessage(page, 'First message');

		await sendMessage(page, 'Second message');
		await waitForMessage(page, 'Second message');

		// Reload the page
		await page.reload();
		await joinRoom(page, roomId);

		// Messages should still be visible
		await expect(page.locator('[data-testid="message-list"]').getByText('First message')).toBeVisible({ timeout: 5000 });
		await expect(page.locator('[data-testid="message-list"]').getByText('Second message')).toBeVisible({ timeout: 5000 });
	});

	test('should persist message edits after page reload', async ({ page }) => {
		const roomId = generateTestRoomId();
		await joinRoom(page, roomId);

		await sendMessage(page, 'Original message');
		await waitForMessage(page, 'Original message');

		// Skip if actions not available (touch device)
		if (!(await isActionsAvailable(page))) { test.skip(); return; }

		// Edit the message
		const message = page.locator('[data-testid="message-bubble"]').first();
		await message.hover();
		await getMenuButton(message).click({ force: true });
		await page.getByRole('menuitem', { name: 'Edit' }).click();

		const editInput = page.getByLabel('Edit message content');
		await editInput.fill('Edited message');
		await editInput.press('Enter');

		await expect(message.getByText('Edited message')).toBeVisible();
		await expect(message.getByText('(edited)')).toBeVisible();

		// Reload the page
		await page.reload();
		await joinRoom(page, roomId);

		// Edited content should persist
		const reloadedMessage = page.locator('[data-testid="message-bubble"]').first();
		await expect(reloadedMessage.getByText('Edited message')).toBeVisible({ timeout: 5000 });
		await expect(reloadedMessage.getByText('(edited)')).toBeVisible();
	});

	test('should persist reactions after page reload', async ({ page }) => {
		const roomId = generateTestRoomId();
		await joinRoom(page, roomId);

		await sendMessage(page, 'React to this');
		await waitForMessage(page, 'React to this');

		// Check if emoji picker is available
		const message = page.locator('[data-testid="message-bubble"]').first();
		await message.hover();
		const emojiButton = message.getByLabel('Add reaction');

		try {
			await expect(emojiButton).toBeAttached({ timeout: 2000 });
		} catch {
			test.skip();
			return;
		}

		// Add a reaction
		await emojiButton.click({ force: true });
		await page.getByRole('option').filter({ hasText: '👍' }).click();
		await expect(message.getByText('👍')).toBeVisible();

		// Reload the page
		await page.reload();
		await joinRoom(page, roomId);

		// Reaction should persist
		const reloadedMessage = page.locator('[data-testid="message-bubble"]').first();
		await expect(reloadedMessage.getByText('👍')).toBeVisible({ timeout: 5000 });
	});

	test('should persist deletions after page reload', async ({ page }) => {
		const roomId = generateTestRoomId();
		await joinRoom(page, roomId);

		await sendMessage(page, 'Will be deleted');
		await waitForMessage(page, 'Will be deleted');

		// Skip if actions not available
		if (!(await isActionsAvailable(page))) { test.skip(); return; }

		// Delete the message
		const message = page.locator('[data-testid="message-bubble"]').first();
		await message.hover();
		await getMenuButton(message).click({ force: true });
		await page.getByRole('menuitem', { name: 'Delete' }).click();
		await page.getByRole('button', { name: 'Delete' }).click();

		await expect(message.getByText('[Message deleted]')).toBeVisible();

		// Reload the page
		await page.reload();
		await joinRoom(page, roomId);

		// Deletion should persist
		const reloadedMessage = page.locator('[data-testid="message-bubble"]').first();
		await expect(reloadedMessage.getByText('[Message deleted]')).toBeVisible({ timeout: 5000 });
	});
});

test.describe('Encryption Key Persistence', () => {
	test.describe.configure({ mode: 'serial' });

	test('should generate and save encryption key for new room', async ({ page }) => {
		const roomId = await createRoom(page);

		// Check that encryption key was saved to localStorage
		const keyExists = await page.evaluate((roomId) => {
			const key = localStorage.getItem(`mindline_encryption_key_${roomId}`);
			return key !== null && key.length > 0;
		}, roomId);

		expect(keyExists).toBe(true);
	});

	test('should load encryption key from storage on page reload', async ({ page }) => {
		const roomId = await createRoom(page);

		// Get the encryption key
		const originalKey = await page.evaluate((roomId) => {
			return localStorage.getItem(`mindline_encryption_key_${roomId}`);
		}, roomId);

		expect(originalKey).toBeTruthy();

		// Send a message (will be encrypted)
		await sendMessage(page, 'Encrypted message');
		await waitForMessage(page, 'Encrypted message');

		// Reload the page
		await page.reload();
		await joinRoom(page, roomId);

		// Key should still exist
		const keyAfterReload = await page.evaluate((roomId) => {
			return localStorage.getItem(`mindline_encryption_key_${roomId}`);
		}, roomId);

		expect(keyAfterReload).toBe(originalKey);
	});

	test('should decrypt messages after page refresh with stored key', async ({ page }) => {
		const roomId = await createRoom(page);

		// Send encrypted messages
		await sendMessage(page, 'Secret message one');
		await waitForMessage(page, 'Secret message one');

		await sendMessage(page, 'Secret message two');
		await waitForMessage(page, 'Secret message two');

		// Reload the page
		await page.reload();
		await joinRoom(page, roomId);

		// Messages should be decryptable and visible
		await expect(page.locator('[data-testid="message-list"]').getByText('Secret message one')).toBeVisible({ timeout: 5000 });
		await expect(page.locator('[data-testid="message-list"]').getByText('Secret message two')).toBeVisible({ timeout: 5000 });
	});

	test('should have different encryption keys per room', async ({ page, browser }) => {
		// Create first room
		const roomIdA = await createRoom(page);
		const keyA = await page.evaluate((roomId) => {
			return localStorage.getItem(`mindline_encryption_key_${roomId}`);
		}, roomIdA);

		// Create second room (navigate to landing and create new)
		await page.goto('/');
		await expect(page.locator('[data-testid="create-room-btn"]')).toBeEnabled({ timeout: 10000 });
		await page.locator('[data-testid="create-room-btn"]').click();
		await page.waitForURL(/\/[a-f0-9-]+#k=/);

		const roomIdB = page.url().split('/').pop() || '';
		const keyB = await page.evaluate((roomId) => {
			return localStorage.getItem(`mindline_encryption_key_${roomId}`);
		}, roomIdB);

		// Keys should be different
		expect(keyA).toBeTruthy();
		expect(keyB).toBeTruthy();
		expect(keyA).not.toBe(keyB);
	});

	test('should preserve messages across tab close and reopen simulation', async ({ page }) => {
		const roomId = await createRoom(page);

		// Send a message
		await sendMessage(page, 'Will survive tab close');
		await waitForMessage(page, 'Will survive tab close');

		// Get room ID and key info
		const savedRoomId = roomId;

		// Simulate closing tab by navigating away completely
		await page.goto('about:blank');
		await page.waitForTimeout(500);

		// Navigate back to the room
		await joinRoom(page, savedRoomId);

		// Message should still be there
		await expect(page.locator('[data-testid="message-list"]').getByText('Will survive tab close')).toBeVisible({ timeout: 5000 });
	});
});
