import { test, expect } from '@playwright/test';
import {
	generateTestRoomId,
	joinRoom,
	sendMessage,
	waitForMessage,
	waitForP2PSync,
	createSecondContext,
	cleanup,
	waitForPeersConnected,
	handleUnavailableP2P
} from './helpers/test-utils';

test.describe('Required P2P', () => {
	test.describe.configure({ mode: 'serial' });

	test('two peers exchange messages over room session', async ({ page, browser }) => {
		const roomId = generateTestRoomId('required-p2p');
		await joinRoom(page, roomId);

		const contextB = await createSecondContext(browser);
		const pageB = await contextB.newPage();
		await joinRoom(pageB, roomId);

		const connected = await waitForPeersConnected(page, pageB);
		if (!connected) {
			await cleanup(contextB);
			handleUnavailableP2P('Required P2P test failed: peers never connected');
		}

		await sendMessage(page, 'message-from-a');
		await waitForMessage(page, 'message-from-a');
		await expect(
			pageB.locator('[data-testid="message-list"]').getByText('message-from-a')
		).toBeVisible({
			timeout: 10000
		});

		await sendMessage(pageB, 'message-from-b');
		await waitForMessage(pageB, 'message-from-b');
		await expect(
			page.locator('[data-testid="message-list"]').getByText('message-from-b')
		).toBeVisible({
			timeout: 10000
		});

		await cleanup(contextB);
	});

	test('rejoining peer receives missed messages', async ({ page, browser }) => {
		const roomId = generateTestRoomId('required-resync');
		await joinRoom(page, roomId);

		const contextB = await createSecondContext(browser);
		const pageB = await contextB.newPage();
		await joinRoom(pageB, roomId);

		const connected = await waitForPeersConnected(page, pageB);
		if (!connected) {
			await cleanup(contextB);
			handleUnavailableP2P('Required sync test failed: initial peers never connected');
		}

		await sendMessage(page, 'before-disconnect');
		await waitForMessage(page, 'before-disconnect');
		await waitForP2PSync(1000);
		await cleanup(contextB);

		await sendMessage(page, 'while-peer-away');
		await waitForMessage(page, 'while-peer-away');

		const contextB2 = await createSecondContext(browser);
		const pageB2 = await contextB2.newPage();
		await joinRoom(pageB2, roomId);
		const reconnected = await waitForPeersConnected(page, pageB2);
		if (!reconnected) {
			await cleanup(contextB2);
			handleUnavailableP2P('Required sync test failed: reconnecting peer never connected');
		}

		await waitForP2PSync(3000);
		const listB2 = pageB2.locator('[data-testid="message-list"]');
		await expect(listB2.getByText('before-disconnect')).toBeVisible({ timeout: 10000 });
		await expect(listB2.getByText('while-peer-away')).toBeVisible({ timeout: 10000 });

		await cleanup(contextB2);
	});
});
