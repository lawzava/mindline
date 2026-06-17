import { test, expect } from '@playwright/test';
import { generateTestRoomId, keyFragmentFor, waitForConnectionStatus } from './helpers/test-utils';

test.describe('Landing Page', () => {
	test.describe.configure({ mode: 'serial' });

	test('should render landing page correctly', async ({ page }) => {
		await page.goto('/');

		// Check main elements are visible
		await expect(page.getByText('Talk on a live wire.')).toBeVisible();
		await expect(page.getByText('end-to-end encrypted', { exact: false })).toBeVisible();
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
		await page.waitForURL(/\/[a-f0-9-]+#k=/);

		// Room page should show connection status
		await waitForConnectionStatus(page);
	});

	test('should join existing room via input', async ({ page }) => {
		const roomId = generateTestRoomId();

		await page.goto('/');

		// Wait for WASM
		await expect(page.locator('[data-testid="create-room-btn"]')).toBeEnabled({ timeout: 10000 });

		// Enter the full invite (room id + key fragment), as users paste it
		const input = page.locator('[data-testid="join-room-input"]');
		await input.fill(`${roomId}${keyFragmentFor(roomId)}`);

		// Join button should be enabled
		const joinBtn = page.locator('[data-testid="join-room-btn"]');
		await expect(joinBtn).toBeEnabled();

		// Click join
		await joinBtn.click();

		// Should navigate to the room
		await page.waitForURL(new RegExp(`/${roomId}`));
		await waitForConnectionStatus(page);
	});

	test('should join existing room via invite link', async ({ page }) => {
		const roomId = generateTestRoomId();

		await page.goto('/');

		// Wait for WASM
		await expect(page.locator('[data-testid="create-room-btn"]')).toBeEnabled({ timeout: 10000 });

		// Paste a full invite link (room id + key fragment)
		const origin = new URL(page.url()).origin;
		const inviteLink = `${origin}/${roomId}${keyFragmentFor(roomId)}`;

		const input = page.locator('[data-testid="join-room-input"]');
		await input.fill(inviteLink);

		const joinBtn = page.locator('[data-testid="join-room-btn"]');
		await expect(joinBtn).toBeEnabled();
		await joinBtn.click();

		await page.waitForURL(new RegExp(`/${roomId}`));
		await waitForConnectionStatus(page);
	});

	test('join button stays enabled and validates on submit', async ({ page }) => {
		await page.goto('/');

		// Wait for WASM
		await expect(page.locator('[data-testid="create-room-btn"]')).toBeEnabled({ timeout: 10000 });

		const joinBtn = page.locator('[data-testid="join-room-btn"]');
		const input = page.locator('[data-testid="join-room-input"]');

		// The button is intentionally NOT gated on input content: a
		// disabled-until-valid button drops the click that lands in the same tick
		// as a paste (before the reactive re-enable), which reads as "pasting the
		// link does nothing". Validation happens on submit instead.
		await expect(joinBtn).toBeEnabled();

		// Empty submit surfaces a hint and stays on the landing page.
		await joinBtn.click();
		await expect(input).toBeVisible();
		await expect(page.getByText('Paste an invite link or room code to join.')).toBeVisible();

		// Whitespace-only is treated as empty too — still no navigation.
		await input.fill('   ');
		await joinBtn.click();
		await expect(input).toBeVisible();

		// A real value keeps the button enabled and ready to navigate.
		await input.fill('test-room');
		await expect(joinBtn).toBeEnabled();
	});

	test('should join room via Enter key', async ({ page }) => {
		const roomId = generateTestRoomId();

		await page.goto('/');

		// Wait for WASM
		await expect(page.locator('[data-testid="create-room-btn"]')).toBeEnabled({ timeout: 10000 });

		// Paste the full invite and press Enter
		const input = page.locator('[data-testid="join-room-input"]');
		await input.fill(`${roomId}${keyFragmentFor(roomId)}`);
		await input.press('Enter');

		// Should navigate to the room
		await page.waitForURL(new RegExp(`/${roomId}`));
		await waitForConnectionStatus(page);
	});
});
