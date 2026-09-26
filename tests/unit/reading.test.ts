import { beforeEach, describe, expect, test, vi } from 'vitest';
import { get } from 'svelte/store';

vi.mock('$app/environment', () => ({ browser: true }));

const memory = new Map<string, string>();
vi.stubGlobal('localStorage', {
	getItem: (k: string) => memory.get(k) ?? null,
	setItem: (k: string, v: string) => memory.set(k, String(v)),
	removeItem: (k: string) => memory.delete(k),
	clear: () => memory.clear()
});

const KEY = 'mindline_reading';

/** A fresh module, so the store loads from storage as on a page load. */
async function freshStore() {
	vi.resetModules();
	return import('$lib/stores/reading');
}

beforeEach(() => {
	memory.clear();
});

describe('reading settings store', () => {
	test('defaults to the normal reading experience', async () => {
		const { reading, DEFAULT_READING } = await freshStore();
		expect(get(reading)).toEqual({
			textSize: 'default',
			highContrast: false,
			steadyDrafts: false,
			readDraftsAloud: false
		});
		expect(get(reading)).toEqual(DEFAULT_READING);
	});

	test('changes persist under mindline_reading and survive a reload', async () => {
		const first = await freshStore();
		first.reading.change({ textSize: 'large', highContrast: true });
		expect(JSON.parse(memory.get(KEY)!)).toMatchObject({ textSize: 'large', highContrast: true });

		const second = await freshStore();
		expect(get(second.reading)).toEqual({
			textSize: 'large',
			highContrast: true,
			steadyDrafts: false,
			readDraftsAloud: false
		});
	});

	test('a bad value passed to change never persists', async () => {
		const { reading } = await freshStore();
		reading.change({ textSize: 'huge' as never, readDraftsAloud: true });
		expect(get(reading).textSize).toBe('default');
		expect(get(reading).readDraftsAloud).toBe(true);
		expect(JSON.parse(memory.get(KEY)!).textSize).toBe('default');
	});

	test('corrupt storage loads as defaults instead of throwing', async () => {
		memory.set(KEY, '{not json');
		const { reading, DEFAULT_READING } = await freshStore();
		expect(get(reading)).toEqual(DEFAULT_READING);
	});
});

describe('parseReading', () => {
	test('keeps the good fields and defaults the rest', async () => {
		const { parseReading } = await freshStore();
		expect(
			parseReading(
				JSON.stringify({ textSize: 'xlarge', highContrast: 'yes', steadyDrafts: true, extra: 1 })
			)
		).toEqual({
			textSize: 'xlarge',
			highContrast: false,
			steadyDrafts: true,
			readDraftsAloud: false
		});
	});

	test('non-object JSON and nothing stored are defaults', async () => {
		const { parseReading, DEFAULT_READING } = await freshStore();
		for (const raw of [null, '', 'null', '[]', '42', '"large"', '{"textSize":null}']) {
			expect(parseReading(raw)).toEqual(DEFAULT_READING);
		}
	});
});

describe('applyReading', () => {
	test('sets and clears the root attributes app.css keys on', async () => {
		const { applyReading, DEFAULT_READING } = await freshStore();
		const attrs = new Map<string, string>();
		const root = {
			setAttribute: (k: string, v: string) => void attrs.set(k, v),
			removeAttribute: (k: string) => void attrs.delete(k)
		};
		applyReading({ ...DEFAULT_READING, textSize: 'xlarge', highContrast: true }, root);
		expect(Object.fromEntries(attrs)).toEqual({
			'data-reading': 'xlarge',
			'data-contrast': 'high'
		});
		applyReading(DEFAULT_READING, root);
		expect(attrs.size).toBe(0);
	});
});
