import { test, expect } from '@playwright/test';
import { generateTestRoomId, keyFragmentFor, joinRoom } from './helpers/test-utils';

test('a message with no recipients is labelled local rather than delivered', async ({ page }) => {
	await joinRoom(page, generateTestRoomId('local-receipt'));
	await page.getByTestId('message-input').fill('A note before anyone joins');
	await page.getByTestId('send-btn').click();
	await expect(page.getByLabel('Local message; no recipients were connected')).toHaveText('Local');
});

test('a burn notification removes media committed before this tab received it', async ({
	page,
	context
}) => {
	const id = generateTestRoomId('burn-late-media');
	await joinRoom(page, id);
	await page.evaluate(async (roomId) => {
		await new Promise<void>((resolve, reject) => {
			const request = indexedDB.open('mindline-blobs', 1);
			request.onupgradeneeded = () => request.result.createObjectStore('blobs');
			request.onerror = () => reject(request.error);
			request.onsuccess = () => {
				const db = request.result;
				const tx = db.transaction('blobs', 'readwrite');
				tx.objectStore('blobs').put({ data: new ArrayBuffer(4) }, `${roomId}/late-transfer`);
				tx.oncomplete = () => {
					db.close();
					resolve();
				};
				tx.onabort = () => {
					db.close();
					reject(tx.error);
				};
			};
		});
	}, id);
	const other = await context.newPage();
	try {
		await other.goto('/');
		await other.evaluate((roomId) => {
			const channel = new BroadcastChannel('mindline_burn');
			channel.postMessage({ roomId });
			channel.close();
		}, id);
		await expect(page).toHaveURL(/\/$/);
		const remaining = await page.evaluate(
			async (roomId) =>
				new Promise<number>((resolve, reject) => {
					const request = indexedDB.open('mindline-blobs', 1);
					request.onerror = () => reject(request.error);
					request.onsuccess = () => {
						const db = request.result;
						const count = db
							.transaction('blobs')
							.objectStore('blobs')
							.count(`${roomId}/late-transfer`);
						count.onsuccess = () => {
							db.close();
							resolve(count.result);
						};
						count.onerror = () => {
							db.close();
							reject(count.error);
						};
					};
				}),
			id
		);
		expect(remaining).toBe(0);
	} finally {
		await other.close();
	}
});

test('touch message actions work with a keyboard', async ({ browser, baseURL }) => {
	const context = await browser.newContext({
		baseURL,
		viewport: { width: 390, height: 844 },
		hasTouch: true
	});
	try {
		const page = await context.newPage();
		await joinRoom(page, generateTestRoomId('touch-actions'));
		await page.getByTestId('message-input').fill('A message to edit');
		await page.getByTestId('send-btn').click();
		const actions = page.getByRole('button', { name: 'Message actions', exact: true });
		await expect(actions).toBeVisible();
		await actions.focus();
		await page.keyboard.press('Enter');
		await page.getByRole('button', { name: 'Edit', exact: true }).click();
		const edit = page.getByRole('textbox', { name: 'Edit message content' });
		await expect(edit).toBeVisible();
		await edit.fill('Edited on mobile');
		await edit.dispatchEvent('keydown', { key: 'Enter', isComposing: true });
		await expect(edit).toHaveValue('Edited on mobile');
		await edit.dispatchEvent('keydown', { key: 'Enter', keyCode: 229 });
		await expect(edit).toHaveValue('Edited on mobile');
		await page.getByRole('button', { name: 'Save edit' }).click();
		await expect(
			page.getByTestId('message-list').getByText('Edited on mobile', { exact: true })
		).toBeVisible();
	} finally {
		await context.close();
	}
});

