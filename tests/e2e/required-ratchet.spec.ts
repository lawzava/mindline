import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import {
	generateTestRoomId,
	joinRoom,
	sendMessage,
	waitForMessage,
	waitForP2PSync,
	createSecondContext,
	cleanup,
	waitForPeersConnected,
	handleUnavailableP2P
} from './helpers/test-utils';

/**
 * Generation ratchet E2E (PROTOCOL.md §1.4/§7): a newcomer join bumps the
 * key generation and both sides converge; concurrent tabs of one device
 * never censor each other; relay-only peers are honestly shown as
 * stranded by a rotation they cannot receive.
 */

/** Record every outgoing v3 'msg' envelope's generation on the page. */
async function hookSentGenerations(target: Page | BrowserContext): Promise<void> {
	await target.addInitScript(() => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(window as any).__sentG = [];
		const originalSend = RTCDataChannel.prototype.send;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(RTCDataChannel.prototype as any).send = function (data: unknown) {
			try {
				if (typeof data === 'string') {
					const parsed = JSON.parse(data);
					if (parsed?.v === 3 && parsed?.t === 'msg' && typeof parsed.g === 'number') {
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						(window as any).__sentG.push(parsed.g);
					}
				}
			} catch {
				/* binary frames and non-JSON payloads */
			}
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			return originalSend.call(this, data as any);
		};
	});
}

async function lastSentGeneration(page: Page): Promise<number> {
	return page.evaluate(() => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const sent = ((window as any).__sentG || []) as number[];
		return sent.length ? sent[sent.length - 1] : -1;
	});
}

/** Send probes until the page's outgoing chat envelopes carry g ≥ 1. */
async function waitForGenerationBump(page: Page, label: string): Promise<number> {
	for (let i = 0; i < 12; i++) {
		await sendMessage(page, `${label}-probe-${i}`);
		await waitForP2PSync(1200);
		const g = await lastSentGeneration(page);
		if (g >= 1) return g;
	}
	return -1;
}

const brokenWebRTC = () => {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	(window as any).RTCPeerConnection = class BrokenRTCPeerConnection {
		constructor() {
			throw new Error('WebRTC disabled for ratchet relay test');
		}
	};
};

test.describe('Required Ratchet', () => {
	test.describe.configure({ mode: 'serial' });

	test('a newcomer join bumps the generation and both sides keep chatting', async ({
		page,
		browser
	}) => {
		const roomId = generateTestRoomId('required-ratchet');
		await hookSentGenerations(page);
		await joinRoom(page, roomId);

		const contextB = await createSecondContext(browser);
		await hookSentGenerations(contextB);
		const pageB = await contextB.newPage();
		await joinRoom(pageB, roomId);

		const connected = await waitForPeersConnected(page, pageB);
		if (!connected) {
			await cleanup(contextB);
			handleUnavailableP2P('Required ratchet test failed: peers never connected');
		}

		// The join trigger (§1.4) is debounced and minter-selected; probe
		// until this side's outgoing envelopes carry the new generation.
		const gA = await waitForGenerationBump(page, 'bump-a');
		expect(gA, 'newcomer join must rotate the room key generation').toBeGreaterThanOrEqual(1);

		// Convergence: chat still flows in both directions, and the other
		// side sends at the same generation.
		await sendMessage(page, 'post-rotation-from-a');
		await expect(
			pageB.locator('[data-testid="message-list"]').getByText('post-rotation-from-a')
		).toBeVisible({ timeout: 10000 });

		await sendMessage(pageB, 'post-rotation-from-b');
		await expect(
			page.locator('[data-testid="message-list"]').getByText('post-rotation-from-b')
		).toBeVisible({ timeout: 10000 });
		const gB = await lastSentGeneration(pageB);
		expect(gB, 'both sides must converge on one generation').toBe(gA);

		await cleanup(contextB);
	});

	test('two tabs of one device send concurrently without replay self-censorship', async ({
		page,
		context
	}) => {
		const roomId = generateTestRoomId('required-two-tab');
		await joinRoom(page, roomId);

		// Same context: shared device identity and keystore — each tab draws
		// its own monotonic epoch (§2) and peers retain both (K-window).
		const tab2 = await context.newPage();
		await joinRoom(tab2, roomId);

		const connected = await waitForPeersConnected(page, tab2);
		if (!connected) {
			handleUnavailableP2P('Required two-tab test failed: tabs never connected');
		}

		// Interleaved sends from both tabs of the same device.
		await sendMessage(page, 'tab-one-first');
		await sendMessage(tab2, 'tab-two-first');
		await sendMessage(page, 'tab-one-second');
		await sendMessage(tab2, 'tab-two-second');

		for (const text of ['tab-one-first', 'tab-one-second']) {
			await expect(tab2.locator('[data-testid="message-list"]').getByText(text)).toBeVisible({
				timeout: 10000
			});
		}
		for (const text of ['tab-two-first', 'tab-two-second']) {
			await expect(page.locator('[data-testid="message-list"]').getByText(text)).toBeVisible({
				timeout: 10000
			});
		}

		await tab2.close();
	});

	test('a relay-only peer is stranded by rotation and the UI says so', async ({
		page,
		browser
	}) => {
		const roomId = generateTestRoomId('required-stranded');
		await hookSentGenerations(page);
		await joinRoom(page, roomId);

		// B joins direct: the join trigger rotates the room past the link
		// generation.
		const contextB = await createSecondContext(browser);
		const pageB = await contextB.newPage();
		await joinRoom(pageB, roomId);
		const connected = await waitForPeersConnected(page, pageB);
		if (!connected) {
			await cleanup(contextB);
			handleUnavailableP2P('Required stranded test failed: direct peers never connected');
		}
		const g = await waitForGenerationBump(page, 'stranded');
		expect(g).toBeGreaterThanOrEqual(1);

		// C joins with WebRTC disabled: relay-only. Grants never relay
		// (§1.4/§3.6), so C stays at the link generation.
		const contextC = await createSecondContext(browser);
		await contextC.addInitScript(brokenWebRTC);
		const pageC = await contextC.newPage();
		await joinRoom(pageC, roomId);
		await waitForP2PSync(4000);

		// A message sealed under the rotated generation must not be readable
		// by the stranded relay peer…
		await sendMessage(page, 'rotated-generation-secret');
		await expect(
			pageB.locator('[data-testid="message-list"]').getByText('rotated-generation-secret')
		).toBeVisible({ timeout: 10000 });
		await waitForP2PSync(4000);
		await expect(
			pageC.locator('[data-testid="message-list"]').getByText('rotated-generation-secret')
		).not.toBeVisible();

		// …and the UI tells the rotated side why (§3.6 relay honesty).
		await page.locator('[data-testid="peer-count"]').click();
		await expect(page.locator('[data-testid="rotation-stranded"]')).toBeVisible({
			timeout: 10000
		});

		await cleanup(contextC);
		await cleanup(contextB);
	});
});
