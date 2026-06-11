import { test, expect } from '@playwright/test';
import {
	generateTestRoomId,
	waitForConnectionStatus,
	createRoom,
	joinRoom,
	goToLandingPage
} from './helpers/test-utils';

test.describe('Room Page', () => {
	test.describe.configure({ mode: 'serial' });

	test('should load room page with room ID in URL', async ({ page }) => {
		const roomId = generateTestRoomId();
		await joinRoom(page, roomId);

		// Check URL contains the room ID
		expect(page.url()).toContain(roomId);

		// Room elements should be visible
		await expect(page.locator('[data-testid="copy-room-btn"]')).toBeVisible();
		await expect(page.locator('[data-testid="leave-room-btn"]')).toBeVisible();
		await expect(page.locator('[data-testid="message-input"]')).toBeVisible();
		await expect(page.locator('[data-testid="message-list"]')).toBeVisible();
	});

	test('should display truncated room ID', async ({ page }) => {
		const roomId = generateTestRoomId();
		await joinRoom(page, roomId);

		// Room ID should show truncated version
		const copyBtn = page.locator('[data-testid="copy-room-btn"]');
		const buttonText = await copyBtn.textContent();
		expect(buttonText).toContain('...');
		// Should show first 8 characters
		expect(buttonText).toContain(roomId.slice(0, 8));
	});

		test('should copy room ID to clipboard', async ({ page, context }, testInfo) => {
			const projectName = testInfo.project.name.toLowerCase();
			const isWebKit = projectName.includes('safari') || projectName.includes('webkit');

			// WebKit/Safari often rejects clipboard permission grants; copy via user gesture
			// should still work, and we validate via toast.
			if (!isWebKit) {
				await context.grantPermissions(['clipboard-read', 'clipboard-write']);
			} else {
				try {
					await context.grantPermissions(['clipboard-read', 'clipboard-write']);
				} catch {
					// ignore
				}
			}

			const roomId = generateTestRoomId();
			await joinRoom(page, roomId);

			// Click copy button
			await page.locator('[data-testid="copy-room-btn"]').click();

			// Toast should appear
			await expect(page.getByText('Invite link copied', { exact: false })).toBeVisible({
				timeout: 3000
			});

			// Safari/WebKit does not reliably allow programmatic clipboard reads.
			if (!isWebKit) {
				const clipboardContent = await page.evaluate(() => navigator.clipboard.readText());
				// The invite is the full URL: room id in the path, key fragment intact.
				expect(clipboardContent).toContain(`/${roomId}`);
				expect(clipboardContent).toContain('#k=');
			}
		});

	test('should show leave room confirmation dialog', async ({ page }) => {
		const roomId = generateTestRoomId();
		await joinRoom(page, roomId);

		// Click leave button
		await page.locator('[data-testid="leave-room-btn"]').click();

		// Dialog should appear
		await expect(page.getByText('Leave Room?')).toBeVisible();
		await expect(
			page.getByText("Leave keeps this room's history on this device", { exact: false })
		).toBeVisible();

		// Cancel, Leave, and Burn buttons should be visible
		await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Leave Room' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Burn & Leave' })).toBeVisible();
	});

	test('should cancel leave room and stay in room', async ({ page }) => {
		const roomId = generateTestRoomId();
		await joinRoom(page, roomId);

		// Click leave button
		await page.locator('[data-testid="leave-room-btn"]').click();

		// Click Cancel
		await page.getByRole('button', { name: 'Cancel' }).click();

		// Dialog should close
		await expect(page.getByText('Leave Room?')).toBeHidden();

		// Should still be in the room
		expect(page.url()).toContain(roomId);
		await expect(page.locator('[data-testid="message-input"]')).toBeVisible();
	});

	test('should leave room and navigate to home', async ({ page }) => {
		const roomId = generateTestRoomId();
		await joinRoom(page, roomId);

		// Click leave button
		await page.locator('[data-testid="leave-room-btn"]').click();

		// Click Leave Room
		await page.getByRole('button', { name: 'Leave Room' }).click();

		// Should navigate to home page
		await page.waitForURL('/');
		await expect(page.getByText('Talk on a live wire.')).toBeVisible();
	});

	test('burn & leave removes keys, history, and room markers from the device', async ({
		page
	}) => {
		const roomId = generateTestRoomId();
		await joinRoom(page, roomId);

		// Create some history so there is something to burn
		const input = page.locator('[data-testid="message-input"]');
		await input.fill('burn me');
		await input.press('Enter');
		await expect(page.getByText('burn me')).toBeVisible();

		await page.locator('[data-testid="leave-room-btn"]').click();
		await page.locator('[data-testid="leave-burn-btn"]').click();
		await page.waitForURL('/');

		const residue = await page.evaluate(async (id) => {
			const idbGet = (db: string, store: string) =>
				new Promise<unknown>((resolve) => {
					const open = indexedDB.open(db);
					open.onsuccess = () => {
						const conn = open.result;
						if (!conn.objectStoreNames.contains(store)) {
							conn.close();
							resolve(undefined);
							return;
						}
						const req = conn.transaction(store).objectStore(store).get(id);
						req.onsuccess = () => {
							conn.close();
							resolve(req.result);
						};
						req.onerror = () => {
							conn.close();
							resolve(undefined);
						};
					};
					open.onerror = () => resolve(undefined);
				});
			return {
				keys: await idbGet('mindline-keys', 'rooms', id),
				replay: await idbGet('mindline-keys', 'replay', id),
				history: await idbGet('mindline-messages', 'pages', id),
				legacyPlaintext: localStorage.getItem(`chatHistory_${id}`),
				currentRoom: localStorage.getItem('mindline_currentRoomId')
			};
		}, roomId);

		expect(residue.keys).toBeUndefined();
		expect(residue.replay).toBeUndefined();
		expect(residue.history).toBeUndefined();
		expect(residue.legacyPlaintext).toBeNull();
		expect(residue.currentRoom).toBeNull();
	});

	test('should show empty message state initially', async ({ page }) => {
		const roomId = generateTestRoomId();
		await joinRoom(page, roomId);

		// Empty state message should be visible
		await expect(page.getByText("You're the only one here.")).toBeVisible();
	});

	test('should focus message input on load', async ({ page }) => {
		const roomId = generateTestRoomId();
		await joinRoom(page, roomId);

		// Give time for focus to be set
		await page.waitForTimeout(500);

		// Message input should be focused
		const input = page.locator('[data-testid="message-input"]');
		await expect(input).toBeFocused();
	});

	test('should navigate between rooms', async ({ page }) => {
		// Create first room
		const roomId1 = await createRoom(page);

		// Navigate to home
		await goToLandingPage(page);

		// Create second room
		const roomId2 = await createRoom(page);

		// Verify different room IDs
		expect(roomId1).not.toBe(roomId2);
		expect(page.url()).toContain(roomId2);
	});
});
