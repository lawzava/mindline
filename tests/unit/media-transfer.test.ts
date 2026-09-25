import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
	createRoomKey,
	deriveMediaKey,
	deriveRoomKeys,
	importRoomKeyMaterial,
	type RoomKeys
} from '$lib/crypto/keys';
import { toB64url } from '$lib/crypto/b64';
import type { CryptoSession } from '$lib/p2p/crypto-session';
import { CHUNK_SIZE, encryptChunk } from '$lib/media/frame';
import { burnRoomBlobs, getBlob } from '$lib/media/blob-store';
import * as blobStore from '$lib/media/blob-store';
import { MediaTransferEngine, sha256b64url, type MediaOffer } from '$lib/media/transfer';

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}

class Channel extends EventTarget {
	readyState = 'open';
	private buffered = 0;
	get bufferedAmount() {
		return this.buffered;
	}
	set bufferedAmount(value: number) {
		this.buffered = value;
	}
	onmessage: ((event: { data: unknown }) => void) | null = null;
	onclose: (() => void) | null = null;
	sent: unknown[] = [];
	send(data: unknown) {
		this.sent.push(data);
	}
	close() {
		this.readyState = 'closed';
		this.onclose?.();
		this.dispatchEvent(new Event('close'));
	}
	receive(data: unknown) {
		this.onmessage?.({ data });
	}
	get rtc() {
		return this as unknown as RTCDataChannel;
	}
}

let keys: RoomKeys;
let engines: MediaTransferEngine[];
beforeEach(async () => {
	indexedDB = new IDBFactory();
	keys = await deriveRoomKeys(await importRoomKeyMaterial(createRoomKey()));
	engines = [];
});
afterEach(() => {
	for (const engine of engines) engine.destroy?.();
	vi.restoreAllMocks();
	vi.useRealTimers();
});

function setup(mediaKey = (id: string) => deriveMediaKey(keys, id)) {
	const events = { onProgress: vi.fn(), onReceived: vi.fn(), onAborted: vi.fn() };
	const channels: Channel[] = [];
	const sendControl = vi.fn();
	const engine = new MediaTransferEngine({
		session: { roomKeys: keys, mediaKey } as CryptoSession,
		roomId: 'room',
		events,
		sendControl,
		openChannel: () => {
			const channel = new Channel();
			channels.push(channel);
			return channel.rtc;
		}
	});
	engines.push(engine);
	return { engine, events, channels, sendControl };
}

async function incoming(engine: MediaTransferEngine, data = new Uint8Array(CHUNK_SIZE + 7)) {
	const salt = crypto.getRandomValues(new Uint8Array(8));
	const offer: MediaOffer = {
		type: 'media-offer',
		transferId: 'transfer',
		messageId: 'message',
		kind: 'file',
		name: 'test',
		mime: 'application/octet-stream',
		size: data.length,
		sha256: await sha256b64url(data),
		nonceSalt: toB64url(salt),
		senderId: 'sender',
		senderName: 'Sender',
		roomId: 'room',
		timestamp: Date.now()
	};
	const key = await deriveMediaKey(keys, offer.transferId);
	const frames = [];
	for (let i = 0; i < Math.ceil(data.length / CHUNK_SIZE); i++) {
		frames.push(
			await encryptChunk(
				key,
				offer.transferId,
				i,
				salt,
				data.subarray(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE)
			)
		);
	}
	engine.accept(offer, 'peer');
	const channel = new Channel();
	engine.attachIncomingChannel('peer', offer.transferId, channel.rtc);
	return { channel, frames, offer, data };
}

test('ordered frames and complete wait for key derivation, even when the channel closes', async () => {
	const key = deferred<CryptoKey>();
	const { engine, events } = setup(() => key.promise);
	const { channel, frames, offer, data } = await incoming(engine);
	for (const frame of frames) channel.receive(frame.buffer);
	channel.receive(JSON.stringify({ type: 'complete' }));
	channel.close();
	key.resolve(await deriveMediaKey(keys, offer.transferId));
	await vi.waitFor(() => expect(events.onReceived).toHaveBeenCalledOnce());
	expect(events.onAborted).not.toHaveBeenCalled();
	expect((await getBlob(keys, 'room', offer.transferId))?.data).toEqual(data);
});

