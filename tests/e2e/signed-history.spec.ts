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

test('history relayed by another member keeps the author signature', async ({ page, browser }) => {
	const roomId = generateTestRoomId('signed-history');
	await joinRoom(page, roomId);

	const contextB = await createSecondContext(browser);
	const pageB = await contextB.newPage();
	await joinRoom(pageB, roomId);
	if (!(await waitForPeersConnected(page, pageB))) {
		await cleanup(contextB);
		handleUnavailableP2P('Signed history test failed: A and B never connected');
	}
	await sendMessage(page, 'said by A, relayed by B');
	await waitForMessage(pageB, 'said by A, relayed by B');
	// Let B store A's signature (verified after the message lands).
	await pageB.waitForTimeout(500);

	// A leaves; C can only get A's words through B's history.
	await page.close();
	const contextC = await createSecondContext(browser);
	const pageC = await contextC.newPage();
	await joinRoom(pageC, roomId);
	if (!(await waitForPeersConnected(pageB, pageC))) {
		await cleanup(contextB);
		await cleanup(contextC);
		handleUnavailableP2P('Signed history test failed: B and C never connected');
	}
	await waitForMessage(pageC, 'said by A, relayed by B', 20000);
	await expect(pageC.getByTestId('unverified-copy')).toHaveCount(0);

	await cleanup(contextB);
	await cleanup(contextC);
});
