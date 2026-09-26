import { test, expect, type Page } from '@playwright/test';
import {
	createRoom,
	generateTestRoomId,
	keyFragmentFor,
	sendMessage,
	waitForMessage
} from './helpers/test-utils';

/** A platform passkey with PRF, answering every prompt with a verified user. */
async function addPasskeyDevice(page: Page) {
	const cdp = await page.context().newCDPSession(page);
	await cdp.send('WebAuthn.enable');
	await cdp.send('WebAuthn.addVirtualAuthenticator', {
		options: {
			protocol: 'ctap2',
			transport: 'internal',
			hasResidentKey: true,
			hasUserVerification: true,
			isUserVerified: true,
			hasPrf: true,
			automaticPresenceSimulation: true
		}
	});
}

/** What the keystore holds for each room, by field name. */
function storedRoomFields(page: Page): Promise<string[][]> {
	return page.evaluate(
		() =>
			new Promise<string[][]>((resolve, reject) => {
				const req = indexedDB.open('mindline-keys');
				req.onsuccess = () => {
					const all = req.result.transaction('rooms').objectStore('rooms').getAll();
					all.onsuccess = () => resolve(all.result.map((r) => Object.keys(r).sort()));
					all.onerror = () => reject(all.error);
				};
				req.onerror = () => reject(req.error);
			})
	);
}

test.skip(
	({ browserName }) => browserName !== 'chromium',
	'virtual authenticator is Chromium-only'
);

test('a passkey locks every room on the device until it is used again', async ({ page }) => {
	await addPasskeyDevice(page);
	const roomId = await createRoom(page);
	await sendMessage(page, 'only with the passkey');

	await page.goto('/');
	await page.getByTestId('lock-on-btn').click();
	await page.getByTestId('lock-confirm-btn').click();
	await expect(page.getByTestId('lock-status')).toBeVisible();
	// At rest, the room keeps only its link key, sealed under the lock.
	expect(await storedRoomFields(page)).toEqual([['locked']]);

	await page.reload();
	await expect(page.getByTestId('lock-gate')).toBeVisible();
	await expect(page.getByTestId('room-preview')).toHaveCount(0);
	// A room link opens nothing while locked either.
	await page.goto(`/${roomId}`);
	await expect(page.getByTestId('lock-gate')).toBeVisible();

	await page.getByTestId('unlock-btn').click();
	await expect(page.getByTestId('lock-gate')).toHaveCount(0);
	await waitForMessage(page, 'only with the passkey');

	// In-app navigation keeps the tab unlocked; a full page load would not.
	await page.getByTestId('leave-room-btn').click();
	await expect(page.getByTestId('room-preview')).toContainText('only with the passkey');
	await page.getByTestId('lock-now-btn').click();
	await expect(page.getByTestId('lock-gate')).toBeVisible();
	await page.getByTestId('unlock-btn').click();

	await page.getByTestId('lock-off-btn').click();
	await expect(page.getByTestId('lock-on-btn')).toBeVisible();
	await page.reload();
	await expect(page.getByTestId('lock-gate')).toHaveCount(0);
	await expect(page.getByTestId('room-preview')).toContainText('only with the passkey');
});

test('a lost passkey means removing the rooms, not a way around the lock', async ({ page }) => {
	await addPasskeyDevice(page);
	await createRoom(page);
	await sendMessage(page, 'gone with the passkey');
	await page.goto('/');
	await page.getByTestId('lock-on-btn').click();
	await page.getByTestId('lock-confirm-btn').click();
	await expect(page.getByTestId('lock-status')).toBeVisible();

	await page.reload();
	await page.getByRole('button', { name: 'Lost the passkey?' }).click();
	await page.getByTestId('forget-lock-btn').click();
	await expect(page.getByTestId('lock-gate')).toHaveCount(0);
	await expect(page.getByTestId('room-preview')).toHaveCount(0);
	expect(await storedRoomFields(page)).toEqual([]);
	await expect(page.getByTestId('lock-on-btn')).toBeVisible();
});

test('on a locked device, room links stay out of the address bar and history', async ({ page }) => {
	await addPasskeyDevice(page);
	await page.goto('/');
	await page.getByTestId('lock-on-btn').click();
	await page.getByTestId('lock-confirm-btn').click();
	await expect(page.getByTestId('lock-status')).toBeVisible();

	// A room made here never shows its key in the address bar.
	await page.getByTestId('create-room-btn').click();
	await page.waitForURL(/\/f_[A-Za-z0-9_-]{22}$/);
	await sendMessage(page, 'made while locked');
	expect(page.url()).not.toContain('#');

	// A link opened from elsewhere loses its key once the room is saved.
	const other = generateTestRoomId('lock-join');
	await page.goto(`/${other}?fastConnect=true${keyFragmentFor(other)}`);
	await page.getByTestId('unlock-btn').click();
	await expect(page.getByTestId('message-input')).toBeVisible();
	await expect.poll(() => new URL(page.url()).hash).toBe('');
	expect(await storedRoomFields(page)).toEqual([['locked'], ['locked']]);
});