test('persistence failure reports terminal abort instead of leaving verification pending', async () => {
	const { engine, events } = setup();
	const { channel, frames } = await incoming(engine, new Uint8Array(3));
	channel.receive(frames[0].buffer);
	await vi.waitFor(() =>
		expect(events.onProgress).toHaveBeenCalledWith(
			expect.objectContaining({ status: 'transferring' })
		)
	);
	vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
		throw new DOMException('full', 'QuotaExceededError');
	});
	channel.receive(JSON.stringify({ type: 'complete' }));
	await vi.waitFor(() =>
		expect(events.onAborted).toHaveBeenCalledWith('transfer', 'could not save media', 'peer')
	);
	expect(events.onReceived).not.toHaveBeenCalled();
	expect(channel.readyState).toBe('closed');
});

test('disconnect during blob encryption cannot resurrect media after room burn', async () => {
	const { engine, events } = setup();
	const { channel, frames } = await incoming(engine, new Uint8Array(3));
	channel.receive(frames[0].buffer);
	await vi.waitFor(() =>
		expect(events.onProgress).toHaveBeenCalledWith(
			expect.objectContaining({ status: 'transferring' })
		)
	);
	const encrypt = crypto.subtle.encrypt.bind(crypto.subtle);
	const blocked = deferred<void>();
	const started = deferred<void>();
	const finished = deferred<void>();
	const putBlob = blobStore.putBlob;
	vi.spyOn(blobStore, 'putBlob').mockImplementation(async (...args) => {
		try {
			await putBlob(...args);
		} finally {
			finished.resolve();
		}
	});
	vi.spyOn(crypto.subtle, 'encrypt').mockImplementation(async (...args) => {
		started.resolve();
		await blocked.promise;
		return encrypt(...args);
	});
	channel.receive(JSON.stringify({ type: 'complete' }));
	await started.promise;
	engine.destroy();
	await burnRoomBlobs('room');
	blocked.resolve();
	await finished.promise;
	expect(await getBlob(keys, 'room', 'transfer')).toBeNull();
	expect(events.onReceived).not.toHaveBeenCalled();
});

test('offers serve each intended peer, including a later accept, then expire pending consent', async () => {
	const { engine, channels, sendControl } = setup();
	const offer = await engine.offer(
		new Uint8Array(3),
		{ kind: 'file', name: 'test', mime: 'a/b' },
		['a', 'b', 'c'],
		{ id: 'sender', name: 'Sender' },
		'message'
	);
	const accept = {
		type: 'media-accept' as const,
		transferId: offer.transferId,
		timestamp: Date.now()
	};
	await Promise.all([engine.handleControl(accept, 'a'), engine.handleControl(accept, 'a')]);
	await engine.handleControl(accept, 'outsider');
	await engine.handleControl(accept, 'b');
	expect(channels).toHaveLength(2);
	expect(channels.every((channel) => channel.sent.length === 2)).toBe(true);
	vi.useFakeTimers();
	vi.setSystemTime(Date.now() + 11 * 60_000);
	await engine.handleControl(accept, 'c');
	expect(channels).toHaveLength(2);
	expect(sendControl).toHaveBeenCalledWith(
		'c',
		expect.objectContaining({ type: 'media-abort', reason: 'offer expired' })
	);
});

test('disconnect releases a sender waiting for buffered bytes to drain', async () => {
	const { engine, channels } = setup();
	const offer = await engine.offer(
		new Uint8Array(3),
		{ kind: 'file', name: 'test', mime: 'a/b' },
		['a'],
		{ id: 'sender', name: 'Sender' },
		'message'
	);
	const sending = engine.handleControl(
		{ type: 'media-accept', transferId: offer.transferId, timestamp: Date.now() },
		'a'
	);
	channels[0].bufferedAmount = 2 * 1024 * 1024;
	const buffered = vi.spyOn(channels[0], 'bufferedAmount', 'get');
	await vi.waitFor(() => expect(buffered).toHaveBeenCalled());
	engine.destroy();
	await sending;
	expect(channels[0].sent).toHaveLength(0);
}, 1000);

