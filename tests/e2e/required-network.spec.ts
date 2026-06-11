import { test, expect } from '@playwright/test';
import {
	generateTestRoomId,
	joinRoom,
	sendMessage,
	waitForP2PSync,
	createSecondContext,
	cleanup,
	waitForConnectionStatus
} from './helpers/test-utils';

test.describe('Required Network', () => {
	test.describe.configure({ mode: 'serial' });

	test('falls back to WebSocket relay when WebRTC is unavailable', async ({ page, browser }) => {
		const roomId = generateTestRoomId('required-relay');

		// Disable WebRTC in both clients so chat must use relay fallback.
		await page.addInitScript(() => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(window as any).__relayFrames = [];
			const originalSend = WebSocket.prototype.send;
			WebSocket.prototype.send = function (data: string | ArrayBufferLike | Blob | ArrayBufferView) {
				try {
					if (typeof data === 'string') {
						const parsed = JSON.parse(data);
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						if (parsed?.type === 'relay') (window as any).__relayFrames.push(parsed);
					}
				} catch {
					// Ignore malformed WebSocket frames
				}
				return originalSend.call(this, data);
			};

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(window as any).RTCPeerConnection = class BrokenRTCPeerConnection {
				constructor() {
					throw new Error('WebRTC disabled for relay test');
				}
			};
		});

		const contextB = await createSecondContext(browser);
		await contextB.addInitScript(() => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(window as any).__relayFrames = [];
			const originalSend = WebSocket.prototype.send;
			WebSocket.prototype.send = function (data: string | ArrayBufferLike | Blob | ArrayBufferView) {
				try {
					if (typeof data === 'string') {
						const parsed = JSON.parse(data);
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						if (parsed?.type === 'relay') (window as any).__relayFrames.push(parsed);
					}
				} catch {
					// Ignore malformed WebSocket frames
				}
				return originalSend.call(this, data);
			};

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(window as any).RTCPeerConnection = class BrokenRTCPeerConnection {
				constructor() {
					throw new Error('WebRTC disabled for relay test');
				}
			};
		});
		const pageB = await contextB.newPage();

		await joinRoom(page, roomId);
		await joinRoom(pageB, roomId);

		await waitForConnectionStatus(page, ['Connected', 'Reconnecting', 'Connecting']);
		await waitForConnectionStatus(pageB, ['Connected', 'Reconnecting', 'Connecting']);
		await waitForP2PSync(2000);

		await sendMessage(page, 'relay-only-message');
		await expect(
			pageB.locator('[data-testid="message-list"]').getByText('relay-only-message')
		).toBeVisible({ timeout: 15000 });
		const relayFrames = await page.evaluate(() => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			return (window as any).__relayFrames || [];
		});

		expect(relayFrames.length).toBeGreaterThan(0);
		// No plaintext anywhere in any relay frame (PROTOCOL.md §3.6)
		const relayContainsPlaintext = relayFrames.some((frame: unknown) =>
			JSON.stringify(frame).includes('relay-only-message')
		);
		expect(relayContainsPlaintext).toBeFalsy();

		// Every relayed message is a v3 envelope: nonce + ciphertext
		const hasEncryptedEnvelope = relayFrames.some(
			(frame: { data?: { envelope?: { v?: number; c?: string; n?: string } } }) =>
				frame?.data?.envelope?.v === 3 &&
				typeof frame.data.envelope.c === 'string' &&
				frame.data.envelope.c.length > 0 &&
				typeof frame.data.envelope.n === 'string'
		);
		expect(hasEncryptedEnvelope).toBeTruthy();

		// Relay honesty (§3.6): the UI says the server is carrying traffic
		await expect(page.locator('[data-testid="connection-status"]')).toHaveText(
			/relayed via server/
		);

		// Drafts (eph, per-keystroke) must never transit the relay (§3.6)
		await page.locator('[data-testid="message-input"]').fill('draft never relays');
		await page.waitForTimeout(1500);
		const ephFrames = await page.evaluate(() => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			return ((window as any).__relayFrames || []).filter(
				(frame: { data?: { envelope?: { t?: string } } }) => frame?.data?.envelope?.t === 'eph'
			);
		});
		expect(ephFrames).toHaveLength(0);

		await cleanup(contextB);
	});

	test('recovers after temporary network offline transition (chromium)', async ({
		page,
		context,
		browserName
	}) => {
		test.skip(browserName !== 'chromium', 'CDP network emulation requires Chromium');

		const roomId = generateTestRoomId('required-offline-online');
		await joinRoom(page, roomId);

		const statusBadge = page.locator('[data-testid="connection-status"]');
		await expect(statusBadge).toBeVisible({ timeout: 10000 });

		const cdp = await context.newCDPSession(page);
		await cdp.send('Network.emulateNetworkConditions', {
			offline: true,
			downloadThroughput: 0,
			uploadThroughput: 0,
			latency: 0
		});

		await page.waitForTimeout(2000);
		await expect(statusBadge).toBeVisible();

		await cdp.send('Network.emulateNetworkConditions', {
			offline: false,
			downloadThroughput: -1,
			uploadThroughput: -1,
			latency: 0
		});

		await expect(
			statusBadge
				.filter({ hasText: 'Connected' })
				.or(statusBadge.filter({ hasText: 'Reconnecting' }))
				.or(statusBadge.filter({ hasText: 'Connecting' }))
				.or(statusBadge.filter({ hasText: 'Local' }))
		).toBeVisible({ timeout: 15000 });
	});
});
