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
	/**
	 * AES-256-GCM for the handshake control plane (hello, rekey-grant,
	 * rekey-request — PROTOCOL.md §1.2/§3.4). Link-static so a joiner can be
	 * verified regardless of how far the room has ratcheted past it.
	 */
	hs: CryptoKey;
	/**
	 * HMAC-SHA-256 base for per-transfer media subkeys. HMAC keys survive
	 * structured clone into IndexedDB everywhere, unlike HKDF material.
	 */
	mediaBase: CryptoKey;
}

/**
 * Per-generation message keys (PROTOCOL.md §1.4). Derived from a
 * generation secret `rk_g` (32 bytes; `rk_0` is the link key), not the
 * link-static set — these rotate with the ratchet.
 */
export interface GenerationKeys {
	/** AES-256-GCM for chat/control/sync at generation g */
	msg: CryptoKey;
	/** AES-256-GCM for drafts/presence at generation g */
	eph: CryptoKey;
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

async function deriveHmacKey(material: CryptoKey, info: string): Promise<CryptoKey> {
	return crypto.subtle.deriveKey(
		{ name: 'HKDF', hash: 'SHA-256', salt: HKDF_SALT, info: new TextEncoder().encode(info) },
		material,
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign', 'verify']
	);
}

export async function deriveRoomKeys(material: CryptoKey): Promise<RoomKeys> {
	const [msg, eph, storage, auth, hs, mediaBase] = await Promise.all([
		deriveAesKey(material, 'mindline/v2/msg'),
		deriveAesKey(material, 'mindline/v2/eph'),
		deriveAesKey(material, 'mindline/v2/storage'),
		deriveHmacKey(material, 'mindline/v2/auth'),
		deriveAesKey(material, 'mindline/v3/handshake'),
		deriveHmacKey(material, 'mindline/v2/media-base')
	]);
	return { msg, eph, storage, auth, hs, mediaBase };
}

/**
 * Generation message keys from a 32-byte generation secret (PROTOCOL.md
 * §1.4). The secret is imported as HKDF material and dropped; only the
 * derived non-extractable subkeys are kept. v3 info strings keep these
 * independent of the legacy link-static msg/eph keys.
 */
export async function deriveGenerationKeys(rkG: Uint8Array): Promise<GenerationKeys> {
	const material = await crypto.subtle.importKey('raw', rkG as BufferSource, 'HKDF', false, [
		'deriveKey'
	]);
	const [msg, eph] = await Promise.all([
		deriveAesKey(material, 'mindline/v3/msg'),
		deriveAesKey(material, 'mindline/v3/eph')
	]);
	return { msg, eph };
}

/**
 * Generation identity (PROTOCOL.md §1.4): a stable 16-char base64url tag
 * of the generation secret, derivable only by a holder of `rk_g`. Names a
 * generation instance and breaks same-`g` ties; same convention as deviceId.
 */
export async function generationId(rkG: Uint8Array): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', rkG as BufferSource);
	return toB64url(new Uint8Array(digest)).slice(0, 16);
}

/**
 * Per-transfer media subkey (PROTOCOL.md §5.2):
 * AES-256-GCM key from HMAC(mediaBase, 'media|' + transferId).
 */
export async function deriveMediaKey(keys: RoomKeys, transferId: string): Promise<CryptoKey> {
	const bytes = await crypto.subtle.sign(
		'HMAC',
		keys.mediaBase,
		new TextEncoder().encode(`media|${transferId}`)
	);
	return crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM', length: 256 }, false, [
		'encrypt',
		'decrypt'
	]);
}
