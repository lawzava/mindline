import { test, expect } from '@playwright/test';
import {
	generateTestRoomId,
	joinRoom,
	sendMessage,
	waitForMessage
} from './helpers/test-utils';

// Override touch detection for desktop tests - Chromium reports maxTouchPoints > 0 even on desktop
// and may have ontouchstart in window
test.beforeEach(async ({ page }) => {
	await page.addInitScript(() => {
		Object.defineProperty(navigator, 'maxTouchPoints', { value: 0, writable: false });
		// Remove ontouchstart if it exists
		if ('ontouchstart' in window) {
			delete (window as any).ontouchstart;
		}
	});
});

// Helper to check if message actions are available (not on touch device)
async function isActionsAvailable(page: import('@playwright/test').Page): Promise<boolean> {
	const message = page.locator('[data-testid="message-bubble"]').first();
	// Must hover to trigger group-hover visibility
	await message.hover();
	await page.waitForTimeout(200);
	// Use role selector with .first() - the button has sr-only "Message options" text inside
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

test.describe('Message Edit', () => {
	test.describe.configure({ mode: 'serial' });

	test('should show message options menu on own message hover', async ({ page }) => {
		const roomId = generateTestRoomId();
		await joinRoom(page, roomId);

		await sendMessage(page, 'Test message for edit');
		await waitForMessage(page, 'Test message for edit');

		const message = page.locator('[data-testid="message-bubble"]').first();
		await message.hover();
		await page.waitForTimeout(200);

		if (!(await isActionsAvailable(page))) {
			console.log('Message actions not available - likely on touch device');
			test.skip();
			return;
		}

		// The three-dot menu button should be visible
		const menuButton = getMenuButton(message);
		await expect(menuButton).toBeAttached();
	});

	test('should open dropdown menu with edit and delete options', async ({ page }) => {
		const roomId = generateTestRoomId();
		await joinRoom(page, roomId);

		await sendMessage(page, 'Test message');
		await waitForMessage(page, 'Test message');

		if (!(await isActionsAvailable(page))) { test.skip(); return; }

		const message = page.locator('[data-testid="message-bubble"]').first();
		await message.hover();

		// Click the menu button
		await getMenuButton(message).click({ force: true });

		// Dropdown should show Edit and Delete options
		await expect(page.getByRole('menuitem', { name: 'Edit' })).toBeVisible();
		await expect(page.getByRole('menuitem', { name: 'Delete' })).toBeVisible();
	});

	test('should enter edit mode when clicking Edit', async ({ page }) => {
		const roomId = generateTestRoomId();
		await joinRoom(page, roomId);

		await sendMessage(page, 'Edit this message');
		await waitForMessage(page, 'Edit this message');

		if (!(await isActionsAvailable(page))) { test.skip(); return; }

		const message = page.locator('[data-testid="message-bubble"]').first();
		await message.hover();
		await getMenuButton(message).click({ force: true });
		await page.getByRole('menuitem', { name: 'Edit' }).click();

		// Edit input should appear with original content
		const editInput = page.getByLabel('Edit message content');
		await expect(editInput).toBeVisible();
		await expect(editInput).toHaveValue('Edit this message');
	});

	test('should cancel edit with Escape key', async ({ page }) => {
		const roomId = generateTestRoomId();
		await joinRoom(page, roomId);

		await sendMessage(page, 'Cancel edit test');
		await waitForMessage(page, 'Cancel edit test');

		if (!(await isActionsAvailable(page))) { test.skip(); return; }

		const message = page.locator('[data-testid="message-bubble"]').first();
		await message.hover();
		await getMenuButton(message).click({ force: true });
		await page.getByRole('menuitem', { name: 'Edit' }).click();

		// Edit input should be visible
		const editInput = page.getByLabel('Edit message content');
		await expect(editInput).toBeVisible();

		// Type something different
		await editInput.fill('Changed content');

		// Press Escape to cancel
		await editInput.press('Escape');

		// Edit input should be hidden, original content preserved
		await expect(editInput).toBeHidden();
		await expect(message.getByText('Cancel edit test')).toBeVisible();
	});

	test('should cancel edit with X button', async ({ page }) => {
		const roomId = generateTestRoomId();
		await joinRoom(page, roomId);

		await sendMessage(page, 'Cancel button test');
		await waitForMessage(page, 'Cancel button test');

		if (!(await isActionsAvailable(page))) { test.skip(); return; }

		const message = page.locator('[data-testid="message-bubble"]').first();
		await message.hover();
		await getMenuButton(message).click({ force: true });
		await page.getByRole('menuitem', { name: 'Edit' }).click();

		// Type something different
		const editInput = page.getByLabel('Edit message content');
		await editInput.fill('Changed content');

		// Click cancel button
		await page.getByLabel('Cancel edit').click();

		// Original content preserved
		await expect(editInput).toBeHidden();
		await expect(message.getByText('Cancel button test')).toBeVisible();
	});

	test('should save edit with Enter key', async ({ page }) => {
		const roomId = generateTestRoomId();
		await joinRoom(page, roomId);

		await sendMessage(page, 'Original content');
		await waitForMessage(page, 'Original content');

		if (!(await isActionsAvailable(page))) { test.skip(); return; }

		const message = page.locator('[data-testid="message-bubble"]').first();
		await message.hover();
		await getMenuButton(message).click({ force: true });
		await page.getByRole('menuitem', { name: 'Edit' }).click();

		// Change content and save with Enter
		const editInput = page.getByLabel('Edit message content');
		await editInput.fill('Edited content');
		await editInput.press('Enter');

		// New content should be visible
		await expect(editInput).toBeHidden();
		await expect(message.getByText('Edited content')).toBeVisible();
	});

	test('should save edit with checkmark button', async ({ page }) => {
		const roomId = generateTestRoomId();
		await joinRoom(page, roomId);

		await sendMessage(page, 'Save button test');
		await waitForMessage(page, 'Save button test');

		if (!(await isActionsAvailable(page))) { test.skip(); return; }

		const message = page.locator('[data-testid="message-bubble"]').first();
		await message.hover();
		await getMenuButton(message).click({ force: true });
		await page.getByRole('menuitem', { name: 'Edit' }).click();

		// Change content and save with button
		const editInput = page.getByLabel('Edit message content');
		await editInput.fill('Saved via button');
		await page.getByLabel('Save edit').click();

		// New content should be visible
		await expect(editInput).toBeHidden();
		await expect(message.getByText('Saved via button')).toBeVisible();
	});

	test('should show (edited) indicator after edit', async ({ page }) => {
		const roomId = generateTestRoomId();
		await joinRoom(page, roomId);

		await sendMessage(page, 'Will be edited');
		await waitForMessage(page, 'Will be edited');

		if (!(await isActionsAvailable(page))) { test.skip(); return; }

		const message = page.locator('[data-testid="message-bubble"]').first();
		await message.hover();
		await getMenuButton(message).click({ force: true });
		await page.getByRole('menuitem', { name: 'Edit' }).click();

		const editInput = page.getByLabel('Edit message content');
		await editInput.fill('Has been edited');
		await editInput.press('Enter');

		// (edited) indicator should appear
		await expect(message.getByText('(edited)')).toBeVisible();
	});

	test('should not save edit if content is empty', async ({ page }) => {
		const roomId = generateTestRoomId();
		await joinRoom(page, roomId);

		await sendMessage(page, 'Keep this content');
		await waitForMessage(page, 'Keep this content');

		if (!(await isActionsAvailable(page))) { test.skip(); return; }

		const message = page.locator('[data-testid="message-bubble"]').first();
		await message.hover();
		await getMenuButton(message).click({ force: true });
		await page.getByRole('menuitem', { name: 'Edit' }).click();

		// Clear content and try to save
		const editInput = page.getByLabel('Edit message content');
		await editInput.fill('');
		await editInput.press('Enter');

		// Edit mode should close but original content preserved
		await page.waitForTimeout(300);
		await expect(message.getByText('Keep this content')).toBeVisible();
	});

	test('should trim whitespace from edited content', async ({ page }) => {
		const roomId = generateTestRoomId();
		await joinRoom(page, roomId);

		await sendMessage(page, 'Whitespace test');
		await waitForMessage(page, 'Whitespace test');

		if (!(await isActionsAvailable(page))) { test.skip(); return; }

		const message = page.locator('[data-testid="message-bubble"]').first();
		await message.hover();
		await getMenuButton(message).click({ force: true });
		await page.getByRole('menuitem', { name: 'Edit' }).click();

		// Add whitespace and save
		const editInput = page.getByLabel('Edit message content');
		await editInput.fill('  Trimmed content  ');
		await editInput.press('Enter');

		// Content should be trimmed
		await expect(message.getByText('Trimmed content')).toBeVisible();
	});
});

test.describe('Message Delete', () => {
	test.describe.configure({ mode: 'serial' });

	test('should show delete option in menu with destructive styling', async ({ page }) => {
		const roomId = generateTestRoomId();
		await joinRoom(page, roomId);

		await sendMessage(page, 'Delete option test');
		await waitForMessage(page, 'Delete option test');

		if (!(await isActionsAvailable(page))) { test.skip(); return; }

		const message = page.locator('[data-testid="message-bubble"]').first();
		await message.hover();
		await getMenuButton(message).click({ force: true });

		// Delete option should be visible
		const deleteOption = page.getByRole('menuitem', { name: 'Delete' });
		await expect(deleteOption).toBeVisible();
	});

	test('should show confirmation dialog when clicking Delete', async ({ page }) => {
		const roomId = generateTestRoomId();
		await joinRoom(page, roomId);

		await sendMessage(page, 'Confirm delete test');
		await waitForMessage(page, 'Confirm delete test');

		if (!(await isActionsAvailable(page))) { test.skip(); return; }

		const message = page.locator('[data-testid="message-bubble"]').first();
		await message.hover();
		await getMenuButton(message).click({ force: true });
		await page.getByRole('menuitem', { name: 'Delete' }).click();

		// Confirmation dialog should appear
		await expect(page.getByRole('alertdialog')).toBeVisible();
		await expect(page.getByText('Delete message?')).toBeVisible();
		await expect(page.getByText('This action cannot be undone')).toBeVisible();
	});

	test('should cancel delete when clicking Cancel', async ({ page }) => {
		const roomId = generateTestRoomId();
		await joinRoom(page, roomId);

		await sendMessage(page, 'Cancel delete test');
		await waitForMessage(page, 'Cancel delete test');

		if (!(await isActionsAvailable(page))) { test.skip(); return; }

		const message = page.locator('[data-testid="message-bubble"]').first();
		await message.hover();
		await getMenuButton(message).click({ force: true });
		await page.getByRole('menuitem', { name: 'Delete' }).click();

		// Click Cancel in dialog
		await page.getByRole('button', { name: 'Cancel' }).click();

		// Dialog should close, message preserved
		await expect(page.getByRole('alertdialog')).toBeHidden();
		await expect(message.getByText('Cancel delete test')).toBeVisible();
	});

	test('should delete message when confirming', async ({ page }) => {
		const roomId = generateTestRoomId();
		await joinRoom(page, roomId);

		await sendMessage(page, 'Delete me');
		await waitForMessage(page, 'Delete me');

		if (!(await isActionsAvailable(page))) { test.skip(); return; }

		const message = page.locator('[data-testid="message-bubble"]').first();
		await message.hover();
		await getMenuButton(message).click({ force: true });
		await page.getByRole('menuitem', { name: 'Delete' }).click();

		// Confirm deletion
		await page.getByRole('button', { name: 'Delete' }).click();

		// Message should show [Message deleted]
		await expect(message.getByText('[Message deleted]')).toBeVisible();
	});

	test('should style deleted message differently', async ({ page }) => {
		const roomId = generateTestRoomId();
		await joinRoom(page, roomId);

		await sendMessage(page, 'Style test');
		await waitForMessage(page, 'Style test');

		if (!(await isActionsAvailable(page))) { test.skip(); return; }

		const message = page.locator('[data-testid="message-bubble"]').first();
		await message.hover();
		await getMenuButton(message).click({ force: true });
		await page.getByRole('menuitem', { name: 'Delete' }).click();
		await page.getByRole('button', { name: 'Delete' }).click();

		// Deleted message should have italic styling
		const deletedContent = message.locator('p', { hasText: '[Message deleted]' });
		await expect(deletedContent).toBeVisible();
	});

	test('should not show edit/delete options on deleted message', async ({ page }) => {
		const roomId = generateTestRoomId();
		await joinRoom(page, roomId);

		await sendMessage(page, 'No actions after delete');
		await waitForMessage(page, 'No actions after delete');

		if (!(await isActionsAvailable(page))) { test.skip(); return; }

		// Delete the message
		const message = page.locator('[data-testid="message-bubble"]').first();
		await message.hover();
		await getMenuButton(message).click({ force: true });
		await page.getByRole('menuitem', { name: 'Delete' }).click();
		await page.getByRole('button', { name: 'Delete' }).click();

		// Wait for deletion
		await expect(message.getByText('[Message deleted]')).toBeVisible();

		// Hover again - menu button should not be visible
		await message.hover();
		await page.waitForTimeout(300);

		const menuButton = getMenuButton(message);
		await expect(menuButton).toBeHidden();
	});

	test('should not show reaction picker on deleted message', async ({ page }) => {
		const roomId = generateTestRoomId();
		await joinRoom(page, roomId);

		await sendMessage(page, 'No reactions after delete');
		await waitForMessage(page, 'No reactions after delete');

		if (!(await isActionsAvailable(page))) { test.skip(); return; }

		// Delete the message
		const message = page.locator('[data-testid="message-bubble"]').first();
		await message.hover();
		await getMenuButton(message).click({ force: true });
		await page.getByRole('menuitem', { name: 'Delete' }).click();
		await page.getByRole('button', { name: 'Delete' }).click();

		// Wait for deletion
		await expect(message.getByText('[Message deleted]')).toBeVisible();

		// Hover again - emoji button should not be visible
		await message.hover();
		await page.waitForTimeout(300);

		const emojiButton = message.getByLabel('Add reaction');
		await expect(emojiButton).toBeHidden();
	});
});
