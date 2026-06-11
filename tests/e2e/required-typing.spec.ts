import { test, expect, type Page } from '@playwright/test';
import {
	createSecondContext,
	cleanup,
	generateTestRoomId,
	joinRoom,
	sendMessage,
	waitForMessage,
	waitForPeersConnected,
	handleUnavailableP2P
} from './helpers/test-utils';

/**
 * Blocking coverage for the product's defining feature (live typing) and
 * its core security claim (ciphertext-only wire). PROTOCOL.md §7.
 */

const WIRE_HOOK = () => {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	(window as any).__wireFrames = [];
	const originalSend = RTCDataChannel.prototype.send;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	(RTCDataChannel.prototype as any).send = function (data: string | ArrayBuffer) {
		try {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(window as any).__wireFrames.push({
				label: this.label,
				kind: typeof data,
				text: typeof data === 'string' ? data : `<binary:${(data as ArrayBuffer).byteLength}>`
			});
		} catch {
			/* instrumentation must never break the app */
		}
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		return (originalSend as any).call(this, data);
	};
};

async function getWireFrames(page: Page): Promise<{ label: string; kind: string; text: string }[]> {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return page.evaluate(() => (window as any).__wireFrames ?? []);
}

test.describe('Required Live Typing + Wire Encryption', () => {
	test.describe.configure({ mode: 'serial' });

	test('peer sees the draft grow progressively before send', async ({ page, browser }) => {
		const roomId = generateTestRoomId('required-typing');
		const contextB = await createSecondContext(browser);
		const pageB = await contextB.newPage();

		await joinRoom(page, roomId);
		await joinRoom(pageB, roomId);

		const connected = await waitForPeersConnected(page, pageB);
		if (!connected) handleUnavailableP2P('P2P unavailable for typing test');

		const draft = pageB.locator('[data-testid="draft-indicator"]');
		const phrase = 'watch this thought form letter by letter';

		const input = page.locator('[data-testid="message-input"]');
		await input.click();

		// Type in three bursts; after each, the peer's draft must show the
		// grown prefix — a progressive assertion, not a final-state check.
		let typedSoFar = 0;
		for (const cut of [10, 24, phrase.length]) {
			await input.pressSequentially(phrase.slice(typedSoFar, cut), { delay: 40 });
			await expect(draft).toContainText(phrase.slice(0, cut), { timeout: 5000 });
			typedSoFar = cut;
		}

		// Draft persists (no auto-vanish) until send...
		await page.waitForTimeout(4000);
		await expect(draft).toContainText(phrase);

		// ...and resolves into the real message on Enter.
		await input.press('Enter');
		await waitForMessage(pageB, phrase);
		await expect(draft).toBeHidden({ timeout: 5000 });

		await cleanup(contextB);
	});

	test('nothing leaves the device in plaintext on any DataChannel', async ({ page, browser }) => {
		const roomId = generateTestRoomId('required-wire');
		await page.addInitScript(WIRE_HOOK);

		const contextB = await createSecondContext(browser);
		const pageB = await contextB.newPage();

		await joinRoom(page, roomId);
		await joinRoom(pageB, roomId);

		const connected = await waitForPeersConnected(page, pageB);
		if (!connected) handleUnavailableP2P('P2P unavailable for wire test');

		const marker = 'WIREMARKER_do_not_leak_9000';
		const draftMarker = 'DRAFTMARKER_mid_flight_7000';

		const input = page.locator('[data-testid="message-input"]');
		await input.click();
		await input.pressSequentially(draftMarker, { delay: 20 });
		await input.fill(marker);
		await input.press('Enter');
		await waitForMessage(pageB, marker);

		const frames = await getWireFrames(page);
		expect(frames.length).toBeGreaterThan(0);

		// No plaintext marker in anything that left this device.
		const leaked = frames.filter(
			(f) => f.text.includes(marker) || f.text.includes(draftMarker)
		);
		expect(leaked).toEqual([]);

		// Both channels carried v3 envelopes (nonce + ciphertext + generation,
		// no content field).
		const chatEnvelopes = frames.filter((f) => {
			if (f.label !== 'chat' || f.kind !== 'string') return false;
			try {
				const env = JSON.parse(f.text);
				return (
					env.v === 3 &&
					typeof env.g === 'number' &&
					typeof env.c === 'string' &&
					typeof env.n === 'string' &&
					env.sig
				);
			} catch {
				return false;
			}
		});
		const ephEnvelopes = frames.filter((f) => {
			if (f.label !== 'eph' || f.kind !== 'string') return false;
			try {
				const env = JSON.parse(f.text);
				return env.v === 3 && typeof env.c === 'string';
			} catch {
				return false;
			}
		});
		expect(chatEnvelopes.length).toBeGreaterThan(0);
		expect(ephEnvelopes.length).toBeGreaterThan(0);

		await cleanup(contextB);
	});

	test('a visitor without the key fragment is locked out', async ({ page, browser }) => {
		const roomId = generateTestRoomId('required-knock');
		const contextB = await createSecondContext(browser);
		const pageB = await contextB.newPage();

		await joinRoom(page, roomId);
		await sendMessage(page, 'private words');

		// Same room id, NO fragment, fresh profile: knocking, no content.
		await pageB.goto(`/${roomId}?fastConnect=true`);
		await expect(pageB.locator('[data-testid="knocking-state"]')).toBeVisible({ timeout: 10000 });
		await expect(pageB.getByText('private words')).toHaveCount(0);

		await cleanup(contextB);
	});

	test('revisiting without the fragment opens history from stored keys', async ({ page }) => {
		const roomId = generateTestRoomId('required-revisit');
		await joinRoom(page, roomId);
		await sendMessage(page, 'remembered across visits');
		await page.waitForTimeout(500);

		// Same browser profile, fragment-less URL: keys come from IndexedDB.
		await page.goto(`/${roomId}?fastConnect=true`);
		await waitForMessage(page, 'remembered across visits');
		await expect(page.locator('[data-testid="knocking-state"]')).toHaveCount(0);
	});
});
