import { test, expect, devices } from '@playwright/test';
import { joinRoom, generateTestRoomId, sendMessage } from './helpers/test-utils';

// Regression guard for the mobile bubble collapse: a percentage max-width on the
// bubble resolved against its shrink-to-fit flex row, so on touch devices (no
// hover-action siblings in the row) short messages wrapped mid-word ("Veik" ->
// "Ve"/"ik"). Bubbles must lay text out on one line when there is room for it.
test.use({ ...devices['Pixel 5'] });

test.describe('Mobile message rendering', () => {
	test.describe.configure({ mode: 'serial' });

	test('short messages render on a single line', async ({ page }) => {
		const roomId = generateTestRoomId();
		await joinRoom(page, roomId);

		await sendMessage(page, 'Veik');
		await sendMessage(page, 'klausiu ar veik?');

		const paragraphs = page.locator('[data-testid="message-bubble"] p');
		await expect(paragraphs).toHaveCount(2);

		for (const text of ['Veik', 'klausiu ar veik?']) {
			const p = paragraphs.filter({ hasText: text }).first();
			const metrics = await p.evaluate((el) => {
				const cs = getComputedStyle(el);
				return {
					height: el.getBoundingClientRect().height,
					lineHeight: parseFloat(cs.lineHeight),
					width: el.getBoundingClientRect().width
				};
			});
			// One rendered line: height stays below two line boxes.
			expect(metrics.height, `"${text}" wrapped (${JSON.stringify(metrics)})`).toBeLessThan(
				metrics.lineHeight * 1.8
			);
		}
	});

	test('long messages use most of the available width before wrapping', async ({ page }) => {
		const roomId = generateTestRoomId();
		await joinRoom(page, roomId);

		const long = 'this is a deliberately long message that must wrap close to the layout cap';
		await sendMessage(page, long);

		const p = page.locator('[data-testid="message-bubble"] p').filter({ hasText: long }).first();
		const { width, viewport } = await p.evaluate((el) => ({
			width: el.getBoundingClientRect().width,
			viewport: window.innerWidth
		}));
		// The old circular max-width collapsed long text to ~25% of the viewport.
		expect(width).toBeGreaterThan(viewport * 0.5);
	});
});
