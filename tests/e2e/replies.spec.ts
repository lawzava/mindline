import { test, expect } from '@playwright/test';
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

test('a reply quotes the message it answers on both sides and jumps to it', async ({
	page,
	browser
}) => {
	const roomId = generateTestRoomId('replies');
	const contextB = await createSecondContext(browser);
	const pageB = await contextB.newPage();
	await joinRoom(page, roomId);
	await joinRoom(pageB, roomId);
	if (!(await waitForPeersConnected(page, pageB))) {
		await cleanup(contextB);
		handleUnavailableP2P('Replies test failed: peers never connected');
	}

	await sendMessage(page, 'what time works for you?');
	for (let i = 0; i < 25; i++) await sendMessage(page, `filler ${i}`);
	await waitForMessage(pageB, 'filler 24');

	const original = pageB
		.getByTestId('message-bubble')
		.filter({ hasText: 'what time works for you?' });
	await original.hover();
	await original.getByRole('button', { name: 'Reply' }).click();
	const quoteBar = pageB.getByTestId('reply-preview');
	await expect(quoteBar).toContainText('what time works for you?');
	await pageB.getByTestId('message-input').fill('3pm is good');
	await pageB.getByTestId('message-input').press('Enter');
	await expect(quoteBar).toBeHidden();

	await waitForMessage(page, '3pm is good');
	const reply = page.getByTestId('message-bubble').filter({ hasText: '3pm is good' });
	const quote = reply.getByTestId('reply-quote');
	await expect(quote).toContainText('what time works for you?');

	await quote.click();
	// The original's own body text (the quote repeats it in a <span>).
	await expect(
		page
			.getByTestId('message-list')
			.locator('p')
			.getByText('what time works for you?', { exact: true })
	).toBeInViewport();

	await cleanup(contextB);
});

test('Escape cancels a reply before sending', async ({ page }) => {
	await joinRoom(page, generateTestRoomId('reply-cancel'));
	await sendMessage(page, 'first');
	const bubble = page.getByTestId('message-bubble').filter({ hasText: 'first' });
	await bubble.hover();
	await bubble.getByRole('button', { name: 'Reply' }).click();
	await expect(page.getByTestId('reply-preview')).toBeVisible();
	await page.getByTestId('message-input').press('Escape');
	await expect(page.getByTestId('reply-preview')).toBeHidden();
});
