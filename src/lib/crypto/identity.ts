/**
 * Per-device identity (PROTOCOL.md §1.3).
 *
 * ECDSA P-256 keypair; the private key is non-extractable. deviceId is a
 * fingerprint of the public key, so it cannot be claimed without the key.
 */

import { toB64url } from './b64';

export interface DeviceIdentity {
	deviceId: string;
	publicKey: CryptoKey;
	privateKey: CryptoKey;
	/** Raw SPKI bytes of the public key, shared in the hello handshake. */
	spki: Uint8Array;
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