test('recent room actions support keyboard activation without joining', async ({ page }) => {
	const id = generateTestRoomId('recent-keyboard');
	await page.addInitScript(
		({ id, key }) => {
			localStorage.setItem(
				'mindline_recentRooms',
				JSON.stringify([{ id, key, name: 'Weekend plans', lastActive: Date.now() }])
			);
		},
		{ id, key: keyFragmentFor(id).slice(1) }
	);
	await page.goto('/');
	await expect(page.getByTestId('create-room-btn')).toBeEnabled();
	await page.getByRole('button', { name: 'Rename room', exact: true }).focus();
	await page.keyboard.press('Enter');
	await expect(page.getByRole('textbox', { name: 'Room name', exact: true })).toBeVisible();
	await page.getByRole('textbox', { name: 'Room name', exact: true }).fill('Summer plans');
	await page.getByRole('button', { name: 'Save room name' }).focus();
	await page.keyboard.press('Enter');
	await expect(page.getByText('Summer plans', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Remove room from this list' }).focus();
	await page.keyboard.press('Space');
	await expect(page.getByTestId('recent-room')).toHaveCount(0);
	await expect(page).toHaveURL(/\/$/);
});

test('recent room actions remain visible on touch screens', async ({ browser, baseURL }) => {
	const context = await browser.newContext({
		baseURL,
		viewport: { width: 390, height: 844 },
		hasTouch: true
	});
	try {
		const page = await context.newPage();
		await page.addInitScript(() => {
			localStorage.setItem(
				'mindline_recentRooms',
				JSON.stringify([
					{ id: 'recent-touch', key: '', name: 'Weekend plans', lastActive: Date.now() }
				])
			);
		});
		await page.goto('/');
		await expect(page.getByTestId('create-room-btn')).toBeEnabled();
		await expect(page.getByRole('button', { name: 'Rename room', exact: true })).toHaveCSS(
			'opacity',
			'1'
		);
		await expect(page.getByRole('button', { name: 'Remove room from this list' })).toHaveCSS(
			'opacity',
			'1'
		);
	} finally {
		await context.close();
	}
});

test('a long recent room list leaves the start controls reachable', async ({ page }) => {
	await page.setViewportSize({ width: 800, height: 600 });
	await page.addInitScript(() => {
		localStorage.setItem(
			'mindline_recentRooms',
			JSON.stringify(
				Array.from({ length: 30 }, (_, i) => ({
					id: `recent-overflow-${i}`,
					key: '',
					name: `Conversation ${i}`,
					lastActive: Date.now() - i
				}))
			)
		);
	});
	await page.goto('/');
	await expect(page.getByTestId('create-room-btn')).toBeEnabled();
	await expect(page.getByRole('heading', { name: 'Talk on a live wire.' })).toBeInViewport();
	await page.getByTestId('create-room-btn').click();
	await expect(page.getByTestId('message-input')).toBeVisible();
});

test('copy invite falls back when the clipboard API rejects', async ({ page }) => {
	await page.addInitScript(() => {
		Object.defineProperty(navigator, 'clipboard', {
			value: {
				writeText: () => Promise.reject(new DOMException('Denied', 'NotAllowedError'))
			}
		});
		document.execCommand = (command) => command === 'copy';
	});
	await joinRoom(page, generateTestRoomId('copy-fallback'));
	await page.getByTestId('copy-room-btn').click();
	await expect(
		page.getByText('Invite link copied! Anyone with this link can read the room.')
	).toBeVisible();
});

test('sharing a saved room restores the key after a fragment-free revisit', async ({ page }) => {
	const id = generateTestRoomId('saved-invite');
	const fragment = keyFragmentFor(id);
	await page.addInitScript(() => {
		Object.defineProperty(navigator, 'clipboard', {
			value: {
				writeText: (value: string) => {
					localStorage.setItem('copied-invite', value);
					return Promise.resolve();
				}
			}
		});
	});
	await joinRoom(page, id);
	await page.goto(`/${id}`);
	await expect(page.getByTestId('message-input')).toBeVisible();
	await page.getByTestId('copy-room-btn').click();
	await expect
		.poll(() => page.evaluate(() => localStorage.getItem('copied-invite')))
		.toContain(fragment);
});

test('cancelling native sharing does not copy the private invite', async ({ page }) => {
	await page.addInitScript(() => {
		Object.defineProperty(navigator, 'share', {
			value: () => Promise.reject(new DOMException('Cancelled', 'AbortError'))
		});
		Object.defineProperty(navigator, 'clipboard', {
			value: {
				writeText: () => {
					localStorage.setItem('unexpected-copy', 'yes');
					return Promise.resolve();
				}
			}
		});
	});
	await joinRoom(page, generateTestRoomId('share-cancel'));
	await page.getByTestId('share-room-btn').click();
	await expect(
		page.getByText('Invite link copied! Anyone with this link can read the room.')
	).toHaveCount(0);
	await expect.poll(() => page.evaluate(() => localStorage.getItem('unexpected-copy'))).toBeNull();
});
