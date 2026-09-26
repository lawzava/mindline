import { test, expect } from '@playwright/test';

// Reading mode (RTT): the settings live on this device and on <html>, so a
// single page covers them; no peers or signaling needed.
test.describe('Reading mode', () => {
	/** The landing buttons enable on mount: the page is hydrated. */
	async function hydrated(page: import('@playwright/test').Page) {
		await expect(page.getByTestId('create-room-btn')).toBeEnabled({ timeout: 15000 });
	}

	test.beforeEach(async ({ page }) => {
		await page.goto('/');
		await page.evaluate(() => localStorage.removeItem('mindline_reading'));
		await page.reload();
		await hydrated(page);
	});

	test('large text and high contrast apply to the root and survive a reload', async ({ page }) => {
		const html = page.locator('html');
		await expect(html).not.toHaveAttribute('data-reading', /.*/);
		await expect(html).not.toHaveAttribute('data-contrast', /.*/);

		const trigger = page.getByTestId('reading-settings-btn');
		await expect(trigger).toBeVisible();
		await expect(trigger).toHaveAccessibleName(/Reading/);
		await trigger.click();

		const settings = page.getByTestId('reading-settings');
		await expect(settings).toBeVisible();
		// The radios are visually hidden inside their labels; click the label.
		await settings.getByText('Large', { exact: true }).click();
		await expect(page.getByTestId('reading-size-large')).toBeChecked();
		await page.getByTestId('reading-contrast').check();

		await expect(html).toHaveAttribute('data-reading', 'large');
		await expect(html).toHaveAttribute('data-contrast', 'high');
		// Root rem scaling: 112.5% of the browser default.
		expect(await html.evaluate((el) => getComputedStyle(el).fontSize)).toBe('18px');

		const stored = await page.evaluate(() => localStorage.getItem('mindline_reading'));
		expect(JSON.parse(stored ?? '{}')).toMatchObject({ textSize: 'large', highContrast: true });

		await page.reload();
		await hydrated(page);
		await expect(html).toHaveAttribute('data-reading', 'large');
		await expect(html).toHaveAttribute('data-contrast', 'high');

		await page.getByTestId('reading-settings-btn').click();
		await expect(page.getByTestId('reading-size-large')).toBeChecked();
		await expect(page.getByTestId('reading-contrast')).toBeChecked();
	});

	test('back to default text and normal contrast clears the root attributes', async ({ page }) => {
		const html = page.locator('html');
		await page.getByTestId('reading-settings-btn').click();
		const settings = page.getByTestId('reading-settings');
		await settings.getByText('Extra large', { exact: true }).click();
		await expect(html).toHaveAttribute('data-reading', 'xlarge');

		await settings.getByText('Default', { exact: true }).click();
		await expect(html).not.toHaveAttribute('data-reading', /.*/);
		await page.getByTestId('reading-contrast').check();
		await page.getByTestId('reading-contrast').uncheck();
		await expect(html).not.toHaveAttribute('data-contrast', /.*/);
	});

	test('steady drafts is locked on when the device reduces motion', async ({ page }) => {
		await page.emulateMedia({ reducedMotion: 'reduce' });
		await page.getByTestId('reading-settings-btn').click();
		const steady = page.getByTestId('reading-steady');
		await expect(steady).toBeChecked();
		await expect(steady).toBeDisabled();
	});
});

test('in a room on a phone, the reading control sits in the header without covering the name', async ({
	browser,
	baseURL
}) => {
	const { generateTestRoomId, joinRoom } = await import('./helpers/test-utils');
	const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } });
	try {
		const page = await context.newPage();
		await joinRoom(page, generateTestRoomId('reading-header'));
		const reading = page.getByRole('button', { name: /Reading/ });
		const name = page.getByTestId('copy-room-btn');
		await expect(reading).toBeVisible();
		const a = (await reading.boundingBox())!;
		const b = (await name.boundingBox())!;
		const overlap =
			a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
		expect(overlap).toBe(false);
	} finally {
		await context.close();
	}
});
