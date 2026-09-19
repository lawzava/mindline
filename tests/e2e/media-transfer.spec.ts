import { test, expect, type Page } from '@playwright/test';
import {
	generateTestRoomId,
	joinRoom,
	createSecondContext,
	waitForPeersConnected
} from './helpers/test-utils';

declare global {
	interface Window {
		mediaGrantGate: { blocked: number; release: () => void };
	}
}

async function delayGrantEncryption(page: Page) {
	await page.addInitScript(() => {
		let held = true;
		const waiting: (() => void)[] = [];
		window.mediaGrantGate = {
			blocked: 0,
			release: () => {
				held = false;
				waiting.splice(0).forEach((resolve) => resolve());
			}
		};
		const encrypt = crypto.subtle.encrypt.bind(crypto.subtle);
		crypto.subtle.encrypt = async (algorithm, key, data) => {
			let isGrant = false;
			try {
				isGrant = JSON.parse(new TextDecoder().decode(data)).type === 'rekey-grant';
			} catch {
				// Media bytes and wrapped secrets are not JSON message bodies.
			}
			if (held && isGrant) {
				window.mediaGrantGate.blocked++;
				await new Promise<void>((resolve) => waiting.push(resolve));
			}
			return encrypt(algorithm, key, data);
		};
	});
}

test('a file offered during key rotation arrives after delayed grant encryption', async ({
	page,
	browser
}) => {
	const room = generateTestRoomId('media-rekey');
	const receiver = await createSecondContext(browser);
	try {
		const peer = await receiver.newPage();
		await delayGrantEncryption(page);
		await delayGrantEncryption(peer);
		await joinRoom(page, room);
		await joinRoom(peer, room);
		expect(await waitForPeersConnected(page, peer)).toBe(true);
		await expect
			.poll(async () => {
				const counts = await Promise.all(
					[page, peer].map((p) => p.evaluate(() => window.mediaGrantGate.blocked))
				);
				return counts[0] + counts[1];
			})
			.toBeGreaterThan(0);
		const sender = (await page.evaluate(() => window.mediaGrantGate.blocked)) > 0 ? page : peer;
		const recipient = sender === page ? peer : page;
		await sender.getByTestId('file-input').setInputFiles({
			name: 'during-rotation.bin',
			mimeType: 'application/octet-stream',
			buffer: Buffer.alloc(6 * 1024 * 1024, 7)
		});
		await expect(sender.getByTestId('media-attachment')).toBeVisible();
		// Keep the grant blocked while the offer attempts to use the new key.
		await sender.waitForTimeout(1000);
		await Promise.all([page, peer].map((p) => p.evaluate(() => window.mediaGrantGate.release())));
		await expect(recipient.getByTestId('media-consent')).toBeVisible();
		await recipient.getByTestId('media-consent').getByRole('button', { name: 'Accept' }).click();
		await expect(recipient.getByTestId('media-attachment')).toHaveAttribute('data-state', 'ready', {
			timeout: 30000
		});
	} finally {
		await receiver.close();
	}
});

test('file transfer preserves every byte and survives receiver reload', async ({
	page,
	browser
}) => {
	const room = generateTestRoomId('media-bytes');
	const receiver = await createSecondContext(browser);
	try {
		const peer = await receiver.newPage();
		await joinRoom(page, room);
		await joinRoom(peer, room);
		expect(await waitForPeersConnected(page, peer)).toBe(true);
		const payload = Buffer.alloc(512 * 1024 + 37);
		for (let i = 0; i < payload.length; i++) payload[i] = i % 251;
		await page.getByTestId('file-input').setInputFiles({
			name: 'transfer-proof.bin',
			mimeType: 'application/octet-stream',
			buffer: payload
		});
		await expect(peer.getByTestId('media-attachment')).toHaveAttribute('data-state', 'ready', {
			timeout: 30000
		});
		await peer.reload();
		const file = peer.getByTestId('media-file');
		await expect(file).toHaveAttribute('href', /^blob:/, { timeout: 15000 });
		const downloaded = peer.waitForEvent('download');
		await file.click();
		const download = await downloaded;
		expect(download.suggestedFilename()).toBe('transfer-proof.bin');
		const stream = await download.createReadStream();
		expect(stream).not.toBeNull();
		const chunks: Buffer[] = [];
		for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
		expect(Buffer.concat(chunks).equals(payload)).toBe(true);
	} finally {
		await receiver.close();
	}
});

test('declining a large file ends the transfer and another file still arrives', async ({
	page,
	browser
}) => {
	const room = generateTestRoomId('media-consent');
	const receiver = await createSecondContext(browser);
	try {
		const peer = await receiver.newPage();
		await joinRoom(page, room);
		await joinRoom(peer, room);
		expect(await waitForPeersConnected(page, peer)).toBe(true);
		await page.getByTestId('file-input').setInputFiles({
			name: 'large-proof.bin',
			mimeType: 'application/octet-stream',
			buffer: Buffer.alloc(6 * 1024 * 1024, 9)
		});
		await expect(peer.getByTestId('media-consent')).toBeVisible();
		await peer.getByTestId('media-consent').getByRole('button', { name: 'Decline' }).click();
		await expect(peer.getByTestId('media-consent')).toHaveCount(0);
		await expect(peer.getByTestId('media-attachment').first()).toHaveAttribute(
			'data-state',
			'failed'
		);
		await page.getByTestId('file-input').setInputFiles({
			name: 'next-proof.txt',
			mimeType: 'text/plain',
			buffer: Buffer.from('The next file arrives.')
		});
		await expect(peer.getByTestId('media-attachment').last()).toHaveAttribute(
			'data-state',
			'ready',
			{ timeout: 30000 }
		);
	} finally {
		await receiver.close();
	}
});
