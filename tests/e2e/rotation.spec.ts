import { test, expect, type Page } from '@playwright/test';
import {
	cleanup,
	createSecondContext,
	generateTestRoomId,
	handleUnavailableP2P,
	keyFragmentFor,
	sendMessage,
	waitForConnectionStatus,
	waitForP2PSync,
	waitForPeersConnected
} from './helpers/test-utils';

/** Record the generation of every outgoing 'msg' envelope (PROTOCOL.md §1.4). */
async function hookSentGenerations(page: Page): Promise<void> {
	await page.addInitScript(() => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const w = window as any;
		w.__sentG = [];
		const originalSend = RTCDataChannel.prototype.send;
		RTCDataChannel.prototype.send = function (this: RTCDataChannel, data: unknown) {
			try {
				if (typeof data === 'string') {
					const parsed = JSON.parse(data);
					if (parsed?.v === 4 && parsed?.t === 'msg' && typeof parsed.g === 'number') {
						w.__sentG.push(parsed.g);
					}
				}
			} catch {
				/* binary frames */
			}
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			return originalSend.call(this, data as any);
		};
	});
}

const lastSent = (page: Page) =>
	page.evaluate(() => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const sent = ((window as any).__sentG || []) as number[];
		return sent.length ? sent[sent.length - 1] : -1;
	});

async function join(page: Page, roomId: string) {
	// A short rotation window so the test sees time-based rotation happen.
	await page.goto(`/${roomId}?fastConnect=true&rotateMs=8000${keyFragmentFor(roomId)}`);
	await waitForConnectionStatus(page);
}

test('an active generation rotates on time, with nobody joining or leaving', async ({
	page,
	browser
}) => {
	const roomId = generateTestRoomId('rotation');
	await hookSentGenerations(page);
	await join(page, roomId);
	const contextB = await createSecondContext(browser);
	const pageB = await contextB.newPage();
	await join(pageB, roomId);
	if (!(await waitForPeersConnected(page, pageB))) {
		await cleanup(contextB);
		handleUnavailableP2P('Rotation test failed: peers never connected');
	}

	// Let the join rotation settle, then note where the room is.
	let settled = -1;
	for (let i = 0; i < 10 && settled < 1; i++) {
		await sendMessage(page, `settle-${i}`);
		await waitForP2PSync(1500);
		settled = await lastSent(page);
	}
	expect(settled).toBeGreaterThanOrEqual(1);

	// Keep talking; the time window alone must move the generation on.
	let rotated = settled;
	for (let i = 0; i < 20 && rotated <= settled; i++) {
		await sendMessage(page, `tick-${i}`);
		await waitForP2PSync(1500);
		rotated = await lastSent(page);
	}
	expect(rotated).toBeGreaterThan(settled);

	// And both sides still talk after it.
	await sendMessage(pageB, 'still here after rotation');
	await expect(
		page.getByTestId('message-list').getByText('still here after rotation', { exact: true })
	).toBeVisible({ timeout: 10000 });
	await cleanup(contextB);
});
