/**
 * Per-device identity (PROTOCOL.md §1.3).
 *
 * ECDSA P-256 keypair; the private key is non-extractable. deviceId is a
 * fingerprint of the public key, so it cannot be claimed without the key.
 */

import { toB64url } from './b64';
import { generateKemSeed, kemKeypair } from './kem';

export interface DeviceIdentity {
	deviceId: string;
	publicKey: CryptoKey;
	privateKey: CryptoKey;
	/** Raw SPKI bytes of the public key, shared in the hello handshake. */
	spki: Uint8Array;
}

/**
 * Per-device X-Wing KEM identity (PROTOCOL.md §1.3): receives the hybrid
 * grant wraps of §1.4. The keypair is deterministic from the 32-byte seed;
 * only the seed exists at rest (wrapped — keystore), the public key is
 * re-derived on load and shared in the hello beside the ECDSA SPKI.
 */
export interface KemIdentity {
	/** X-Wing public key (1216 bytes), shared and TOFU-pinned in the hello. */
	publicKey: Uint8Array;
	/** 32-byte X-Wing seed; in memory only, persisted wrapped. */
	seed: Uint8Array;
}

export function createKemIdentity(): KemIdentity {
	const seed = generateKemSeed();
	return { publicKey: kemKeypair(seed).publicKey, seed };
}

export async function deviceIdFromSpki(spki: Uint8Array): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', spki as BufferSource);
	return toB64url(new Uint8Array(digest)).slice(0, 16);
}

export async function createDeviceIdentity(): Promise<DeviceIdentity> {
	const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, [
		'sign',
		'verify'
	]);
	const spki = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey));
	return {
		deviceId: await deviceIdFromSpki(spki),
		publicKey: pair.publicKey,
		privateKey: pair.privateKey,
		spki
	};
}

export async function importPeerPublicKey(spki: Uint8Array): Promise<CryptoKey> {
	return crypto.subtle.importKey('spki', spki as BufferSource, { name: 'ECDSA', namedCurve: 'P-256' }, true, [
		'verify'
	]);
}
