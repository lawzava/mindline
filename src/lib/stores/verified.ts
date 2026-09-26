/**
 * Devices this person has verified by comparing safety numbers
 * (PROTOCOL.md §1.3). Device identities are per browser, not per room, so a
 * verification carries across rooms. Local only, never synced: it records a
 * decision this person made, not a fact any peer can assert.
 */

import { writable } from 'svelte/store';
import { browser } from '$app/environment';

export interface VerifiedDevice {
	/** Hex fingerprint of the device's keys at the time of verification. */
	fp: string;
	/** The name the device used when it was verified. */
	name: string;
	verifiedAt: number;
}

export type VerifiedMap = Record<string, VerifiedDevice>;

/**
 * - verified: this device, with these exact keys, was verified.
 * - changed: this device was verified, but now presents different keys.
 * - impostor: another device is using the name of a verified device.
 * - unverified: nothing known.
 */
export type VerifyStatus = 'verified' | 'changed' | 'impostor' | 'unverified';

const STORAGE_KEY = 'mindline_verified';

function load(): VerifiedMap {
	if (!browser) return {};
	try {
		const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
		return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
	} catch {
		return {};
	}
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function verifyStatus(
	map: VerifiedMap,
	deviceId: string,
	fp: string,
	name: string | undefined
): VerifyStatus {
	const entry = map[deviceId];
	if (entry) return entry.fp === fp ? 'verified' : 'changed';
	if (name?.trim() && Object.values(map).some((v) => sameName(v.name, name))) return 'impostor';
	return 'unverified';
}

function createVerifiedStore() {
	const { subscribe, update, set } = writable<VerifiedMap>(load());
	const persist = (map: VerifiedMap) => {
		if (browser) localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
		return map;
	};
	return {
		subscribe,
		mark(deviceId: string, fp: string, name: string) {
			update((m) => persist({ ...m, [deviceId]: { fp, name, verifiedAt: Date.now() } }));
		},
		unmark(deviceId: string) {
			update((m) => {
				const next = { ...m };
				delete next[deviceId];
				return persist(next);
			});
		},
		clear() {
			set(persist({}));
		}
	};
}

export const verified = createVerifiedStore();
