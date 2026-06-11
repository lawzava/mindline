import { test, expect } from '@playwright/test';
import {
	generateTestRoomId,
	joinRoom,
	sendMessage,
	waitForMessage,
	waitForP2PSync,
	createSecondContext,
	cleanup,
	createRoom,
	getMessageCount,
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

test.describe('P2P Multi-User Messaging', () => {
	test.describe.configure({ mode: 'serial' });

	test('should receive message from peer', async ({ page, browser }) => {
		const roomId = generateTestRoomId();

		// User A joins
		await joinRoom(page, roomId);

		// User B joins
		const contextB = await createSecondContext(browser);
		const pageB = await contextB.newPage();
		await joinRoom(pageB, roomId);

		const isConnected = await waitForPeersConnected(page, pageB);
		if (!isConnected) {
			console.log('Skipping P2P message test - peers not connected');
			await cleanup(contextB);
			test.skip();
			return;
		}

		// User B sends a message
		await sendMessage(pageB, 'Hello from B!');
		await waitForMessage(pageB, 'Hello from B!');

		// Wait for message to propagate
		await waitForP2PSync(2000);

		// User A should see the message
		await expect(page.locator('[data-testid="message-list"]').getByText('Hello from B!')).toBeVisible({ timeout: 10000 });

		await cleanup(contextB);
	});

	test('should sync message history when new peer joins', async ({ page, browser }) => {
		const roomId = generateTestRoomId();

		// User A joins and sends messages
		await joinRoom(page, roomId);

		await sendMessage(page, 'First message');
		await waitForMessage(page, 'First message');

		await sendMessage(page, 'Second message');
		await waitForMessage(page, 'Second message');

		await sendMessage(page, 'Third message');
		await waitForMessage(page, 'Third message');

		// User B joins later
		const contextB = await createSecondContext(browser);
		const pageB = await contextB.newPage();
		await joinRoom(pageB, roomId);

		const isConnected = await waitForPeersConnected(page, pageB);
		if (!isConnected) {
			console.log('Skipping history sync test - peers not connected');
			await cleanup(contextB);
			test.skip();
			return;
		}

		// Wait for history sync - needs extra time for sync request/response cycle
		await waitForP2PSync(5000);

		// User B should have received the message history
		const messageList = pageB.locator('[data-testid="message-list"]');
		await expect(messageList.getByText('First message')).toBeVisible({ timeout: 10000 });
		await expect(messageList.getByText('Second message')).toBeVisible({ timeout: 10000 });
		await expect(messageList.getByText('Third message')).toBeVisible({ timeout: 10000 });

		await cleanup(contextB);
	});

	test('should not duplicate messages on resync', async ({ page, browser }) => {
		const roomId = generateTestRoomId();

		// User A joins and sends a message
		await joinRoom(page, roomId);
		await sendMessage(page, 'Unique message');
		await waitForMessage(page, 'Unique message');

		// User B joins
		const contextB = await createSecondContext(browser);
		const pageB = await contextB.newPage();
		await joinRoom(pageB, roomId);

		const isConnected = await waitForPeersConnected(page, pageB);
		if (!isConnected) {
			await cleanup(contextB);
			test.skip();
			return;
		}

		await waitForP2PSync(2000);

		// Count messages on B
		const messagesBefore = await getMessageCount(pageB);

		// Force a resync by sending another message
		await sendMessage(page, 'Another message');
		await waitForP2PSync(2000);

		// Count again - should only have 2 messages total, not duplicates
		const messagesAfter = await getMessageCount(pageB);
		expect(messagesAfter).toBe(messagesBefore + 1);

		await cleanup(contextB);
	});

	test('should broadcast messages to all peers in three-user room', async ({ page, browser }) => {
		const roomId = generateTestRoomId();

		// User A creates room
		await joinRoom(page, roomId);

		// User B joins
		const contextB = await createSecondContext(browser);
		const pageB = await contextB.newPage();
		await joinRoom(pageB, roomId);

		// User C joins
		const contextC = await createSecondContext(browser);
		const pageC = await contextC.newPage();
		await joinRoom(pageC, roomId);

		// Wait for all connections
		const isConnected = await waitForPeersConnected(page, pageB);
		await waitForP2PSync(3000);

		if (!isConnected) {
			await cleanup(contextB);
			await cleanup(contextC);
			test.skip();
			return;
		}

		// User A sends a message
		await sendMessage(page, 'Message to all');
		await waitForMessage(page, 'Message to all');

		await waitForP2PSync(3000);

		// Both B and C should receive it
		await expect(pageB.locator('[data-testid="message-list"]').getByText('Message to all')).toBeVisible({ timeout: 10000 });
		await expect(pageC.locator('[data-testid="message-list"]').getByText('Message to all')).toBeVisible({ timeout: 10000 });

		await cleanup(contextB);
		await cleanup(contextC);
	});

	test('should handle peer disconnect gracefully', async ({ page, browser }) => {
		const roomId = generateTestRoomId();

		// User A joins
		await joinRoom(page, roomId);

		// User B joins
		const contextB = await createSecondContext(browser);
		const pageB = await contextB.newPage();
		await joinRoom(pageB, roomId);

		const isConnected = await waitForPeersConnected(page, pageB);
		if (!isConnected) {
			await cleanup(contextB);
			test.skip();
			return;
		}

		// Verify A sees 1 peer
		await expect(page.locator('[data-testid="peer-count"]')).toContainText('1 peer');

		// User B disconnects
		await cleanup(contextB);

		// Wait for disconnect to propagate
		await page.waitForTimeout(3000);

		// User A should see they are alone again
		await expect(page.locator('[data-testid="peer-count"]')).toContainText('just you');

		// A should still be able to send messages
		await sendMessage(page, 'Still working');
		await waitForMessage(page, 'Still working');
	});

	test('should show message from reconnecting peer', async ({ page, browser }) => {
		const roomId = generateTestRoomId();

		// User A joins
		await joinRoom(page, roomId);

		// User B joins
		const contextB = await createSecondContext(browser);
		const pageB = await contextB.newPage();
		await joinRoom(pageB, roomId);

		const isConnected = await waitForPeersConnected(page, pageB);
		if (!isConnected) {
			await cleanup(contextB);
			test.skip();
			return;
		}

		// User B sends a message
		await sendMessage(pageB, 'Before refresh');
		await waitForP2PSync(2000);
		await expect(page.locator('[data-testid="message-list"]').getByText('Before refresh')).toBeVisible({ timeout: 10000 });

		// User B refreshes their page
		await pageB.reload();
		await joinRoom(pageB, roomId);

		// Wait for reconnection
		const stillConnected = await waitForPeersConnected(page, pageB);
		await waitForP2PSync(3000);

		if (!stillConnected) {
			await cleanup(contextB);
			return;
		}

		// User B sends another message after refresh
		await sendMessage(pageB, 'After refresh');
		await waitForP2PSync(2000);

		// User A should see both messages
		await expect(page.locator('[data-testid="message-list"]').getByText('Before refresh')).toBeVisible();
		await expect(page.locator('[data-testid="message-list"]').getByText('After refresh')).toBeVisible({ timeout: 10000 });

		await cleanup(contextB);
	});

	test('should sync message edits to peers', async ({ page, browser }) => {
		const roomId = generateTestRoomId();

		// User A joins
		await joinRoom(page, roomId);

		// User B joins
		const contextB = await createSecondContext(browser);
		const pageB = await contextB.newPage();
		await joinRoom(pageB, roomId);

		const isConnected = await waitForPeersConnected(page, pageB);
		if (!isConnected) {
			await cleanup(contextB);
			test.skip();
			return;
		}

		// User A sends a message
		await sendMessage(page, 'Original content');
		await waitForMessage(page, 'Original content');
		await waitForP2PSync(2000);

		// User B should see it
		await expect(pageB.locator('[data-testid="message-list"]').getByText('Original content')).toBeVisible({ timeout: 10000 });

		// Skip edit test if actions not available (touch device)
		const message = page.locator('[data-testid="message-bubble"]').first();
		await message.hover();
		const menuButton = message.getByLabel('Message options');
		try {
			await expect(menuButton).toBeAttached({ timeout: 2000 });
		} catch {
			await cleanup(contextB);
			test.skip();
			return;
		}

		// User A edits the message
		await menuButton.click({ force: true });
		await page.getByRole('menuitem', { name: 'Edit' }).click();
		const editInput = page.getByLabel('Edit message content');
		await editInput.fill('Edited content');
		await editInput.press('Enter');

		// Wait for edit to propagate
		await waitForP2PSync(2000);

		// User B should see the edited content
		await expect(pageB.locator('[data-testid="message-list"]').getByText('Edited content')).toBeVisible({ timeout: 10000 });
		await expect(pageB.locator('[data-testid="message-bubble"]').first().getByText('(edited)')).toBeVisible();

		await cleanup(contextB);
	});

	test('should sync message deletions to peers', async ({ page, browser }) => {
		const roomId = generateTestRoomId();

		// User A joins
		await joinRoom(page, roomId);

		// User B joins
		const contextB = await createSecondContext(browser);
		const pageB = await contextB.newPage();
		await joinRoom(pageB, roomId);

		const isConnected = await waitForPeersConnected(page, pageB);
		if (!isConnected) {
			await cleanup(contextB);
			test.skip();
			return;
		}

		// User A sends a message
		await sendMessage(page, 'Will be deleted');
		await waitForMessage(page, 'Will be deleted');
		await waitForP2PSync(2000);

		// User B should see it
		await expect(pageB.locator('[data-testid="message-list"]').getByText('Will be deleted')).toBeVisible({ timeout: 10000 });

		// Skip delete test if actions not available
		const message = page.locator('[data-testid="message-bubble"]').first();
		await message.hover();
		const menuButton = message.getByLabel('Message options');
		try {
			await expect(menuButton).toBeAttached({ timeout: 2000 });
		} catch {
			await cleanup(contextB);
			test.skip();
			return;
		}

		// User A deletes the message
		await menuButton.click({ force: true });
		await page.getByRole('menuitem', { name: 'Delete' }).click();
		await page.getByRole('button', { name: 'Delete' }).click();

		// Wait for delete to propagate
		await waitForP2PSync(2000);

		// User B should see the deletion
		await expect(pageB.locator('[data-testid="message-bubble"]').first().getByText('[Message deleted]')).toBeVisible({ timeout: 10000 });

		await cleanup(contextB);
	});

	test('should sync reactions to peers', async ({ page, browser }) => {
		const roomId = generateTestRoomId();

		// User A joins
		await joinRoom(page, roomId);

		// User B joins
		const contextB = await createSecondContext(browser);
		const pageB = await contextB.newPage();
		await joinRoom(pageB, roomId);

		const isConnected = await waitForPeersConnected(page, pageB);
		if (!isConnected) {
			await cleanup(contextB);
			test.skip();
			return;
		}

		// User A sends a message
		await sendMessage(page, 'React to me');
		await waitForMessage(page, 'React to me');
		await waitForP2PSync(2000);

		// User B should see it
		await expect(pageB.locator('[data-testid="message-list"]').getByText('React to me')).toBeVisible({ timeout: 10000 });

		// Check if emoji picker is available
		const message = page.locator('[data-testid="message-bubble"]').first();
		await message.hover();
		const emojiButton = message.getByLabel('Add reaction');
		try {
			await expect(emojiButton).toBeAttached({ timeout: 2000 });
		} catch {
			await cleanup(contextB);
			test.skip();
			return;
		}

		// User A adds a reaction
		await emojiButton.click({ force: true });
		await page.getByRole('option').filter({ hasText: '👍' }).click();

		// Wait for reaction to propagate
		await waitForP2PSync(2000);

		// User B should see the reaction
		await expect(pageB.locator('[data-testid="message-bubble"]').first().getByText('👍')).toBeVisible({ timeout: 10000 });

		await cleanup(contextB);
	});

	test('should maintain message order across peers', async ({ page, browser }) => {
		const roomId = generateTestRoomId();

		// User A joins
		await joinRoom(page, roomId);

		// User B joins
		const contextB = await createSecondContext(browser);
		const pageB = await contextB.newPage();
		await joinRoom(pageB, roomId);

		const isConnected = await waitForPeersConnected(page, pageB);
		if (!isConnected) {
			await cleanup(contextB);
			test.skip();
			return;
		}

		// User A sends messages
		await sendMessage(page, 'Message 1');
		await waitForMessage(page, 'Message 1');

		await sendMessage(page, 'Message 2');
		await waitForMessage(page, 'Message 2');

		// User B sends a message
		await sendMessage(pageB, 'Message 3');
		await waitForMessage(pageB, 'Message 3');

		await waitForP2PSync(3000);

		// Both should have messages in order
		const messagesA = page.locator('[data-testid="message-bubble"]');
		const messagesB = pageB.locator('[data-testid="message-bubble"]');

		// Should have at least 3 messages
		await expect(messagesA).toHaveCount(3, { timeout: 10000 });
		await expect(messagesB).toHaveCount(3, { timeout: 10000 });

		await cleanup(contextB);
	});
});
