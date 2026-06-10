/**
 * Media chunk framing (PROTOCOL.md §5.2).
 *
 * Frame layout: u32be chunkIndex ‖ 12-byte nonce ‖ ciphertext+tag.
 * nonce = u32be(chunkIndex) ‖ nonceSalt(8 B, random per transfer attempt).
 * The salt guarantees nonce uniqueness even if a transferId were ever
 * reused; the AAD binds each chunk to its transfer and position.
 */

const INDEX_BYTES = 4;
const NONCE_BYTES = 12;
const GCM_TAG_BYTES = 16;

/** Total bytes added to each chunk plaintext. */
export const FRAME_OVERHEAD = INDEX_BYTES + NONCE_BYTES + GCM_TAG_BYTES;

/** 15,360 B keeps frames under the conservative 16 KiB floor. */
export const CHUNK_SIZE = 15360;

const textEncoder = new TextEncoder();

function lp(...fields: string[]): Uint8Array<ArrayBuffer> {
	const encoded = fields.map((f) => textEncoder.encode(f));
	const out = new Uint8Array(encoded.reduce((sum, f) => sum + 4 + f.length, 0));
	const view = new DataView(out.buffer);
	let offset = 0;
	for (const f of encoded) {
		view.setUint32(offset, f.length);
		out.set(f, offset + 4);
		offset += 4 + f.length;
	}
	return out;
}

function buildNonce(chunkIndex: number, nonceSalt: Uint8Array): Uint8Array<ArrayBuffer> {
	if (nonceSalt.length !== 8) throw new Error('nonceSalt must be 8 bytes');
	const nonce = new Uint8Array(NONCE_BYTES);
	new DataView(nonce.buffer).setUint32(0, chunkIndex);
	nonce.set(nonceSalt, INDEX_BYTES);
	return nonce;
}

export async function encryptChunk(
	key: CryptoKey,
	transferId: string,
	chunkIndex: number,
	nonceSalt: Uint8Array,
	plaintext: Uint8Array
): Promise<Uint8Array<ArrayBuffer>> {
	const nonce = buildNonce(chunkIndex, nonceSalt);
	const ciphertext = new Uint8Array(
		await crypto.subtle.encrypt(
			{ name: 'AES-GCM', iv: nonce, additionalData: lp(transferId, String(chunkIndex)) },
			key,
			plaintext as BufferSource
		)
	);

	const frame = new Uint8Array(INDEX_BYTES + NONCE_BYTES + ciphertext.length);
	new DataView(frame.buffer).setUint32(0, chunkIndex);
	frame.set(nonce, INDEX_BYTES);
	frame.set(ciphertext, INDEX_BYTES + NONCE_BYTES);
	return frame;
}

export interface DecryptedChunk {
	chunkIndex: number;
	plaintext: Uint8Array;
}

export async function decryptChunk(
	key: CryptoKey,
	transferId: string,
	nonceSalt: Uint8Array,
	frame: Uint8Array
): Promise<DecryptedChunk> {
	if (frame.length < FRAME_OVERHEAD) throw new Error('malformed media frame');
	const view = new DataView(frame.buffer, frame.byteOffset);
	const chunkIndex = view.getUint32(0);

	// The nonce must be exactly what this index + the offer's salt dictate;
	// anything else is a splice/replay attempt.
	const expectedNonce = buildNonce(chunkIndex, nonceSalt);
	const frameNonce = frame.subarray(INDEX_BYTES, INDEX_BYTES + NONCE_BYTES);
	for (let i = 0; i < NONCE_BYTES; i++) {
		if (frameNonce[i] !== expectedNonce[i]) throw new Error('media frame nonce mismatch');
	}

	const ciphertext = frame.subarray(INDEX_BYTES + NONCE_BYTES);
	let plaintext: ArrayBuffer;
	try {
		plaintext = await crypto.subtle.decrypt(
			{
				name: 'AES-GCM',
				iv: expectedNonce,
				additionalData: lp(transferId, String(chunkIndex))
			},
			key,
			ciphertext as BufferSource
		);
	} catch {
		throw new Error('media chunk authentication failed');
	}

	return { chunkIndex, plaintext: new Uint8Array(plaintext) };
}
