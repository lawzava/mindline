import { test, expect } from '@playwright/test';
import {
	generateTestRoomId,
	joinRoom,
	sendMessage,
	waitForMessage,
	getMessageCount,
	TEST_MESSAGE
} from './helpers/test-utils';

test.describe('Messaging', () => {
	test.describe.configure({ mode: 'serial' });

	test('should send message with Enter key', async ({ page }) => {
		const roomId = generateTestRoomId();
		await joinRoom(page, roomId);

		// Type and send message
		const input = page.locator('[data-testid="message-input"]');
		await input.fill('Hello, World!');
		await input.press('Enter');

		// Message should appear in list
		await waitForMessage(page, 'Hello, World!');
	});

	test('should send message with send button', async ({ page }) => {
		const roomId = generateTestRoomId();
		await joinRoom(page, roomId);

		// Type message
		const input = page.locator('[data-testid="message-input"]');
		await input.fill('Button send test');

		// Click send button
		await page.locator('[data-testid="send-btn"]').click();

		// Message should appear
		await waitForMessage(page, 'Button send test');
	});

	test('should clear input after sending', async ({ page }) => {
		const roomId = generateTestRoomId();
		await joinRoom(page, roomId);

		// Send a message
		const input = page.locator('[data-testid="message-input"]');
		await input.fill('Test message');
		await input.press('Enter');

		// Input should be cleared
		await expect(input).toHaveValue('');
	});

	test('should not send empty message', async ({ page }) => {
		const roomId = generateTestRoomId();
		await joinRoom(page, roomId);

		// Try to send empty message
		const input = page.locator('[data-testid="message-input"]');
		await input.press('Enter');

		// Should still show empty state
		await expect(page.getByText("You're the only one here.")).toBeVisible();
	});

	test('should not send whitespace-only message', async ({ page }) => {
		const roomId = generateTestRoomId();
		await joinRoom(page, roomId);

		// Try to send whitespace-only message
		const input = page.locator('[data-testid="message-input"]');
		await input.fill('   ');
		await input.press('Enter');

		// Should still show empty state
		await expect(page.getByText("You're the only one here.")).toBeVisible();
	});

	test('should display message in message bubble', async ({ page }) => {
		const roomId = generateTestRoomId();
		await joinRoom(page, roomId);

		await sendMessage(page, TEST_MESSAGE);

		// Message bubble should be visible
		const bubble = page.locator('[data-testid="message-bubble"]').first();
		await expect(bubble).toBeVisible();
		await expect(bubble).toContainText(TEST_MESSAGE);
	});

	test('should show message timestamp', async ({ page }) => {
		const roomId = generateTestRoomId();
		await joinRoom(page, roomId);

		await sendMessage(page, TEST_MESSAGE);

		// Message bubble should contain timestamp format (HH:MM)
		const bubble = page.locator('[data-testid="message-bubble"]').first();
		const bubbleText = await bubble.textContent();
		// Timestamp format like "10:30" or "2:45 PM"
		expect(bubbleText).toMatch(/\d{1,2}:\d{2}/);
	});

	test('should allow Shift+Enter for newline without sending', async ({ page }) => {
		const roomId = generateTestRoomId();
		await joinRoom(page, roomId);

		// Type with Shift+Enter
		const input = page.locator('[data-testid="message-input"]');
		await input.fill('Line 1');
		await input.press('Shift+Enter');
		await input.pressSequentially('Line 2');

		// Message should not be sent yet
		await expect(page.getByText("You're the only one here.")).toBeVisible();

		// Input should still have content
		const value = await input.inputValue();
		expect(value.length).toBeGreaterThan(0);
	});

	test('should disable send button when input is empty', async ({ page }) => {
		const roomId = generateTestRoomId();
		await joinRoom(page, roomId);

		// Send button should be disabled with empty input
		const sendBtn = page.locator('[data-testid="send-btn"]');
		await expect(sendBtn).toBeDisabled();

		// Type something
		const input = page.locator('[data-testid="message-input"]');
		await input.fill('test');
		await expect(sendBtn).toBeEnabled();

		// Clear input
		await input.fill('');
		await expect(sendBtn).toBeDisabled();
	});

	test('should send multiple messages in sequence', async ({ page }) => {
		const roomId = generateTestRoomId();
		await joinRoom(page, roomId);

		// Send multiple messages
		await sendMessage(page, 'Message 1');
		await sendMessage(page, 'Message 2');
		await sendMessage(page, 'Message 3');

		// All messages should be visible
		await waitForMessage(page, 'Message 1');
		await waitForMessage(page, 'Message 2');
		await waitForMessage(page, 'Message 3');

		// Should have 3 message bubbles
		const count = await getMessageCount(page);
		expect(count).toBe(3);
	});

	test('should hide empty state after sending message', async ({ page }) => {
		const roomId = generateTestRoomId();
		await joinRoom(page, roomId);

		// Empty state should be visible initially
		await expect(page.getByText("You're the only one here.")).toBeVisible();

		// Send a message
		await sendMessage(page, TEST_MESSAGE);

		// Empty state should disappear
		await expect(page.getByText("You're the only one here.")).toBeHidden();
	});

	test('should preserve message content with special characters', async ({ page }) => {
		const roomId = generateTestRoomId();
		await joinRoom(page, roomId);

		const specialMessage = 'Test <script>alert("xss")</script> & "quotes" \'single\'';
		await sendMessage(page, specialMessage);

		// Message should be visible with content preserved (XSS escaped)
		await waitForMessage(page, specialMessage);
	});
});
