/**
 * Room key lifecycle (PROTOCOL.md §1).
 *
 * The 256-bit room key lives only in the URL fragment. It is imported once
 * as non-extractable HKDF material; everything else works off derived,
 * non-extractable subkeys.
 */

import { fromB64url, toB64url } from './b64';

const HKDF_SALT = new TextEncoder().encode('mindline-v2');

export interface RoomKeys {
	/** AES-256-GCM for chat/control/sync envelopes */
	msg: CryptoKey;
	/** AES-256-GCM for drafts/presence envelopes */
	eph: CryptoKey;
	/** AES-256-GCM for at-rest history and blobs */
	storage: CryptoKey;
	/** HMAC-SHA-256 for handshake/signaling authentication */
	auth: CryptoKey;
	/** HKDF master material, kept for per-transfer media subkeys */
	material: CryptoKey;
}

export function createRoomKey(): Uint8Array {
	return crypto.getRandomValues(new Uint8Array(32));
}

export function toKeyFragment(key: Uint8Array): string {
	return `k=${toB64url(key)}`;
}

/** Parse a location.hash value ('#k=...') into the raw room key. */
export function parseKeyFragment(hash: string): Uint8Array | null {
	const match = /^#?k=([A-Za-z0-9_-]+)$/.exec(hash);
	if (!match) return null;
	const bytes = fromB64url(match[1]);
	return bytes && bytes.length === 32 ? bytes : null;
}

export async function importRoomKeyMaterial(rawKey: Uint8Array): Promise<CryptoKey> {
	return crypto.subtle.importKey('raw', rawKey as BufferSource, 'HKDF', false, ['deriveKey']);
}

async function deriveAesKey(material: CryptoKey, info: string): Promise<CryptoKey> {
	return crypto.subtle.deriveKey(
		{ name: 'HKDF', hash: 'SHA-256', salt: HKDF_SALT, info: new TextEncoder().encode(info) },
		material,
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt', 'decrypt']
	);
}

export async function deriveRoomKeys(material: CryptoKey): Promise<RoomKeys> {
	const [msg, eph, storage, auth] = await Promise.all([
		deriveAesKey(material, 'mindline/v2/msg'),
		deriveAesKey(material, 'mindline/v2/eph'),
		deriveAesKey(material, 'mindline/v2/storage'),
		crypto.subtle.deriveKey(
			{
				name: 'HKDF',
				hash: 'SHA-256',
				salt: HKDF_SALT,
				info: new TextEncoder().encode('mindline/v2/auth')
			},
			material,
			{ name: 'HMAC', hash: 'SHA-256' },
			false,
			['sign', 'verify']
		)
	]);
	return { msg, eph, storage, auth, material };
}

/** Per-transfer media subkey (PROTOCOL.md §5.2). */
export async function deriveMediaKey(material: CryptoKey, transferId: string): Promise<CryptoKey> {
	return deriveAesKey(material, `mindline/v2/media/${transferId}`);
}
