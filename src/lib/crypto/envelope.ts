/**
 * Wire envelope (PROTOCOL.md §2). Every byte that leaves the device is one
 * of these; there is no plaintext message path.
 *
 * AAD binds ciphertext to its external context (room, sender, key class)
 * with length-prefixed fields, so delimiter games in attacker-chosen ids
 * cannot collide contexts. Body type and ids live inside the authenticated
 * plaintext. 'msg' envelopes are additionally signed over AAD ‖ nonce ‖
 * ciphertext with the sender's device key.
 */

import { fromB64url, toB64url } from './b64';
import type { DeviceIdentity } from './identity';
import type { RoomKeys } from './keys';

export interface Envelope {
	v: 2;
	t: 'msg' | 'eph';
	s: string;
	n: string;
	c: string;
	sig?: string;
}

export interface SealOptions {
	keys: RoomKeys;
	roomId: string;
	identity: DeviceIdentity;
	klass: 'msg' | 'eph';
}

export interface OpenOptions {
	keys: RoomKeys;
	roomId: string;
	/** Required for 'msg' envelopes; TOFU key bound to the sender. */
	senderPublicKey?: CryptoKey;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/** Length-prefixed field encoding: u32be(len) ‖ utf8(field), per field. */
function buildAad(roomId: string, senderId: string, klass: string): Uint8Array<ArrayBuffer> {
	const fields = [roomId, senderId, klass].map((f) => textEncoder.encode(f));
	const total = fields.reduce((sum, f) => sum + 4 + f.length, 0);
	const out = new Uint8Array(total);
	const view = new DataView(out.buffer);
	let offset = 0;
	for (const f of fields) {
		view.setUint32(offset, f.length);
		out.set(f, offset + 4);
		offset += 4 + f.length;
	}
	return out;
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
	const { keys, roomId, identity, klass } = opts;
	const key = klass === 'msg' ? keys.msg : keys.eph;
	const nonce = crypto.getRandomValues(new Uint8Array(12));
	const aad = buildAad(roomId, identity.deviceId, klass);
	const plaintext = textEncoder.encode(JSON.stringify(body));
	const ciphertext = new Uint8Array(
		await crypto.subtle.encrypt(
			{ name: 'AES-GCM', iv: nonce, additionalData: aad },
			key,
			plaintext
		)
	);

	const envelope: Envelope = {
		v: 2,
		t: klass,
		s: identity.deviceId,
		n: toB64url(nonce),
		c: toB64url(ciphertext)
	};

	if (klass === 'msg') {
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
	const { keys, roomId, senderPublicKey } = opts;
	if (envelope.v !== 2) throw new Error(`unsupported envelope version: ${envelope.v}`);
	if (envelope.t !== 'msg' && envelope.t !== 'eph') {
		throw new Error(`unknown envelope class: ${envelope.t}`);
	}

	const nonce = fromB64url(envelope.n);
	const ciphertext = fromB64url(envelope.c);
	if (!nonce || nonce.length !== 12 || !ciphertext) throw new Error('malformed envelope');

	const aad = buildAad(roomId, envelope.s, envelope.t);

	if (envelope.t === 'msg') {
		if (!envelope.sig) throw new Error('missing signature on msg envelope');
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

	const key = envelope.t === 'msg' ? keys.msg : keys.eph;
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
