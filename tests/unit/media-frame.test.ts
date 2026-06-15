import { describe, expect, test } from 'vitest';
import {
	createRoomKey,
	deriveMediaKey,
	deriveRoomKeys,
	importRoomKeyMaterial
} from '$lib/crypto/keys';
import { decryptChunk, encryptChunk, FRAME_OVERHEAD } from '$lib/media/frame';

async function mediaKey(transferId = 't-1') {
	const keys = await deriveRoomKeys(await importRoomKeyMaterial(createRoomKey()));
	return { keys, key: await deriveMediaKey(keys, transferId) };
}

function salt(): Uint8Array {
	return crypto.getRandomValues(new Uint8Array(8));
}

describe('media chunk framing (PROTOCOL.md §5.2)', () => {
	test('round-trips a chunk', async () => {
		const { key } = await mediaKey();
		const s = salt();
		const plaintext = crypto.getRandomValues(new Uint8Array(15360));
		const frame = await encryptChunk(key, 't-1', 7, s, plaintext);
		expect(frame.byteLength).toBe(plaintext.byteLength + FRAME_OVERHEAD);
		const out = await decryptChunk(key, 't-1', s, frame);
		expect(out.chunkIndex).toBe(7);
		expect(Buffer.from(out.plaintext).equals(Buffer.from(plaintext))).toBe(true);
	});

	test('frame overhead is exactly 32 bytes', () => {
		expect(FRAME_OVERHEAD).toBe(32);
	});

	test('rejects a frame whose index field was tampered (reorder attack)', async () => {
		const { key } = await mediaKey();
		const s = salt();
		const frame = await encryptChunk(key, 't-1', 1, s, new Uint8Array([1, 2, 3]));
		// rewrite the chunkIndex header to 2
		new DataView(frame.buffer).setUint32(0, 2);
		await expect(decryptChunk(key, 't-1', s, frame)).rejects.toThrow();
	});

	test('rejects corrupted ciphertext', async () => {
		const { key } = await mediaKey();
		const s = salt();
		const frame = await encryptChunk(key, 't-1', 0, s, new Uint8Array(100));
		frame[40] ^= 0xff;
		await expect(decryptChunk(key, 't-1', s, frame)).rejects.toThrow();
	});

	test('rejects a frame replayed into another transfer (AAD binds transferId)', async () => {
		const keys = await deriveRoomKeys(await importRoomKeyMaterial(createRoomKey()));
		const keyA = await deriveMediaKey(keys, 't-A');
		const s = salt();
		const frame = await encryptChunk(keyA, 't-A', 0, s, new Uint8Array(10));
		await expect(decryptChunk(keyA, 't-B', s, frame)).rejects.toThrow();
	});

	test('same key and index under different salts produce distinct ciphertexts', async () => {
		const { key } = await mediaKey();
		const plaintext = new Uint8Array(64);
		const f1 = await encryptChunk(key, 't-1', 0, salt(), plaintext);
		const f2 = await encryptChunk(key, 't-1', 0, salt(), plaintext);
		expect(Buffer.from(f1).equals(Buffer.from(f2))).toBe(false);
	});

	test('decrypt verifies the salt actually used in the nonce', async () => {
		const { key } = await mediaKey();
		const s1 = salt();
		const s2 = salt();
		const frame = await encryptChunk(key, 't-1', 0, s1, new Uint8Array(10));
		await expect(decryptChunk(key, 't-1', s2, frame)).rejects.toThrow();
	});
});
