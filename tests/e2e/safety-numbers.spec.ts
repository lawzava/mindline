import { test, expect, type Page } from '@playwright/test';
import {
	cleanup,
	createSecondContext,
	generateTestRoomId,
	handleUnavailableP2P,
	joinRoom,
	sendMessage,
	waitForMessage,
	waitForPeersConnected
} from './helpers/test-utils';

async function openSafetyNumber(page: Page): Promise<string> {
	await page.getByTestId('peer-count').click();
	await page
		.getByTestId('peer-list')
		.getByRole('button', { name: /Verify/ })
		.first()
		.click();
	const number = page.getByTestId('safety-number');
	await expect(number).toHaveText(/^(\d{5}\s*){12}$/);
	return (await number.textContent())!.replace(/\s+/g, ' ').trim();
}

test('both people see the same safety number, and verification survives a reload', async ({
	page,
	browser
}) => {
	const roomId = generateTestRoomId('safety');
	const contextB = await createSecondContext(browser);
	const pageB = await contextB.newPage();
	await joinRoom(page, roomId);
	await joinRoom(pageB, roomId);
	if (!(await waitForPeersConnected(page, pageB))) {
		await cleanup(contextB);
		handleUnavailableP2P('Safety number test failed: peers never connected');
	}

	const fromA = await openSafetyNumber(page);
	const fromB = await openSafetyNumber(pageB);
	expect(fromA).toBe(fromB);

	// Closing the dialog hands the keyboard back to the conversation.
	await pageB.getByRole('button', { name: 'Close' }).click();
	await sendMessage(pageB, 'sent right after comparing');
	await waitForMessage(page, 'sent right after comparing');

	await page.getByRole('button', { name: 'Mark as verified' }).click();
	await page.getByTestId('peer-count').click();
	await expect(page.getByTestId('peer-list').getByTestId('verify-status')).toHaveText('Verified');

	await page.reload();
	expect(await waitForPeersConnected(page, pageB)).toBe(true);
	await page.getByTestId('peer-count').click();
	await expect(page.getByTestId('peer-list').getByTestId('verify-status')).toHaveText('Verified', {
		timeout: 10000
	});
	await cleanup(contextB);
});
