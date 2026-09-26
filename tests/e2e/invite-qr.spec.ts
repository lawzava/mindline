import { test, expect } from '@playwright/test';
import { generateTestRoomId, joinRoom, keyFragmentFor } from './helpers/test-utils';
import { encodeQr, qrPath } from '../../src/lib/qr';

test.describe('QR invite', () => {
	test('shows the invite as a QR code without printing the key, and hides it again', async ({
		page
	}) => {
		const roomId = generateTestRoomId();
		await joinRoom(page, roomId);
		await expect(page.getByText("You're the only one here.")).toBeVisible();

		const key = keyFragmentFor(roomId).slice('#k='.length);
		const toggle = page.getByTestId('invite-qr-toggle');
		await expect(toggle).toHaveText('Show QR code');
		await expect(toggle).toHaveAttribute('aria-expanded', 'false');
		await expect(page.getByTestId('invite-qr')).toHaveCount(0);

		await toggle.click();

		const qr = page.getByRole('img', { name: 'QR code of the invite link' });
		await expect(qr).toBeVisible();
		expect(await qr.evaluate((el) => el.tagName.toLowerCase())).toBe('svg');
		await expect(toggle).toHaveText('Hide QR code');
		await expect(toggle).toHaveAttribute('aria-expanded', 'true');
		await expect(
			page.getByText('This code is the key. Show it only to the person joining.')
		).toBeVisible();

		// The code carries the full invite: path plus key fragment, no query.
		const invite = new URL(page.url());
		invite.search = '';
		expect(invite.hash).toBe(keyFragmentFor(roomId));
		const expected = encodeQr(invite.href);
		await expect(qr).toHaveAttribute('viewBox', `0 0 ${expected.size} ${expected.size}`);
		await expect(qr.locator('path')).toHaveAttribute('d', qrPath(expected.modules));

		// Only the modules carry the key: no visible text, label, title, or
		// attribute anywhere on the page spells it out.
		const leaks = await page.evaluate((secret) => {
			const found: string[] = [];
			if (document.body.innerText.includes(secret)) found.push('body text');
			for (const el of document.body.querySelectorAll('*')) {
				for (const attr of el.attributes) {
					if (attr.value.includes(secret)) found.push(`${el.tagName}[${attr.name}]`);
				}
			}
			return found;
		}, key);
		expect(leaks).toEqual([]);
		await expect(qr.locator('title, desc, text')).toHaveCount(0);

		await toggle.click();
		await expect(page.getByTestId('invite-qr')).toHaveCount(0);
		await expect(toggle).toHaveText('Show QR code');
		await expect(toggle).toHaveAttribute('aria-expanded', 'false');
		await expect(page.getByTestId('invite-btn')).toBeVisible();
	});
});
