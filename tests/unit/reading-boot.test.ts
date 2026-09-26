import { readFileSync } from 'node:fs';
import { describe, expect, test, vi } from 'vitest';
import { applyReading, parseReading, READING_STORAGE_KEY } from '$lib/stores/reading';

vi.mock('$app/environment', () => ({ browser: false }));

// The pre-paint script is a static file (no bundler, no CSP hash): run it
// against a fake page and hold it to the app's own rules.
const BOOT = readFileSync('static/js/reading-boot.js', 'utf8');

class FakeRoot {
	attrs = new Map<string, string>();
	setAttribute(name: string, value: string) {
		this.attrs.set(name, value);
	}
	removeAttribute(name: string) {
		this.attrs.delete(name);
	}
}

function boot(stored: string | null, throwing = false): Map<string, string> {
	const root = new FakeRoot();
	const storage = {
		getItem: (key: string) => {
			if (throwing) throw new Error('blocked');
			return key === READING_STORAGE_KEY ? stored : null;
		}
	};
	new Function('localStorage', 'document', BOOT)(storage, { documentElement: root });
	return root.attrs;
}

function expected(stored: string | null): Map<string, string> {
	const root = new FakeRoot();
	applyReading(parseReading(stored), root);
	return root.attrs;
}

describe('reading settings before first paint', () => {
	test.each([
		null,
		'{"textSize":"large","highContrast":true}',
		'{"textSize":"xlarge"}',
		'{"highContrast":true,"textSize":"huge"}',
		'{"textSize":"default","highContrast":false}',
		'not json',
		'[1,2]',
		'{"textSize":7,"highContrast":"yes"}'
	])('stored %s: the same attributes the app would set', (stored) => {
		expect(boot(stored)).toEqual(expected(stored));
	});

	test('blocked storage leaves the defaults', () => {
		expect(boot(null, true)).toEqual(new Map());
	});
});
