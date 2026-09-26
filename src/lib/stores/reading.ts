/**
 * Reading settings: the real-time text (RTT) reading mode. Deaf and
 * hard-of-hearing people already live on real-time text (FCC RTT, Apple
 * RTT, XEP-0301); these settings make the live wire comfortable to read
 * for long stretches. Device-local, never synced.
 *
 * Text size and contrast apply as attributes on <html> (see app.css):
 * text size scales the root rem, so the stream, drafts, and composer grow
 * together with the chrome around them. The draft settings are read by
 * LiveDraft directly.
 */

import { writable } from 'svelte/store';
import { browser } from '$app/environment';

export type TextSize = 'default' | 'large' | 'xlarge';

export interface ReadingSettings {
	textSize: TextSize;
	/** Stronger text tokens: >= 7:1 for body, draft, and muted text. */
	highContrast: boolean;
	/** Live drafts never breathe, fade in, or dim when idle. */
	steadyDrafts: boolean;
	/** Screen readers speak the peer's draft, a phrase at a time. */
	readDraftsAloud: boolean;
}

export const READING_STORAGE_KEY = 'mindline_reading';

export const TEXT_SIZES: readonly TextSize[] = ['default', 'large', 'xlarge'];

export const DEFAULT_READING: Readonly<ReadingSettings> = Object.freeze({
	textSize: 'default',
	highContrast: false,
	steadyDrafts: false,
	readDraftsAloud: false
});

/**
 * Parse stored settings field by field. Anything corrupt, missing, or from
 * a future version falls back to its default instead of discarding the
 * fields that are still good.
 */
export function parseReading(raw: string | null): ReadingSettings {
	const settings: ReadingSettings = { ...DEFAULT_READING };
	if (!raw) return settings;
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return settings;
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return settings;
	const p = parsed as Record<string, unknown>;
	if (TEXT_SIZES.includes(p.textSize as TextSize)) settings.textSize = p.textSize as TextSize;
	if (typeof p.highContrast === 'boolean') settings.highContrast = p.highContrast;
	if (typeof p.steadyDrafts === 'boolean') settings.steadyDrafts = p.steadyDrafts;
	if (typeof p.readDraftsAloud === 'boolean') settings.readDraftsAloud = p.readDraftsAloud;
	return settings;
}

function load(): ReadingSettings {
	if (!browser) return { ...DEFAULT_READING };
	try {
		return parseReading(localStorage.getItem(READING_STORAGE_KEY));
	} catch {
		/* storage blocked: read with defaults */
		return { ...DEFAULT_READING };
	}
}

function persist(settings: ReadingSettings): void {
	if (!browser) return;
	try {
		localStorage.setItem(READING_STORAGE_KEY, JSON.stringify(settings));
	} catch {
		/* storage full or blocked: the setting still holds for this visit */
	}
}

/** Root attributes the app.css reading rules key on. */
export function applyReading(
	settings: ReadingSettings,
	root: Pick<HTMLElement, 'setAttribute' | 'removeAttribute'>
): void {
	if (settings.textSize === 'default') root.removeAttribute('data-reading');
	else root.setAttribute('data-reading', settings.textSize);
	if (settings.highContrast) root.setAttribute('data-contrast', 'high');
	else root.removeAttribute('data-contrast');
}

function createReadingStore() {
	const { subscribe, update } = writable<ReadingSettings>(load());

	return {
		subscribe,

		/** Change one or more settings and remember them on this device. */
		change: (patch: Partial<ReadingSettings>) => {
			update((current) => {
				// Round-trip through the parser so a bad value never persists.
				const next = parseReading(JSON.stringify({ ...current, ...patch }));
				persist(next);
				return next;
			});
		}
	};
}

export const reading = createReadingStore();
