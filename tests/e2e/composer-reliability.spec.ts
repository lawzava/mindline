import { test, expect, type Page } from '@playwright/test';
import { generateTestRoomId, joinRoom } from './helpers/test-utils';

declare global {
	interface Window {
		composerCapture: {
			requests: number;
			stoppedTracks: number;
			resolvePermission: () => void;
			finishLimit: () => void;
		};
	}
}

async function mockCapture(page: Page, pending = false) {
	await page.addInitScript(
		({ pending }) => {
			const capture = (window.composerCapture = {
				requests: 0,
				stoppedTracks: 0,
				resolvePermission: () => {},
				finishLimit: () => {}
			});
			// Patch the prototype so every MediaDevices wrapper uses the fixture in WebKit.
			Object.defineProperty(Object.getPrototypeOf(navigator.mediaDevices), 'getUserMedia', {
				value: () => {
					capture.requests++;
					const stream = {
						getTracks: () => [
							{
								stop: () => {
									capture.stoppedTracks++;
								}
							}
						]
					};
					return new Promise((resolve) => {
						capture.resolvePermission = () => resolve(stream);
						if (!pending) capture.resolvePermission();
					});
				}
			});
			class FakeMediaRecorder {
				static isTypeSupported() {
					return true;
				}
				state = 'inactive';
				mimeType = 'audio/webm';
				ondataavailable: ((event: { data: Blob }) => void) | null = null;
				onstop: (() => void) | null = null;
				start() {
					this.state = 'recording';
				}
				stop() {
					this.state = 'inactive';
					queueMicrotask(() => {
						this.ondataavailable?.({ data: new Blob(['voice']) });
						this.onstop?.();
					});
				}
			}
			Object.defineProperty(window, 'MediaRecorder', { value: FakeMediaRecorder });
			const originalTimeout = window.setTimeout.bind(window);
			window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
				if (timeout === 600_000 && typeof handler === 'function') {
					capture.finishLimit = () => handler(...args);
					return 0;
				}
				return originalTimeout(handler, timeout, ...args);
			}) as typeof window.setTimeout;
		},
		{ pending }
	);
}

async function leaveRoom(page: Page) {
	await page.getByTestId('leave-room-btn').click();
	await page.getByRole('button', { name: 'Leave Room', exact: true }).click();
	await expect(page.getByTestId('create-room-btn')).toBeVisible();
}

test('IME confirmation preserves the draft until a non-composing Enter', async ({ page }) => {
	await joinRoom(page, generateTestRoomId());
	const input = page.getByTestId('message-input');
	await input.fill('こんにちは');
	await input.dispatchEvent('keydown', { key: 'Enter', isComposing: true });
	await expect(input).toHaveValue('こんにちは');
	// Safari can report the confirmation key with keyCode 229 after composition ends.
	await input.dispatchEvent('keydown', { key: 'Enter', keyCode: 229 });
	await expect(input).toHaveValue('こんにちは');
	await expect(page.getByTestId('message-bubble')).toHaveCount(0);
	await input.press('Enter');
	await expect(input).toHaveValue('');
	await expect(page.getByTestId('message-bubble')).toContainText('こんにちは');
});

test('sending a multiline draft restores the composer to one row', async ({ page }) => {
	await joinRoom(page, generateTestRoomId());
	const input = page.getByTestId('message-input');
	const initialHeight = await input.evaluate((element) => element.getBoundingClientRect().height);
	await input.fill('First line\nSecond line\nThird line\nFourth line');
	await expect
		.poll(() => input.evaluate((element) => element.getBoundingClientRect().height))
		.toBeGreaterThan(initialHeight);
	await input.press('Enter');
	await expect(input).toHaveValue('');
	await expect
		.poll(() => input.evaluate((element) => element.getBoundingClientRect().height))
		.toBeLessThanOrEqual(initialHeight + 1);
});

test('leaving the room releases an active microphone', async ({ page }) => {
	await mockCapture(page);
	await joinRoom(page, generateTestRoomId());
	await page.getByTestId('voice-btn').click();
	await expect.poll(() => page.evaluate(() => window.composerCapture.requests)).toBe(1);
	await expect(page.getByTestId('voice-stop-btn')).toBeVisible();
	await leaveRoom(page);
	await expect.poll(() => page.evaluate(() => window.composerCapture.stoppedTracks)).toBe(1);
});

test('leaving during microphone permission releases the eventual stream', async ({ page }) => {
	await mockCapture(page, true);
	await joinRoom(page, generateTestRoomId());
	await page.getByTestId('voice-btn').click();
	await expect.poll(() => page.evaluate(() => window.composerCapture.requests)).toBe(1);
	await leaveRoom(page);
	await page.evaluate(() => window.composerCapture.resolvePermission());
	await expect.poll(() => page.evaluate(() => window.composerCapture.stoppedTracks)).toBe(1);
});

test('the voice duration limit sends one completed note and restores the composer', async ({
	page
}) => {
	await mockCapture(page);
	await joinRoom(page, generateTestRoomId());
	await page.getByTestId('voice-btn').click();
	await expect.poll(() => page.evaluate(() => window.composerCapture.requests)).toBe(1);
	await expect(page.getByTestId('voice-stop-btn')).toBeVisible();
	await page.evaluate(() => window.composerCapture.finishLimit());
	await expect(page.getByTestId('voice-stop-btn')).toBeHidden();
	await expect(page.getByTestId('message-input')).toBeVisible();
	await expect(page.getByTestId('message-bubble')).toHaveCount(1);
	await expect.poll(() => page.evaluate(() => window.composerCapture.stoppedTracks)).toBe(1);
});
