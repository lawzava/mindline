import { test, expect } from '@playwright/test';
import { generateTestRoomId, joinRoom, sendMessage, waitForMessage } from './helpers/test-utils';

test.describe('Required Persistence', () => {
	test.describe.configure({ mode: 'serial' });

	test('persists user name across reload', async ({ page }) => {
		const roomId = generateTestRoomId('required-persist-name');
		await joinRoom(page, roomId);

		await page.locator('[data-testid="room-menu-btn"]').click();
		const nameInput = page.getByPlaceholder('Your name');
		await nameInput.fill('RequiredName');
		await nameInput.press('Enter');
		await page.keyboard.press('Escape');
		await page.reload();

		await page.locator('[data-testid="room-menu-btn"]').click();
		await expect(page.getByPlaceholder('Your name')).toHaveValue('RequiredName', {
			timeout: 10000
		});
	});

	test('persists messages across reload', async ({ page }) => {
		const roomId = generateTestRoomId('required-persist-msg');
		await joinRoom(page, roomId);

		await sendMessage(page, 'required-persisted-message');
		await waitForMessage(page, 'required-persisted-message');

		await page.reload();
		await expect(
			page.locator('[data-testid="message-list"]').getByText('required-persisted-message')
		).toBeVisible({ timeout: 10000 });
	});
});
