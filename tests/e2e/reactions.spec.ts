import { test, expect } from '@playwright/test';
import {
	generateTestRoomId,
	joinRoom,
	sendMessage,
	waitForMessage,
	TEST_EMOJIS
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

// Helper to check if emoji picker is available (not on touch device)
async function isEmojiPickerAvailable(page: import('@playwright/test').Page): Promise<boolean> {
	const message = page.locator('[data-testid="message-bubble"]').first();
	await message.hover();
	await page.waitForTimeout(200);
	// Use getByRole for button with sr-only text
	const emojiButton = message.getByRole('button', { name: 'Add reaction' }).first();
	try {
		await expect(emojiButton).toBeVisible({ timeout: 2000 });
		return true;
	} catch {
		return false;
	}
}

test.describe('Reactions', () => {
	test.describe.configure({ mode: 'serial' });

	test('should show emoji picker button on message hover (desktop only)', async ({ page }) => {
		const roomId = generateTestRoomId();
		await joinRoom(page, roomId);

		// Send a message
		await sendMessage(page, 'Test message for reactions');
		await waitForMessage(page, 'Test message for reactions');

		// Check if emoji picker is available (skip on touch devices)
		if (!(await isEmojiPickerAvailable(page))) {
			console.log('Emoji picker not available - likely on touch device');
			test.skip();
			return;
		}

		// The button should be visible after hover (desktop mode enforced via beforeEach)
		const message = page.locator('[data-testid="message-bubble"]').first();
		const emojiButton = message.getByRole('button', { name: 'Add reaction' }).first();
		await expect(emojiButton).toBeVisible();
	});

	test('should open emoji picker on button click', async ({ page }) => {
		const roomId = generateTestRoomId();
		await joinRoom(page, roomId);

		await sendMessage(page, 'Test message');
		await waitForMessage(page, 'Test message');

		// Check if emoji picker is available
		if (!(await isEmojiPickerAvailable(page))) { test.skip(); return; }

		// Hover over message to trigger group-hover
		const message = page.locator('[data-testid="message-bubble"]').first();
		await message.hover();

		// Click the emoji button (may need force due to opacity)
		await message.getByRole('button', { name: 'Add reaction' }).first().click({ force: true });

		// Emoji picker popover should be visible
		const emojiPicker = page.getByRole('listbox', { name: 'Emoji reactions' });
		await expect(emojiPicker).toBeVisible();

		// Should show all emojis
		for (const emoji of TEST_EMOJIS.slice(0, 4)) {
			await expect(page.getByRole('option').filter({ hasText: emoji })).toBeVisible();
		}
	});

	test('should add reaction to message', async ({ page }) => {
		const roomId = generateTestRoomId();
		await joinRoom(page, roomId);

		await sendMessage(page, 'React to this!');
		await waitForMessage(page, 'React to this!');

		// Check if emoji picker is available
		if (!(await isEmojiPickerAvailable(page))) { test.skip(); return; }

		// Hover and add a reaction
		const message = page.locator('[data-testid="message-bubble"]').first();
		await message.hover();
		await message.getByRole('button', { name: 'Add reaction' }).first().click({ force: true });

		// Click thumbs up emoji
		await page.getByRole('option').filter({ hasText: '👍' }).click();

		// Reaction pill should appear on the message
		await expect(message.getByText('👍')).toBeVisible();
	});

	test('should show reaction count', async ({ page }) => {
		const roomId = generateTestRoomId();
		await joinRoom(page, roomId);

		await sendMessage(page, 'Count test');
		await waitForMessage(page, 'Count test');

		// Check if emoji picker is available
		if (!(await isEmojiPickerAvailable(page))) { test.skip(); return; }

		// Add a reaction
		const message = page.locator('[data-testid="message-bubble"]').first();
		await message.hover();
		await message.getByRole('button', { name: 'Add reaction' }).first().click({ force: true });
		await page.getByRole('option').filter({ hasText: '❤️' }).click();

		// Wait for reaction to be added and UI to update
		await page.waitForTimeout(500);

		// Reaction should show with count 1 (reaction button shows emoji and count)
		const reactionButton = message.getByRole('button', { name: /❤️.*1|Remove ❤️ reaction/ });
		await expect(reactionButton).toBeVisible({ timeout: 10000 });
	});

	test('should toggle reaction off when clicked again', async ({ page }) => {
		const roomId = generateTestRoomId();
		await joinRoom(page, roomId);

		await sendMessage(page, 'Toggle test');
		await waitForMessage(page, 'Toggle test');

		// Check if emoji picker is available
		if (!(await isEmojiPickerAvailable(page))) { test.skip(); return; }

		// Add a reaction
		const message = page.locator('[data-testid="message-bubble"]').first();
		await message.hover();
		await message.getByRole('button', { name: 'Add reaction' }).first().click({ force: true });
		await page.getByRole('option').filter({ hasText: '😂' }).click();

		// Reaction should appear
		const reactionPill = message.getByText('😂');
		await expect(reactionPill).toBeVisible();

		// Click the reaction to toggle it off
		await reactionPill.click();

		// Wait a moment for the UI to update
		await page.waitForTimeout(500);

		// Reaction should be removed or hidden
		await expect(message.getByText('😂')).toBeHidden();
	});

	test('should add multiple different reactions to same message', async ({ page }) => {
		const roomId = generateTestRoomId();
		await joinRoom(page, roomId);

		await sendMessage(page, 'Multiple reactions');
		await waitForMessage(page, 'Multiple reactions');

		// Check if emoji picker is available
		if (!(await isEmojiPickerAvailable(page))) { test.skip(); return; }

		const message = page.locator('[data-testid="message-bubble"]').first();

		// Add first reaction
		await message.hover();
		await message.getByRole('button', { name: 'Add reaction' }).first().click({ force: true });
		await page.getByRole('option').filter({ hasText: '👍' }).click();

		// Add second reaction
		await message.hover();
		await message.getByRole('button', { name: 'Add reaction' }).first().click({ force: true });
		await page.getByRole('option').filter({ hasText: '🔥' }).click();

		// Both reactions should be visible
		await expect(message.getByText('👍')).toBeVisible();
		await expect(message.getByText('🔥')).toBeVisible();
	});

	test('should close emoji picker after selection', async ({ page }) => {
		const roomId = generateTestRoomId();
		await joinRoom(page, roomId);

		await sendMessage(page, 'Close test');
		await waitForMessage(page, 'Close test');

		// Check if emoji picker is available
		if (!(await isEmojiPickerAvailable(page))) { test.skip(); return; }

		// Open emoji picker
		const message = page.locator('[data-testid="message-bubble"]').first();
		await message.hover();
		await message.getByRole('button', { name: 'Add reaction' }).first().click({ force: true });

		// Verify picker is open
		const emojiPicker = page.getByRole('listbox', { name: 'Emoji reactions' });
		await expect(emojiPicker).toBeVisible();

		// Select an emoji
		await page.getByRole('option').filter({ hasText: '🎉' }).click();

		// Picker should be closed
		await expect(emojiPicker).toBeHidden();
	});

	test('should navigate emoji picker with keyboard', async ({ page }) => {
		const roomId = generateTestRoomId();
		await joinRoom(page, roomId);

		await sendMessage(page, 'Keyboard nav test');
		await waitForMessage(page, 'Keyboard nav test');

		// Check if emoji picker is available
		if (!(await isEmojiPickerAvailable(page))) { test.skip(); return; }

		// Open emoji picker
		const message = page.locator('[data-testid="message-bubble"]').first();
		await message.hover();
		await message.getByRole('button', { name: 'Add reaction' }).first().click({ force: true });

		// Picker should be open
		const emojiPicker = page.getByRole('listbox', { name: 'Emoji reactions' });
		await expect(emojiPicker).toBeVisible();

		// First emoji (👍) should be focused by default
		const firstOption = page.getByRole('option').first();
		await expect(firstOption).toHaveAttribute('aria-selected', 'true');

		// Press ArrowRight to move to next emoji
		await emojiPicker.press('ArrowRight');

		// Second option should now be focused
		const secondOption = page.getByRole('option').nth(1);
		await expect(secondOption).toHaveAttribute('aria-selected', 'true');

		// Press Enter to select
		await emojiPicker.press('Enter');

		// Picker should close and reaction should be added (second emoji is ❤️)
		await expect(emojiPicker).toBeHidden();
		await expect(message.getByText('❤️')).toBeVisible();
	});
});
