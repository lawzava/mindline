/**
 * Safety numbers (PROTOCOL.md §1.3): a way for two people to confirm, out
 * of band, that the device they are talking to holds the keys they expect.
 * The link proves membership, not identity; this proves identity.
 */

import { lp } from './lp';

/**
 * A device's fingerprint covers both public keys it presents in the hello:
 * the ECDSA SPKI (which also names the deviceId) and the X-Wing KEM key
 * that receives key-generation grants. Substituting either changes it.
 */
export async function deviceFingerprint(spkiB64: string, kemB64: string): Promise<Uint8Array> {
	const digest = await crypto.subtle.digest(
		'SHA-256',
		lp('mindline/safety/v1/device', spkiB64, kemB64)
	);
	return new Uint8Array(digest);
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
	for (let i = 0; i < Math.min(a.length, b.length); i++) {
		if (a[i] !== b[i]) return a[i] - b[i];
	}
	return a.length - b.length;
}

/**
 * The pair's safety number: 60 digits in 12 groups of 5, identical on both
 * sides (the fingerprints are sorted first). Each group is 5 bytes of a
 * SHA-512 digest reduced mod 100000, the same construction as Signal's.
 */
export async function safetyNumber(a: Uint8Array, b: Uint8Array): Promise<string> {
	const [lo, hi] = compareBytes(a, b) <= 0 ? [a, b] : [b, a];
	const digest = new Uint8Array(
		await crypto.subtle.digest('SHA-512', lp('mindline/safety/v1/pair', toHex(lo), toHex(hi)))
	);
	const groups: string[] = [];
	for (let i = 0; i < 12; i++) {
		let n = 0;
		for (let j = 0; j < 5; j++) n = n * 256 + digest[i * 5 + j];
		groups.push(String(n % 100000).padStart(5, '0'));
	}
	return groups.join(' ');
}

export function toHex(bytes: Uint8Array): string {
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
