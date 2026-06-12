/**
 * Wire envelope (PROTOCOL.md §2, v3). Every byte that leaves the device is
 * one of these; there is no plaintext message path.
 *
 * AAD binds ciphertext to its external context — protocol version, room,
 * sender, key class, and key generation — with length-prefixed fields
 * (§0), so delimiter games in attacker-chosen ids cannot collide contexts
 * and a ciphertext cannot be replayed across rooms, senders, classes, or
 * generations. Body type and ids live inside the authenticated plaintext.
 * 'msg' and 'hs' envelopes are additionally signed over AAD ‖ nonce ‖
 * ciphertext with the sender's device key.
 *
 * The caller supplies the exact AES key: the generation msg/eph key for
 * 'msg'/'eph', or the static k_hs for 'hs'. Opening is therefore a
 * single-key attempt; the ratchet layer trial-decrypts across retained
 * generation keys (§1.4).
 */

import { fromB64url, toB64url } from './b64';
import type { DeviceIdentity } from './identity';
import { lp } from './lp';

export const ENVELOPE_VERSION = 3;

export type EnvelopeClass = 'msg' | 'eph' | 'hs';

export interface Envelope {
	v: 3;
	t: EnvelopeClass;
	g: number; // key generation (§1.4); 0 for 'hs'
	s: string;
	n: string;
	c: string;
	sig?: string;
}

export interface SealOptions {
	/** AES-256-GCM key: generation msg/eph key, or static k_hs for 'hs'. */
	key: CryptoKey;
	roomId: string;
	identity: DeviceIdentity;
	klass: EnvelopeClass;
	/** Key generation (§1.4). Must be 0 for 'hs'. */
	g: number;
}

export interface OpenOptions {
	/** Candidate AES-256-GCM key to decrypt under. */
	key: CryptoKey;
	roomId: string;
	/** Required for signed classes ('msg', 'hs'); TOFU key bound to s. */
	senderPublicKey?: CryptoKey;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/** Signed classes carry an ECDSA signature over AAD ‖ nonce ‖ ciphertext. */
function isSigned(klass: EnvelopeClass): boolean {
	return klass === 'msg' || klass === 'hs';
}

/** Version/room/sender/class/generation context (PROTOCOL.md §2). */
function buildAad(
	v: number,
	roomId: string,
	senderId: string,
	klass: string,
	g: number
): Uint8Array<ArrayBuffer> {
	return lp(String(v), roomId, senderId, klass, String(g));
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
	const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
	let offset = 0;
	for (const p of parts) {
		out.set(p, offset);
		offset += p.length;
	}
	return out;
}

export async function sealEnvelope(body: unknown, opts: SealOptions): Promise<Envelope> {
	const { key, roomId, identity, klass, g } = opts;
	if (klass === 'hs' && g !== 0) throw new Error("'hs' envelopes must use generation 0");
	const nonce = crypto.getRandomValues(new Uint8Array(12));
	const aad = buildAad(ENVELOPE_VERSION, roomId, identity.deviceId, klass, g);
	const plaintext = textEncoder.encode(JSON.stringify(body));
	const ciphertext = new Uint8Array(
		await crypto.subtle.encrypt(
			{ name: 'AES-GCM', iv: nonce, additionalData: aad },
			key,
			plaintext
		)
	);

	const envelope: Envelope = {
		v: ENVELOPE_VERSION,
		t: klass,
		g,
		s: identity.deviceId,
		n: toB64url(nonce),
		c: toB64url(ciphertext)
	};

	if (isSigned(klass)) {
		const signature = await crypto.subtle.sign(
			{ name: 'ECDSA', hash: 'SHA-256' },
			identity.privateKey,
			concat(aad, nonce, ciphertext) as BufferSource
		);
		envelope.sig = toB64url(new Uint8Array(signature));
	}

	return envelope;
}

export async function openEnvelope(envelope: Envelope, opts: OpenOptions): Promise<unknown> {
	const { key, roomId, senderPublicKey } = opts;
	if (envelope.v !== ENVELOPE_VERSION) {
		throw new Error(`unsupported envelope version: ${envelope.v}`);
	}
	if (envelope.t !== 'msg' && envelope.t !== 'eph' && envelope.t !== 'hs') {
		throw new Error(`unknown envelope class: ${envelope.t}`);
	}
	if (!Number.isInteger(envelope.g) || envelope.g < 0) {
		throw new Error('malformed envelope generation');
	}
	if (envelope.t === 'hs' && envelope.g !== 0) throw new Error("'hs' envelopes must use generation 0");

	const nonce = fromB64url(envelope.n);
	const ciphertext = fromB64url(envelope.c);
	if (!nonce || nonce.length !== 12 || !ciphertext) throw new Error('malformed envelope');

	const aad = buildAad(ENVELOPE_VERSION, roomId, envelope.s, envelope.t, envelope.g);

	if (isSigned(envelope.t)) {
		if (!envelope.sig) throw new Error(`missing signature on ${envelope.t} envelope`);
		if (!senderPublicKey) throw new Error('signature verification requires sender public key');
		const signature = fromB64url(envelope.sig);
		if (!signature) throw new Error('malformed envelope');
		const valid = await crypto.subtle.verify(
			{ name: 'ECDSA', hash: 'SHA-256' },
			senderPublicKey,
			signature as BufferSource,
			concat(aad, nonce, ciphertext) as BufferSource
		);
		if (!valid) throw new Error('invalid signature');
	}

	let plaintext: ArrayBuffer;
	try {
		plaintext = await crypto.subtle.decrypt(
			{ name: 'AES-GCM', iv: nonce, additionalData: aad },
			key,
			ciphertext as BufferSource
		);
	} catch {
		throw new Error('envelope authentication failed');
	}

	return JSON.parse(textDecoder.decode(plaintext));
}
