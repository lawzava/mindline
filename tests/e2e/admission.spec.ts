import { test, expect } from '@playwright/test';
import {
	cleanup,
	createRoom,
	createSecondContext,
	joinRoom,
	sendMessage,
	waitForMessage
} from './helpers/test-utils';

test.describe.configure({ mode: 'serial' });

test('a new room asks before letting people in, and a member can remove someone', async ({
	page,
	browser
}) => {
	const roomId = await createRoom(page);
	const contextB = await createSecondContext(browser);
	const pageB = await contextB.newPage();
	await joinRoom(pageB, roomId);

	// B holds the link but waits at the door; A decides.
	await expect(pageB.getByTestId('admission-waiting')).toBeVisible({ timeout: 30000 });
	const request = page.getByTestId('admission-request');
	await expect(request).toBeVisible({ timeout: 30000 });
	await sendMessage(page, 'before B was let in');
	// Nothing reaches a waiting device: no message, no draft, no key.
	await pageB.waitForTimeout(2500);
	await expect(pageB.getByText('before B was let in')).toHaveCount(0);
	await request.getByRole('button', { name: 'Let in' }).click();

	await expect(pageB.getByTestId('admission-waiting')).toBeHidden({ timeout: 15000 });
	await sendMessage(page, 'welcome in');
	await waitForMessage(pageB, 'welcome in', 20000);
	await sendMessage(pageB, 'thanks');
	await waitForMessage(page, 'thanks', 20000);

	// Removal: B is told, and nothing sent afterwards reaches B.
	await page.getByTestId('peer-count').click();
	await page.getByTestId('peer-list').getByRole('button', { name: 'Remove' }).click();
	await page.getByRole('button', { name: 'Remove from room' }).click();
	await expect(pageB.getByTestId('admission-removed')).toBeVisible({ timeout: 15000 });
	await sendMessage(page, 'after removal');
	await pageB.waitForTimeout(3000);
	await expect(pageB.getByText('after removal')).toHaveCount(0);

	await cleanup(contextB);
});

test('a member can turn someone away', async ({ page, browser }) => {
	const roomId = await createRoom(page);
	const contextC = await createSecondContext(browser);
	const pageC = await contextC.newPage();
	await joinRoom(pageC, roomId);

	const request = page.getByTestId('admission-request');
	await expect(request).toBeVisible({ timeout: 30000 });
	await request.getByRole('button', { name: 'Not now' }).click();
	await expect(pageC.getByTestId('admission-denied')).toBeVisible({ timeout: 15000 });
	await expect(request).toBeHidden();

	await cleanup(contextC);
});

test('turning approval off lets the next person straight in', async ({ page, browser }) => {
	const roomId = await createRoom(page);
	await page.getByTestId('room-menu-btn').click();
	const toggle = page.getByTestId('approval-toggle');
	await expect(toggle).toHaveAttribute('aria-pressed', 'true');
	await toggle.click();
	await expect(toggle).toHaveAttribute('aria-pressed', 'false');
	await page.keyboard.press('Escape');

	const contextD = await createSecondContext(browser);
	const pageD = await contextD.newPage();
	await joinRoom(pageD, roomId);
	await sendMessage(pageD, 'walked right in');
	await waitForMessage(page, 'walked right in', 30000);
	await expect(pageD.getByTestId('admission-waiting')).toHaveCount(0);

	await cleanup(contextD);
});
