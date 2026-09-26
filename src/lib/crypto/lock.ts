/**
 * Passkey lock (PROTOCOL.md §4): the key that opens this device's room
 * records, derived from a passkey's PRF output. It lives in this tab's
 * memory only; every new tab, reload, or "Lock now" starts locked.
 */

import { lp } from './lp';

export class LockedError extends Error {
	constructor() {
		super('Mindline is locked on this device');
		this.name = 'LockedError';
	}
}

let active: CryptoKey | null = null;

/** AES-256-GCM, non-extractable, from the passkey's PRF output. */
export async function deriveLockKey(prf: Uint8Array, salt: Uint8Array): Promise<CryptoKey> {
	const material = await crypto.subtle.importKey('raw', prf as BufferSource, 'HKDF', false, [
		'deriveKey'
	]);
	return crypto.subtle.deriveKey(
		{
			name: 'HKDF',
			hash: 'SHA-256',
			salt: salt as BufferSource,
			info: lp('mindline/v1/device-lock')
		},
		material,
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt', 'decrypt']
	);
}

export function activeLockKey(): CryptoKey | null {
	return active;
}

export function setActiveLockKey(key: CryptoKey): void {
	active = key;
}

export function isUnlocked(): boolean {
	return active !== null;
}

/** Forget the key in this tab. Anything already open keeps its own keys. */
export function lockNow(): void {
	active = null;
}
