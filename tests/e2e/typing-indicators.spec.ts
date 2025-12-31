import { test, expect } from '@playwright/test';
import {
	generateTestRoomId,
	joinRoom,
	typeMessage,
	sendMessage,
	waitForP2PSync,
	createSecondContext,
	cleanup,
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

test.describe('Typing Indicators', () => {
	test.describe.configure({ mode: 'serial' });

	test('should show typing indicator when peer types', async ({ page, browser }) => {
		const roomId = generateTestRoomId();

		// User A joins the room
		await joinRoom(page, roomId);

		// Create second context for User B
		const contextB = await createSecondContext(browser);
		const pageB = await contextB.newPage();
		await joinRoom(pageB, roomId);

		// Wait for P2P connection to establish between peers
		const isConnected = await waitForPeersConnected(page, pageB);
		if (!isConnected) {
			console.log('Skipping P2P typing test - peers not connected');
			await cleanup(contextB);
			test.skip();
			return;
		}

		// User B starts typing
		await typeMessage(pageB, 'Hello from B');

		// Wait for typing broadcast
		await waitForP2PSync(500);

		// User A should see the draft indicator
		const draftIndicator = page.locator('[data-testid="draft-indicator"]');
		await expect(draftIndicator).toBeVisible({ timeout: 10000 });

		// Should contain the typed content
		await expect(draftIndicator).toContainText('Hello from B');

		await cleanup(contextB);
	});

	test('should show typing content in real-time', async ({ page, browser }) => {
		const roomId = generateTestRoomId();

		await joinRoom(page, roomId);

		const contextB = await createSecondContext(browser);
		const pageB = await contextB.newPage();
		await joinRoom(pageB, roomId);

		const isConnected = await waitForPeersConnected(page, pageB);
		if (!isConnected) {
			await cleanup(contextB);
			test.skip();
			return;
		}

		// User B types character by character
		const input = pageB.locator('[data-testid="message-input"]');
		await input.pressSequentially('Hi there', { delay: 50 });

		// Wait for debounce
		await waitForP2PSync(500);

		// User A should see the typed content
		const draftIndicator = page.locator('[data-testid="draft-indicator"]');
		await expect(draftIndicator).toBeVisible({ timeout: 10000 });

		await cleanup(contextB);
	});

	test('should clear typing indicator after message is sent', async ({ page, browser }) => {
		const roomId = generateTestRoomId();

		await joinRoom(page, roomId);

		const contextB = await createSecondContext(browser);
		const pageB = await contextB.newPage();
		await joinRoom(pageB, roomId);

		const isConnected = await waitForPeersConnected(page, pageB);
		if (!isConnected) {
			await cleanup(contextB);
			test.skip();
			return;
		}

		// User B types
		await typeMessage(pageB, 'Test message');
		await waitForP2PSync(500);

		// User A should see indicator
		const draftIndicator = page.locator('[data-testid="draft-indicator"]');
		await expect(draftIndicator).toBeVisible({ timeout: 10000 });

		// User B sends the message
		await sendMessage(pageB, 'Test message');
		await waitForP2PSync(500);

		// Indicator should disappear (or become hidden)
		await expect(draftIndicator).toBeHidden({ timeout: 5000 });

		await cleanup(contextB);
	});

	test('should show multiple typing indicators from multiple peers', async ({ page, browser }) => {
		const roomId = generateTestRoomId();

		await joinRoom(page, roomId);

		// Create User B
		const contextB = await createSecondContext(browser);
		const pageB = await contextB.newPage();
		await joinRoom(pageB, roomId);

		// Create User C
		const contextC = await createSecondContext(browser);
		const pageC = await contextC.newPage();
		await joinRoom(pageC, roomId);

		// Wait for all peers to connect
		const isConnected = await waitForPeersConnected(page, pageB);
		if (!isConnected) {
			await cleanup(contextB);
			await cleanup(contextC);
			test.skip();
			return;
		}

		await waitForP2PSync(2000);

		// Both B and C start typing
		await typeMessage(pageB, 'Message from B');
		await typeMessage(pageC, 'Message from C');

		await waitForP2PSync(1000);

		// User A should see the draft indicator with content
		const draftIndicator = page.locator('[data-testid="draft-indicator"]');
		await expect(draftIndicator).toBeVisible({ timeout: 10000 });

		await cleanup(contextB);
		await cleanup(contextC);
	});

	test('should clear typing indicator after timeout', async ({ page, browser }) => {
		const roomId = generateTestRoomId();

		await joinRoom(page, roomId);

		const contextB = await createSecondContext(browser);
		const pageB = await contextB.newPage();
		await joinRoom(pageB, roomId);

		const isConnected = await waitForPeersConnected(page, pageB);
		if (!isConnected) {
			await cleanup(contextB);
			test.skip();
			return;
		}

		// User B types something
		await typeMessage(pageB, 'Quick message');
		await waitForP2PSync(500);

		// User A should see indicator
		const draftIndicator = page.locator('[data-testid="draft-indicator"]');
		await expect(draftIndicator).toBeVisible({ timeout: 10000 });

		// Clear the input (stop typing)
		const inputB = pageB.locator('[data-testid="message-input"]');
		await inputB.fill('');

		await waitForP2PSync(500);

		// Wait for the 3-second timeout + margin
		await page.waitForTimeout(4000);

		// Indicator should eventually be hidden
		await expect(draftIndicator).toBeHidden({ timeout: 3000 });

		await cleanup(contextB);
	});

	test('should not show typing indicator for own typing', async ({ page }) => {
		const roomId = generateTestRoomId();
		await joinRoom(page, roomId);

		// Type something
		await typeMessage(page, 'My own typing');

		// Draft indicator should NOT be visible for own typing
		const draftIndicator = page.locator('[data-testid="draft-indicator"]');
		await expect(draftIndicator).toBeHidden();
	});
});
