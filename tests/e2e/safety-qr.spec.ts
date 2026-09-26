import { test, expect, chromium, type Page } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodeQr } from '../../src/lib/qr';
import { safetyQrText } from '../../src/lib/safety-qr';
import {
	generateTestRoomId,
	handleUnavailableP2P,
	joinRoom,
	waitForPeersConnected
} from './helpers/test-utils';

async function openSafetyNumber(page: Page): Promise<string> {
	await page.getByTestId('peer-count').click();
	await page
		.getByTestId('peer-list')
		.getByRole('button', { name: /Verify/ })
		.first()
		.click();
	const number = page.getByTestId('safety-number');
	await expect(number).toHaveText(/^(\d{5}\s*){12}$/);
	return (await number.textContent())!.replace(/\s+/g, ' ').trim();
}

/** A still camera feed (Y4M, 4:2:0) showing `text` as a QR code. */
function cameraFeed(path: string, text: string): void {
	const width = 640;
	const height = 480;
	const { modules, size } = encodeQr(text);
	const scale = Math.floor(Math.min(width, height) / size);
	const left = Math.floor((width - size * scale) / 2);
	const top = Math.floor((height - size * scale) / 2);
	const luma = Buffer.alloc(width * height, 235);
	for (let y = 0; y < size * scale; y++) {
		for (let x = 0; x < size * scale; x++) {
			if (modules[Math.floor(y / scale)][Math.floor(x / scale)]) {
				luma[(top + y) * width + left + x] = 16;
			}
		}
	}
	const chroma = Buffer.alloc((width / 2) * (height / 2), 128);
	const frame = Buffer.concat([Buffer.from('FRAME\n'), luma, chroma, chroma]);
	const header = Buffer.from(`YUV4MPEG2 W${width} H${height} F10:1 Ip A1:1 C420jpeg\n`);
	writeFileSync(path, Buffer.concat([header, frame, frame, frame]));
}

test.skip(({ browserName }) => browserName !== 'chromium', 'fake camera feed is Chromium-only');

test("scanning the other person's code verifies their device", async ({ page, baseURL }) => {
	const feed = join(mkdtempSync(join(tmpdir(), 'mindline-cam-')), 'feed.y4m');
	// Chromium opens the file when the camera starts, so it can be written later.
	cameraFeed(feed, 'placeholder');
	const scannerBrowser = await chromium.launch({
		args: [
			'--use-fake-ui-for-media-stream',
			'--use-fake-device-for-media-stream',
			`--use-file-for-fake-video-capture=${feed}`
		]
	});
	const contextB = await scannerBrowser.newContext({ baseURL, permissions: ['camera'] });
	const pageB = await contextB.newPage();
	try {
		const roomId = generateTestRoomId('safety-qr');
		await joinRoom(page, roomId);
		await joinRoom(pageB, roomId);
		if (!(await waitForPeersConnected(page, pageB))) {
			handleUnavailableP2P('Safety QR test failed: peers never connected');
		}

		const number = await openSafetyNumber(page);
		await page.getByTestId('safety-qr-toggle').click();
		await expect(page.getByTestId('safety-qr')).toBeVisible();
		cameraFeed(feed, safetyQrText(number));

		expect(await openSafetyNumber(pageB)).toBe(number);
		await pageB.getByTestId('safety-scan-btn').click();
		await expect(pageB.getByTestId('safety-scan-match')).toBeVisible({ timeout: 20000 });
		// The scan marked them verified, and the camera is released.
		await expect(pageB.getByTestId('safety-scan-video')).toHaveCount(0);
		await pageB.getByRole('button', { name: 'Close' }).click();
		await pageB.getByTestId('peer-count').click();
		await expect(pageB.getByTestId('peer-list').getByTestId('verify-status')).toHaveText(
			'Verified'
		);
	} finally {
		await contextB.close();
		await scannerBrowser.close();
	}
});

test('a code that does not match says so and verifies nothing', async ({ page, baseURL }) => {
	const feed = join(mkdtempSync(join(tmpdir(), 'mindline-cam-')), 'feed.y4m');
	cameraFeed(feed, safetyQrText('1'.repeat(60)));
	const scannerBrowser = await chromium.launch({
		args: [
			'--use-fake-ui-for-media-stream',
			'--use-fake-device-for-media-stream',
			`--use-file-for-fake-video-capture=${feed}`
		]
	});
	const contextB = await scannerBrowser.newContext({ baseURL, permissions: ['camera'] });
	const pageB = await contextB.newPage();
	try {
		const roomId = generateTestRoomId('safety-qr-bad');
		await joinRoom(page, roomId);
		await joinRoom(pageB, roomId);
		if (!(await waitForPeersConnected(page, pageB))) {
			handleUnavailableP2P('Safety QR test failed: peers never connected');
		}
		await openSafetyNumber(pageB);
		await pageB.getByTestId('safety-scan-btn').click();
		await expect(pageB.getByTestId('safety-scan-mismatch')).toBeVisible({ timeout: 20000 });
		await pageB.getByRole('button', { name: 'Close' }).click();
		await pageB.getByTestId('peer-count').click();
		await expect(pageB.getByTestId('peer-list').getByTestId('verify-status')).toHaveText('Verify');
	} finally {
		await contextB.close();
		await scannerBrowser.close();
	}
});
