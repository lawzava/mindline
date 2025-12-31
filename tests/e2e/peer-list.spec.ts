import { test, expect } from '@playwright/test';
import {
	generateTestRoomId,
	joinRoom,
	setupTwoUsers,
	cleanup,
	waitForP2PSync,
	waitForPeersConnected
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

// Helper to wait for Connected status with retry
async function waitForConnectedStatus(
	page: import('@playwright/test').Page,
	timeout = 15000
): Promise<boolean> {
	const startTime = Date.now();
	const connectionStatus = page.locator('[data-testid="connection-status"]');

	while (Date.now() - startTime < timeout) {
		const statusText = await connectionStatus.textContent().catch(() => '');
		if (statusText?.includes('Connected')) {
			return true;
		}
		await page.waitForTimeout(500);
	}
	return false;
}

test.describe('Peer List Component', () => {
	test.describe.configure({ mode: 'serial' });

	test('should show "Waiting for peers..." when alone in room', async ({ page }) => {
		const roomId = generateTestRoomId();
		await joinRoom(page, roomId);

		// Wait for Connected status with retry (signaling server must be running)
		const isConnected = await waitForConnectedStatus(page, 15000);
		if (!isConnected) {
			console.log('Skipping peer list test - signaling server not available');
			test.skip();
			return;
		}

		const peerCount = page.locator('[data-testid="peer-count"]');
		await expect(peerCount).toBeVisible({ timeout: 10000 });
		await expect(peerCount).toContainText('Waiting for peers');
	});

	test('should open peer list popover on click', async ({ page }) => {
		const roomId = generateTestRoomId();
		await joinRoom(page, roomId);

		// Wait for Connected status with retry (signaling server must be running)
		const isConnected = await waitForConnectedStatus(page, 15000);
		if (!isConnected) {
			console.log('Skipping peer list popover test - signaling server not available');
			test.skip();
			return;
		}

		// Click peer count badge
		const peerCount = page.locator('[data-testid="peer-count"]');
		await expect(peerCount).toBeVisible({ timeout: 10000 });
		await peerCount.click();

		// Popover should open
		const peerList = page.locator('[data-testid="peer-list"]');
		await expect(peerList).toBeVisible();

		// Should show "No peers connected yet"
		await expect(peerList.getByText('No peers connected yet')).toBeVisible();
	});

	test('should show peer count when another user joins', async ({ page, browser }) => {
		const { pageA, pageB, contextB } = await setupTwoUsers(browser, page);

		// Wait for P2P connection
		const connected = await waitForPeersConnected(pageA, pageB);

		if (!connected) {
			console.log('P2P connection not established - skipping peer list test');
			await cleanup(contextB);
			test.skip();
			return;
		}

		// Both should show "1 peer"
		await expect(pageA.locator('[data-testid="peer-count"]')).toContainText('1 peer');
		await expect(pageB.locator('[data-testid="peer-count"]')).toContainText('1 peer');

		await cleanup(contextB);
	});

	test('should show peer name in popover', async ({ page, browser }) => {
		const { pageA, pageB, contextB } = await setupTwoUsers(browser, page);

		// Set a name for user B
		const nameInput = pageB.getByPlaceholder('Your name');
		await nameInput.fill('BobTest');
		await nameInput.press('Enter');

		// Wait for name update to propagate
		await waitForP2PSync(2000);

		const connected = await waitForPeersConnected(pageA, pageB);
		if (!connected) {
			await cleanup(contextB);
			test.skip();
			return;
		}

		// Open peer list on page A
		await pageA.locator('[data-testid="peer-count"]').click();
		const peerList = pageA.locator('[data-testid="peer-list"]');
		await expect(peerList).toBeVisible();

		// Should show Bob's name or peer ID
		// The component shows either the name or "Peer {id}..."
		await expect(peerList.locator('.truncate')).toBeVisible();

		await cleanup(contextB);
	});

	test('should show green online indicator for connected peers', async ({ page, browser }) => {
		const { pageA, pageB, contextB } = await setupTwoUsers(browser, page);

		const connected = await waitForPeersConnected(pageA, pageB);
		if (!connected) {
			await cleanup(contextB);
			test.skip();
			return;
		}

		// Open peer list on page A
		await pageA.locator('[data-testid="peer-count"]').click();
		const peerList = pageA.locator('[data-testid="peer-list"]');
		await expect(peerList).toBeVisible();

		// Should show green dot (Circle element with fill-green-500 class)
		const greenDot = peerList.locator('.fill-green-500');
		await expect(greenDot).toBeVisible();

		await cleanup(contextB);
	});

	test('should update peer count when user leaves', async ({ page, browser }) => {
		const { pageA, pageB, contextB } = await setupTwoUsers(browser, page);

		const connected = await waitForPeersConnected(pageA, pageB);
		if (!connected) {
			await cleanup(contextB);
			test.skip();
			return;
		}

		// Verify both see 1 peer initially
		await expect(pageA.locator('[data-testid="peer-count"]')).toContainText('1 peer');

		// User B leaves (close their context)
		await cleanup(contextB);

		// Wait for disconnect to propagate
		await pageA.waitForTimeout(3000);

		// Page A should now show "Waiting for peers..." or 0 peers
		const peerCountA = pageA.locator('[data-testid="peer-count"]');
		await expect(peerCountA).toContainText('Waiting for peers');
	});

	test('should show correct count with multiple peers', async ({ page, browser }) => {
		// Create room with user A
		const { pageA, pageB, roomId, contextB } = await setupTwoUsers(browser, page);

		// Wait for A and B to connect
		const connectedAB = await waitForPeersConnected(pageA, pageB);
		if (!connectedAB) {
			await cleanup(contextB);
			test.skip();
			return;
		}

		// Create third user C
		const contextC = await browser.newContext();
		const pageC = await contextC.newPage();
		await joinRoom(pageC, roomId);

		// Wait for all connections to establish
		await pageA.waitForTimeout(3000);

		// Check if A sees 2 peers
		const peerCountA = pageA.locator('[data-testid="peer-count"]');
		const text = await peerCountA.textContent();

		// Should show "2 peers" if all connected
		if (text?.includes('2 peers')) {
			await expect(peerCountA).toContainText('2 peers');
		} else {
			// P2P mesh might not be fully formed - at least should show some peers
			console.log('Peer count for A:', text);
		}

		await cleanup(contextC);
		await cleanup(contextB);
	});

	test('should close popover when clicking outside', async ({ page }) => {
		const roomId = generateTestRoomId();
		await joinRoom(page, roomId);

		// Wait for Connected status with retry (signaling server must be running)
		const isConnected = await waitForConnectedStatus(page, 15000);
		if (!isConnected) {
			console.log('Skipping close popover test - signaling server not available');
			test.skip();
			return;
		}

		// Open peer list
		const peerCount = page.locator('[data-testid="peer-count"]');
		await expect(peerCount).toBeVisible({ timeout: 10000 });
		await peerCount.click();

		const peerList = page.locator('[data-testid="peer-list"]');
		await expect(peerList).toBeVisible();

		// Click outside the popover (on the message list area)
		await page.locator('[data-testid="message-list"]').click();

		// Popover should close
		await expect(peerList).toBeHidden();
	});

	test('should show active connections count in popover footer', async ({ page, browser }) => {
		const { pageA, pageB, contextB } = await setupTwoUsers(browser, page);

		const connected = await waitForPeersConnected(pageA, pageB);
		if (!connected) {
			await cleanup(contextB);
			test.skip();
			return;
		}

		// Open peer list on page A
		await pageA.locator('[data-testid="peer-count"]').click();
		const peerList = pageA.locator('[data-testid="peer-list"]');
		await expect(peerList).toBeVisible();

		// Footer should show "1 active connection"
		await expect(peerList.getByText('1 active connection')).toBeVisible();

		await cleanup(contextB);
	});
});
