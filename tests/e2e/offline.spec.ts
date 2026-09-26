import { test, expect } from '@playwright/test';
import { generateTestRoomId, joinRoom, sendMessage } from './helpers/test-utils';

test('a visited room page still opens with no connection', async ({ page, context }) => {
	const roomId = generateTestRoomId('offline');
	await joinRoom(page, roomId);
	await sendMessage(page, 'kept for offline');
	// The worker takes over from the next load and keeps that page.
	await page.evaluate(async () => {
		await navigator.serviceWorker.ready;
	});
	await page.reload();
	await expect(page.getByTestId('message-input')).toBeVisible();

	await context.setOffline(true);
	try {
		const response = await page.goto(`/${roomId}`);
		expect(response?.fromServiceWorker()).toBe(true);
		expect(response?.status()).toBe(200);
	} finally {
		await context.setOffline(false);
	}
});
