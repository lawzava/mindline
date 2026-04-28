import { test, expect } from '@playwright/test';
import { generateTestRoomId, waitForConnectionStatus } from './helpers/test-utils';

test.describe('Landing Page', () => {
	test.describe.configure({ mode: 'serial' });

	test('should render landing page correctly', async ({ page }) => {
		await page.goto('/');

		await expect(page.getByRole('heading', { name: 'Mindline' })).toBeVisible();
		await expect(page.getByText('Private rooms for live thoughts.')).toBeVisible();
		await expect(page.getByText('Drafts are live while you type.')).toBeVisible();
		await expect(page.getByText('Anyone with a room link can join.')).toBeVisible();
		await expect(page.getByText('Messages sync with peers when connected.')).toBeVisible();
		await expect(page.locator('[data-testid="create-room-btn"]')).toBeVisible();
		await expect(page.locator('[data-testid="join-room-input"]')).toBeVisible();
		await expect(page.locator('[data-testid="join-room-btn"]')).toBeVisible();
	});

	test('should load WASM and enable create room button', async ({ page }) => {
		await page.goto('/');

		// Wait for WASM to load - button should become enabled
		const createBtn = page.locator('[data-testid="create-room-btn"]');
		await expect(createBtn).toBeEnabled({ timeout: 10000 });
	});

	test('should create new room and navigate to it', async ({ page }) => {
		await page.goto('/');

		// Wait for WASM to load
		const createBtn = page.locator('[data-testid="create-room-btn"]');
		await expect(createBtn).toBeEnabled({ timeout: 10000 });

		// Click create room
		await createBtn.click();

		// Should navigate to a room with UUID-like path
		await page.waitForURL(/\/[a-f0-9-]+$/);

		// Room page should show connection status
		await waitForConnectionStatus(page);
	});

	test('should join existing room via input', async ({ page }) => {
		const roomId = generateTestRoomId();

		await page.goto('/');

		// Wait for WASM
		await expect(page.locator('[data-testid="create-room-btn"]')).toBeEnabled({ timeout: 10000 });

		// Enter room ID
		const input = page.locator('[data-testid="join-room-input"]');
		await input.fill(roomId);

		// Join button should be enabled
		const joinBtn = page.locator('[data-testid="join-room-btn"]');
		await expect(joinBtn).toBeEnabled();

		// Click join
		await joinBtn.click();

		// Should navigate to the room
		await page.waitForURL(`/${roomId}`);
		await waitForConnectionStatus(page);
	});

	test('should join existing room via invite link', async ({ page }) => {
		const roomId = generateTestRoomId();

		await page.goto('/');

		// Wait for WASM
		await expect(page.locator('[data-testid="create-room-btn"]')).toBeEnabled({ timeout: 10000 });

		// Paste a full invite link
		const origin = new URL(page.url()).origin;
		const inviteLink = `${origin}/${roomId}`;

		const input = page.locator('[data-testid="join-room-input"]');
		await input.fill(inviteLink);

		const joinBtn = page.locator('[data-testid="join-room-btn"]');
		await expect(joinBtn).toBeEnabled();
		await joinBtn.click();

		await page.waitForURL(`/${roomId}`);
		await waitForConnectionStatus(page);
	});

	test('should disable join button when room ID is empty', async ({ page }) => {
		await page.goto('/');

		// Wait for WASM
		await expect(page.locator('[data-testid="create-room-btn"]')).toBeEnabled({ timeout: 10000 });

		// Join button should be disabled with empty input
		const joinBtn = page.locator('[data-testid="join-room-btn"]');
		await expect(joinBtn).toBeDisabled();

		// Type something
		const input = page.locator('[data-testid="join-room-input"]');
		await input.fill('test-room');
		await expect(joinBtn).toBeEnabled();

		// Clear input
		await input.fill('');
		await expect(joinBtn).toBeDisabled();

		// Whitespace only should also be disabled
		await input.fill('   ');
		await expect(joinBtn).toBeDisabled();
	});

	test('should join room via Enter key', async ({ page }) => {
		const roomId = generateTestRoomId();

		await page.goto('/');

		// Wait for WASM
		await expect(page.locator('[data-testid="create-room-btn"]')).toBeEnabled({ timeout: 10000 });

		// Enter room ID and press Enter
		const input = page.locator('[data-testid="join-room-input"]');
		await input.fill(roomId);
		await input.press('Enter');

		// Should navigate to the room
		await page.waitForURL(`/${roomId}`);
		await waitForConnectionStatus(page);
	});
});
