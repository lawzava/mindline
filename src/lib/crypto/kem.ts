/**
 * Per-device hybrid KEM wrapping of generation secrets (PROTOCOL.md §1.4).
 *
 * X-Wing (X25519 + ML-KEM-768, draft-connolly-cfrg-xwing-kem-10) via
 * @noble/post-quantum — hybrid, so the wrap is confidential while *either*
 * component holds. The encapsulated shared secret keys a one-shot
 * AES-256-GCM seal of `rk_g`, AAD-bound to room, generation, and recipient
 * so a wrap cannot be replayed across any of those contexts.
 */

import { XWing } from '@noble/post-quantum/hybrid.js';
import { lp } from './lp';

export const KEM_SEED_BYTES = 32;
export const KEM_PUBLIC_KEY_BYTES = 1216;
export const KEM_CIPHERTEXT_BYTES = 1120;

export interface KemWrap {
	/** X-Wing encapsulation ciphertext (1120 bytes) */
	ct: Uint8Array;
	/** 96-bit AES-GCM nonce, fresh per wrap */
	n: Uint8Array;
	/** AES-256-GCM sealed secret (includes tag) */
	wrapped: Uint8Array;
}

export interface KemWrapContext {
	roomId: string;
	g: number;
	gid: string;
	recipientDeviceId: string;
}

export function generateKemSeed(): Uint8Array {
	return crypto.getRandomValues(new Uint8Array(KEM_SEED_BYTES));
}

/** Deterministic from the seed (X-Wing §5.3); only the seed is ever stored. */
export function kemKeypair(seed: Uint8Array): { publicKey: Uint8Array; secretKey: Uint8Array } {
	return XWing.keygen(seed);
}

/**
 * A well-sized byte string is not necessarily a valid X-Wing public key:
 * ML-KEM rejects out-of-range moduli at encapsulation time. Dry-run an
 * encapsulation so an unusable key is rejected at the hello, not when a
 * grant is first wrapped for it (review V4-PQ-02).
 */
export function isUsableKemPublicKey(publicKey: Uint8Array): boolean {
	if (publicKey.length !== KEM_PUBLIC_KEY_BYTES) return false;
	try {
		XWing.encapsulate(publicKey);
		return true;
	} catch {
		return false;
	}
}

function wrapAad(ctx: KemWrapContext): Uint8Array {
	return lp('grant-wrap', ctx.roomId, String(ctx.g), ctx.gid, ctx.recipientDeviceId);
}

async function wrapKeyFrom(sharedSecret: Uint8Array, usage: KeyUsage): Promise<CryptoKey> {
	return crypto.subtle.importKey('raw', sharedSecret as BufferSource, { name: 'AES-GCM', length: 256 }, false, [
		usage
	]);
}

export async function wrapSecret(
	recipientPublicKey: Uint8Array,
	secret: Uint8Array,
	ctx: KemWrapContext
): Promise<KemWrap> {
	const { sharedSecret, cipherText } = XWing.encapsulate(recipientPublicKey);
	const key = await wrapKeyFrom(sharedSecret, 'encrypt');
	const n = crypto.getRandomValues(new Uint8Array(12));
	const wrapped = new Uint8Array(
		await crypto.subtle.encrypt(
			{ name: 'AES-GCM', iv: n, additionalData: wrapAad(ctx) as BufferSource },
			key,
			secret as BufferSource
		)
	);
	return { ct: cipherText, n, wrapped };
}

/** Fail-closed: any decapsulation, tag, or AAD mismatch yields null. */
export async function unwrapSecret(
	seed: Uint8Array,
	wrap: KemWrap,
	ctx: KemWrapContext
): Promise<Uint8Array | null> {
	try {
		const { secretKey } = XWing.keygen(seed);
		const sharedSecret = XWing.decapsulate(wrap.ct, secretKey);
		const key = await wrapKeyFrom(sharedSecret, 'decrypt');
		const plain = await crypto.subtle.decrypt(
			{ name: 'AES-GCM', iv: wrap.n as BufferSource, additionalData: wrapAad(ctx) as BufferSource },
			key,
			wrap.wrapped as BufferSource
		);
		return new Uint8Array(plain);
	} catch {
		return null;
	}
}