test('pending offers are bounded and evict only the oldest unaccepted offer', async () => {
	const { engine, channels, sendControl } = setup();
	const offers = [];
	for (let i = 0; i < 65; i++) {
		offers.push(
			await engine.offer(
				new Uint8Array(1),
				{ kind: 'file', name: 'test', mime: 'a/b' },
				['a'],
				{ id: 'sender', name: 'Sender' },
				`message-${i}`
			)
		);
	}
	expect(sendControl).toHaveBeenCalledWith(
		'a',
		expect.objectContaining({
			type: 'media-abort',
			transferId: offers[0].transferId,
			reason: 'offer expired'
		})
	);
	await engine.handleControl(
		{ type: 'media-accept', transferId: offers[0].transferId, timestamp: Date.now() },
		'a'
	);
	expect(channels).toHaveLength(0);
	await engine.handleControl(
		{ type: 'media-accept', transferId: offers[1].transferId, timestamp: Date.now() },
		'a'
	);
	expect(channels).toHaveLength(1);
});

test('a sender whose media channel never opens aborts after the opening deadline', async () => {
	const { engine, channels, events } = setup();
	const offer = await engine.offer(
		new Uint8Array(3),
		{ kind: 'file', name: 'test', mime: 'a/b' },
		['a'],
		{ id: 'sender', name: 'Sender' },
		'message'
	);
	vi.useFakeTimers();
	vi.spyOn(console, 'warn').mockImplementation(() => {});
	const sending = engine.handleControl(
		{ type: 'media-accept', transferId: offer.transferId, timestamp: Date.now() },
		'a'
	);
	channels[0].readyState = 'connecting';
	const listener = vi.spyOn(channels[0], 'addEventListener');
	await vi.waitFor(() => expect(listener).toHaveBeenCalledWith('open', expect.any(Function)));
	await vi.advanceTimersByTimeAsync(20_000);
	await sending;
	expect(events.onAborted).toHaveBeenCalledWith(offer.transferId, 'send failed', 'a');
	expect(channels[0].readyState).toBe('closed');
});

test('only the transfer counterparty can abort an incoming transfer', async () => {
	const { engine, events } = setup();
	await incoming(engine);
	const abort = {
		type: 'media-abort' as const,
		transferId: 'transfer',
		reason: 'cancelled',
		timestamp: Date.now()
	};
	await engine.handleControl(abort, 'outsider');
	expect(events.onAborted).not.toHaveBeenCalled();
	await engine.handleControl(abort, 'peer');
	expect(events.onAborted).toHaveBeenCalledWith('transfer', 'cancelled', 'peer');
});

test('offers with an unknown kind or a non-integer size are refused', async () => {
	const { engine, sendControl } = setup();
	const base = {
		type: 'media-offer' as const,
		messageId: 'message',
		name: 'x',
		mime: 'application/octet-stream',
		sha256: 'h',
		nonceSalt: toB64url(new Uint8Array(8)),
		senderId: 'sender',
		senderName: 'Sender',
		roomId: 'room',
		timestamp: Date.now()
	};
	const offers = [
		{ ...base, transferId: 't-kind', kind: 'html', size: 10 },
		{ ...base, transferId: 't-nan', kind: 'file', size: Number.NaN },
		{ ...base, transferId: 't-frac', kind: 'file', size: 1.5 }
	] as unknown as MediaOffer[];
	for (const offer of offers) await engine.handleControl(offer, 'peer');
	const accepted = sendControl.mock.calls.filter(([, body]) => body.type === 'media-accept');
	expect(accepted).toEqual([]);
});

test('a second offer for a transfer already in flight is ignored', async () => {
	const { engine, sendControl } = setup();
	const { offer } = await incoming(engine);
	sendControl.mockClear();
	await engine.handleControl({ ...offer, nonceSalt: toB64url(new Uint8Array(8)) }, 'intruder');
	expect(sendControl).not.toHaveBeenCalled();
});
