import { expect, test, type Page, type Browser, type BrowserContext } from '@playwright/test';

// Test constants
export const TEST_USER_A = { name: 'Alice' };
export const TEST_USER_B = { name: 'Bob' };
export const TEST_USER_C = { name: 'Charlie' };
export const TEST_MESSAGE = 'Hello, World!';
export const TEST_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '👏', '🔥', '🎉'];
export const STRICT_P2P_MODE = process.env.E2E_STRICT_P2P === '1';

/**
 * Generate a unique room ID for test isolation
 */
export function generateTestRoomId(prefix = 'test-room'): string {
	return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(7)}`;
}

/**
 * Wait for any valid connection status to appear
 */
export async function waitForConnectionStatus(
	page: Page,
	statuses: string[] = ['Connected', 'Local', 'Connecting', 'Reconnecting']
): Promise<void> {
	const statusBadge = page.locator('[data-testid="connection-status"]');

	const statusLocator = statuses.reduce((locator, status, index) => {
		if (index === 0) return statusBadge.filter({ hasText: status });
		return locator.or(statusBadge.filter({ hasText: status }));
	}, statusBadge.filter({ hasText: statuses[0] }));

	await expect(statusLocator).toBeVisible({ timeout: 15000 });
}

/**
 * Wait for a specific connection status
 */
export async function waitForSpecificStatus(page: Page, status: string): Promise<void> {
	const statusBadge = page.locator('[data-testid="connection-status"]');
	await expect(statusBadge.filter({ hasText: status })).toBeVisible({ timeout: 15000 });
}

/**
 * Wait for a message to appear in the message list
 */
export async function waitForMessage(page: Page, text: string, timeout = 10000): Promise<void> {
	await expect(page.locator('[data-testid="message-list"]').getByText(text)).toBeVisible({
		timeout
	});
}

/**
 * Send a message via the message input
 */
export async function sendMessage(page: Page, text: string): Promise<void> {
	const input = page.locator('[data-testid="message-input"]');
	await input.fill(text);
	await input.press('Enter');
}

/**
 * Type in the message input without sending (for typing indicator tests)
 */
export async function typeMessage(page: Page, text: string): Promise<void> {
	const input = page.locator('[data-testid="message-input"]');
	await input.fill(text);
}

/**
 * Navigate to a room and wait for it to load
 * Adds ?fastConnect=true for faster P2P connection in tests
 */
export async function joinRoom(page: Page, roomId: string): Promise<void> {
	await page.goto(`/${roomId}?fastConnect=true`);
	await waitForConnectionStatus(page);
}

/**
 * Navigate to the landing page
 */
export async function goToLandingPage(page: Page): Promise<void> {
	await page.goto('/');
	// Wait for WASM to load by checking if create button is enabled
	await expect(page.locator('[data-testid="create-room-btn"]')).toBeEnabled({ timeout: 10000 });
}

/**
 * Create a new room from the landing page and return the room ID
 * Automatically adds ?fastConnect=true for faster P2P connection in tests
 */
export async function createRoom(page: Page): Promise<string> {
	await goToLandingPage(page);
	await page.locator('[data-testid="create-room-btn"]').click();

	// Wait for navigation to room page
	await page.waitForURL(/\/[a-f0-9-]+$/);

	// Extract room ID from URL before adding fastConnect param
	const url = page.url();
	const roomId = url.split('/').pop()?.split('?')[0] || '';

	// Navigate with fastConnect param for faster P2P connection
	await page.goto(`/${roomId}?fastConnect=true`);
	await waitForConnectionStatus(page);

	return roomId;
}

/**
 * Create a second browser context for multi-user tests
 */
export async function createSecondContext(browser: Browser): Promise<BrowserContext> {
	return browser.newContext();
}

/**
 * Setup two users in the same room for P2P tests
 * Returns pages for both users and the room ID
 */
export async function setupTwoUsers(
	browser: Browser,
	existingPage: Page
): Promise<{ pageA: Page; pageB: Page; roomId: string; contextB: BrowserContext }> {
	// User A creates a room
	const roomId = await createRoom(existingPage);

	// Create second browser context for User B
	const contextB = await createSecondContext(browser);
	const pageB = await contextB.newPage();

	// User B joins the same room
	await joinRoom(pageB, roomId);

	// Wait for both to be connected
	await waitForConnectionStatus(existingPage);
	await waitForConnectionStatus(pageB);

	// Give time for P2P connection to establish (increased for test reliability)
	await existingPage.waitForTimeout(3000);

	return { pageA: existingPage, pageB, roomId, contextB };
}

/**
 * Wait for draft/typing indicator to show specific content
 */
export async function waitForDraftIndicator(page: Page, text: string): Promise<void> {
	await expect(page.locator('[data-testid="draft-indicator"]').getByText(text)).toBeVisible({
		timeout: 5000
	});
}

/**
 * Wait for draft indicator to disappear
 */
export async function waitForDraftToClear(page: Page): Promise<void> {
	await expect(page.locator('[data-testid="draft-indicator"]')).toBeHidden({ timeout: 5000 });
}

/**
 * Get message count in the message list
 */
export async function getMessageCount(page: Page): Promise<number> {
	const messages = page.locator('[data-testid="message-bubble"]');
	return messages.count();
}

/**
 * Click on a reaction emoji on a message
 */
export async function addReaction(page: Page, messageIndex: number, emoji: string): Promise<void> {
	const message = page.locator('[data-testid="message-bubble"]').nth(messageIndex);
	await message.hover();

	// Click the emoji picker button
	const emojiButton = message.locator('button').filter({ hasText: emoji }).first();
	await emojiButton.click();
}

/**
 * Clean up a browser context
 */
export async function cleanup(context: BrowserContext): Promise<void> {
	await context.close();
}

/**
 * Wait for P2P message propagation (use after actions that broadcast to peers)
 */
export async function waitForP2PSync(timeout = 2000): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, timeout));
}

/**
 * Wait for P2P connection between two pages to establish
 * Returns true if both pages see each other as connected peers
 */
export async function waitForPeersConnected(
	pageA: Page,
	pageB: Page,
	timeout = 25000
): Promise<boolean> {
	const startTime = Date.now();

	try {
		// First, wait for both to show "Connected" or "Reconnecting" status
		await Promise.all([
			expect(pageA.locator('[data-testid="connection-status"]')).toContainText(
				/Connected|Reconnecting/,
				{ timeout }
			),
			expect(pageB.locator('[data-testid="connection-status"]')).toContainText(
				/Connected|Reconnecting/,
				{ timeout }
			)
		]);

		// Poll for peer visibility with shorter initial wait (fastConnect mode)
		await waitForP2PSync(1000);

		while (Date.now() - startTime < timeout) {
			const textA = await pageA
				.locator('[data-testid="peer-count"]')
				.textContent()
				.catch(() => '');
			const textB = await pageB
				.locator('[data-testid="peer-count"]')
				.textContent()
				.catch(() => '');

			const matchA = textA?.match(/(\d+)\s*peer/);
			const matchB = textB?.match(/(\d+)\s*peer/);

			if (matchA && matchB && parseInt(matchA[1]) >= 1 && parseInt(matchB[1]) >= 1) {
				return true;
			}
			// Faster polling interval
			await pageA.waitForTimeout(200);
		}
	} catch {
		// Page was closed or connection status check failed
		return false;
	}

	return false;
}

/**
 * Handle missing peer connectivity based on suite mode.
 * In strict mode this fails the test; otherwise it skips as best-effort.
 */
export function handleUnavailableP2P(message: string): never {
	if (STRICT_P2P_MODE) {
		throw new Error(message);
	}
	test.skip(true, message);
	throw new Error(message);
}

/**
 * Check if a page has actual peer connections (not "Waiting for peers")
 */
export async function isPeersActuallyConnected(page: Page): Promise<boolean> {
	try {
		const peerCount = page.locator('[data-testid="peer-count"]');
		const isVisible = await peerCount.isVisible({ timeout: 2000 });
		if (isVisible) {
			const text = await peerCount.textContent();
			const hasActualPeers = text?.includes('peer') === true && !text?.includes('Waiting');
			return hasActualPeers;
		}
		return false;
	} catch {
		return false;
	}
}

/**
 * Copy room ID to clipboard and verify
 */
export async function copyRoomId(page: Page): Promise<void> {
	await page.locator('[data-testid="copy-room-btn"]').click();
	// Toast should appear
	await expect(page.getByText('Room ID copied!')).toBeVisible({ timeout: 3000 });
}

/**
 * Leave a room via the leave button
 */
export async function leaveRoom(page: Page, confirm = true): Promise<void> {
	await page.locator('[data-testid="leave-room-btn"]').click();

	if (confirm) {
		// Click confirm in dialog
		await page.getByRole('button', { name: 'Leave Room' }).click();
		// Should navigate to home
		await page.waitForURL('/');
	} else {
		// Cancel
		await page.getByRole('button', { name: 'Cancel' }).click();
	}
}
