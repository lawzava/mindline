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

async function setTimer(page: Page, label: string) {
	await page.getByTestId('room-menu-btn').click();
	await page.getByTestId('timer-select').selectOption({ label });
	await page.keyboard.press('Escape');
}

const bubble = (page: Page, text: string) =>
	page.getByTestId('message-bubble').filter({ hasText: text });

test('a timer set by one person makes later messages disappear for both, at rest too', async ({
	page,
	browser
}) => {
	const roomId = generateTestRoomId('disappearing');
	const contextB = await createSecondContext(browser);
	const pageB = await contextB.newPage();
	// A controllable clock that still flows on its own, so the connection works.
	await page.clock.install();
	await pageB.clock.install();
	await joinRoom(page, roomId);
	await joinRoom(pageB, roomId);
	if (!(await waitForPeersConnected(page, pageB))) {
		await cleanup(contextB);
		handleUnavailableP2P('Disappearing test failed: peers never connected');
	}

	await sendMessage(page, 'said before the timer');
	await waitForMessage(pageB, 'said before the timer');

	await setTimer(page, '5 minutes');
	for (const p of [page, pageB]) {
		await expect(p.getByTestId('timer-event').last()).toContainText(
			'set messages to disappear after 5 minutes'
		);
		await expect(p.getByTestId('timer-badge')).toContainText('5 minutes');
	}

	await sendMessage(pageB, 'this line will vanish');
	await waitForMessage(page, 'this line will vanish');

	await page.clock.fastForward('05:30');
	await pageB.clock.fastForward('05:30');
	for (const p of [page, pageB]) {
		await expect(bubble(p, 'this line will vanish')).toHaveCount(0);
		await expect(bubble(p, 'said before the timer')).toHaveCount(1);
		// The setting itself stays, so the room keeps its timer.
		await expect(p.getByTestId('timer-badge')).toContainText('5 minutes');
	}

	// Gone from storage, not just from the screen.
	await page.reload();
	await waitForMessage(page, 'said before the timer');
	await expect(bubble(page, 'this line will vanish')).toHaveCount(0);

	await setTimer(pageB, 'Off');
	await expect(page.getByTestId('timer-event').last()).toContainText(
		'turned off disappearing messages'
	);
	await expect(page.getByTestId('timer-badge')).toHaveCount(0);

	await cleanup(contextB);
});

test('a long timer keeps counting while the room sits open and quiet', async ({ page }) => {
	await page.clock.install();
	await joinRoom(page, generateTestRoomId('disappearing-long'));
	await setTimer(page, '1 day');
	await sendMessage(page, 'gone by tomorrow');
	await expect(bubble(page, 'gone by tomorrow')).toHaveCount(1);
	// Nothing else happens in the room; the view must still wake up on time.
	for (let hour = 0; hour < 25; hour++) await page.clock.fastForward('01:00:00');
	await expect(bubble(page, 'gone by tomorrow')).toHaveCount(0);
});
