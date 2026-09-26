import { test, expect, type Page } from '@playwright/test';
import {
	cleanup,
	createRoom,
	createSecondContext,
	joinRoom,
	sendMessage,
	waitForMessage
} from './helpers/test-utils';

/** Record every envelope this page sends on a data channel (test-side only). */
async function recordSends(page: Page) {
	await page.addInitScript(() => {
		const sent: string[] = [];
		(window as unknown as { __sent: string[] }).__sent = sent;
		const original = RTCDataChannel.prototype.send;
		RTCDataChannel.prototype.send = function (data: string | Blob | ArrayBuffer | ArrayBufferView) {
			if (typeof data === 'string') sent.push(data);
			return original.call(this, data as never);
		};
	});
}

const chainedSends = (page: Page) =>
	page.evaluate(
		() =>
			(window as unknown as { __sent: string[] }).__sent.filter((s) => {
				try {
					const e = JSON.parse(s);
					return typeof e.k === 'string' && Number.isInteger(e.i);
				} catch {
					return false;
				}
			}).length
	);

async function letIn(host: Page) {
	const request = host.getByTestId('admission-request');
	await expect(request).toBeVisible({ timeout: 30000 });
	await request.getByRole('button', { name: 'Let in' }).click();
}

test('with a new key for every message, members still talk, and newcomers join in', async ({
	page,
	browser
}) => {
	await recordSends(page);
	const roomId = await createRoom(page);
	const contextB = await createSecondContext(browser);
	const pageB = await contextB.newPage();
	await joinRoom(pageB, roomId);
	await letIn(page);
	await expect(pageB.getByTestId('admission-waiting')).toBeHidden({ timeout: 15000 });

	await page.getByTestId('room-menu-btn').click();
	await page.getByTestId('chains-toggle').click();
	await expect(page.getByTestId('chains-toggle')).toContainText('On');
	await page.keyboard.press('Escape');

	await sendMessage(page, 'chained hello');
	await waitForMessage(pageB, 'chained hello', 20000);
	await sendMessage(pageB, 'chained reply');
	await waitForMessage(page, 'chained reply', 20000);
	expect(await chainedSends(page)).toBeGreaterThan(0);

	// A member reloads: it gets history and new chained messages again.
	await pageB.reload();
	await waitForMessage(pageB, 'chained hello', 30000);
	await sendMessage(page, 'after the reload');
	await waitForMessage(pageB, 'after the reload', 30000);

	const contextC = await createSecondContext(browser);
	const pageC = await contextC.newPage();
	await joinRoom(pageC, roomId);
	await letIn(page);
	await expect(pageC.getByTestId('admission-waiting')).toBeHidden({ timeout: 15000 });
	await sendMessage(page, 'for everyone now');
	await waitForMessage(pageC, 'for everyone now', 20000);
	await waitForMessage(pageB, 'for everyone now', 20000);
	await sendMessage(pageC, 'C is here');
	await waitForMessage(pageB, 'C is here', 20000);

	await cleanup(contextC);
	await cleanup(contextB);
});
