/**
 * P2P media transfer engine (PROTOCOL.md §5).
 *
 * offer (chat ch.) → accept → dedicated in-band DataChannel
 * `media-{transferId}` → encrypted 15 KiB frames with backpressure →
 * complete → both sides close. Receiver consent before any bytes; whole
 * file SHA-256 verified before the blob is committed.
 */

import { toB64url, fromB64url } from '$lib/crypto/b64';
import type { CryptoSession } from '$lib/p2p/crypto-session';
import { CHUNK_SIZE, decryptChunk, encryptChunk } from './frame';
import { getBlob, hasQuotaFor, putBlob } from './blob-store';

export type MediaKind = 'file' | 'image' | 'voice' | 'video';

export interface MediaOffer {
	type: 'media-offer';
	transferId: string;
	messageId: string;
	kind: MediaKind;
	name: string;
	mime: string;
	size: number;
	sha256: string; // base64url
	nonceSalt: string; // base64url, 8 bytes
	thumb?: string; // base64 data, tiny preview
	thumbMime?: string;
	duration?: number; // seconds, voice/video
	waveform?: number[]; // 64 normalized peaks, voice
	senderId: string;
	senderName: string;
	roomId: string;
	timestamp: number;
}

export interface MediaAccept {
	type: 'media-accept';
	transferId: string;
	timestamp: number;
}

export interface MediaAbort {
	type: 'media-abort';
	transferId: string;
	reason: string;
	timestamp: number;
}

export interface TransferProgress {
	transferId: string;
	direction: 'send' | 'receive';
	peerDeviceId: string;
	bytesDone: number;
	bytesTotal: number;
	status: 'offered' | 'transferring' | 'verifying' | 'done' | 'aborted';
}

export interface TransferEvents {
	onProgress: (p: TransferProgress) => void;
	/** Blob landed, verified, and persisted. */
	onReceived: (offer: MediaOffer, peerDeviceId: string) => void;
	onAborted: (transferId: string, reason: string, peerDeviceId: string) => void;
}

export interface TransferDeps {
	session: CryptoSession;
	roomId: string;
	/** Send a control message to one peer over the chat channel. */
	sendControl: (peerDeviceId: string, message: MediaOffer | MediaAccept | MediaAbort) => void;
	/** Open an in-band DataChannel to a peer; null when unreachable. */
	openChannel: (peerDeviceId: string, label: string) => RTCDataChannel | null;
	events: TransferEvents;
}

const AUTO_ACCEPT_BYTES = 5 * 1024 * 1024;
const BUFFERED_LOW = 256 * 1024;
const BUFFERED_HIGH = 1024 * 1024;
const OFFER_LIFETIME_MS = 10 * 60 * 1000;
const MAX_PENDING_OFFERS = 64;
/** Caps per kind (§5.1). */
export const SIZE_CAPS: Record<MediaKind, number> = {
	image: 25 * 1024 * 1024,
	file: 100 * 1024 * 1024,
	voice: 30 * 1024 * 1024,
	video: 50 * 1024 * 1024
};

interface OutgoingTransfer {
	offer: MediaOffer;
	salt: Uint8Array;
	accepted: Set<string>; // peerDeviceIds already served
	pending: Set<string>;
	expiresAt: number;
	expiry: ReturnType<typeof setTimeout>;
}

interface IncomingTransfer {
	offer: MediaOffer;
	peerDeviceId: string;
	salt: Uint8Array;
	chunks: Map<number, Uint8Array>;
	bytesDone: number;
	queue: Promise<void>;
}

export async function sha256b64url(data: Uint8Array): Promise<string> {
	return toB64url(new Uint8Array(await crypto.subtle.digest('SHA-256', data as BufferSource)));
}

export class MediaTransferEngine {
	private deps: TransferDeps;
	private outgoing = new Map<string, OutgoingTransfer>();
	private incoming = new Map<string, IncomingTransfer>();
	private lifetime = new AbortController();
	private channels = new Set<RTCDataChannel>();
	/** Offers awaiting explicit user consent, keyed by transferId. */
	readonly pendingConsent = new Map<string, { offer: MediaOffer; peerDeviceId: string }>();

	constructor(deps: TransferDeps) {
		this.deps = deps;
	}

	/** Cancel before room burn: pending encryption/IDB writes cannot commit afterwards. */
	destroy(): void {
		if (this.lifetime.signal.aborted) return;
		this.lifetime.abort();
		this.incoming.clear();
		this.pendingConsent.clear();
		for (const id of this.outgoing.keys()) this.releaseOffer(id);
		for (const channel of this.channels) channel.close();
		this.channels.clear();
	}

	private releaseOffer(transferId: string): void {
		const transfer = this.outgoing.get(transferId);
		if (!transfer) return;
		clearTimeout(transfer.expiry);
		this.outgoing.delete(transferId);
	}

	private expireOffer(transferId: string): void {
		const transfer = this.outgoing.get(transferId);
		if (!transfer) return;
		this.releaseOffer(transferId);
		for (const peer of transfer.pending) this.abort(transferId, peer, 'offer expired');
	}

	/** Build and broadcast an offer; serves each peer that accepts. */
	async offer(
		data: Uint8Array,
		meta: {
			kind: MediaKind;
			name: string;
			mime: string;
			thumb?: string;
			thumbMime?: string;
			duration?: number;
			waveform?: number[];
		},
		recipients: string[],
		sender: { id: string; name: string },
		messageId: string
	): Promise<MediaOffer> {
		this.lifetime.signal.throwIfAborted();
		if (data.byteLength > SIZE_CAPS[meta.kind]) {
			throw new Error(`${meta.kind} exceeds the ${SIZE_CAPS[meta.kind] / 1024 / 1024} MB cap`);
		}
		// Fresh per attempt, never reused (§5.1): id + salt are both random.
		const transferId = toB64url(crypto.getRandomValues(new Uint8Array(16)));
		const salt = crypto.getRandomValues(new Uint8Array(8));

		const offer: MediaOffer = {
			type: 'media-offer',
			transferId,
			messageId,
			kind: meta.kind,
			name: meta.name,
			mime: meta.mime,
			size: data.byteLength,
			sha256: await sha256b64url(data),
			nonceSalt: toB64url(salt),
			thumb: meta.thumb,
			thumbMime: meta.thumbMime,
			duration: meta.duration,
			waveform: meta.waveform,
			senderId: sender.id,
			senderName: sender.name,
			roomId: this.deps.roomId,
			timestamp: Date.now()
		};

		// Persist locally so the sender can re-render their own media.
		await putBlob(
			this.deps.session.roomKeys,
			this.deps.roomId,
			transferId,
			data,
			meta.mime,
			this.lifetime.signal
		);
		this.lifetime.signal.throwIfAborted();
		// Keep bounded offer metadata only; accepted peers load their bytes from storage.
		if (recipients.length > 0) {
			while (this.outgoing.size >= MAX_PENDING_OFFERS)
				this.expireOffer(this.outgoing.keys().next().value!);
			this.outgoing.set(transferId, {
				offer,
				salt,
				accepted: new Set(),
				pending: new Set(recipients),
				expiresAt: Date.now() + OFFER_LIFETIME_MS,
				expiry: setTimeout(() => this.expireOffer(transferId), OFFER_LIFETIME_MS)
			});
		}

		for (const peer of recipients) {
			this.deps.sendControl(peer, offer);
		}
		return offer;
	}

	/** Route an incoming control message. */
	async handleControl(
		message: MediaOffer | MediaAccept | MediaAbort,
		peerDeviceId: string
	): Promise<void> {
		if (this.lifetime.signal.aborted) return;
		switch (message.type) {
			case 'media-offer':
				await this.handleOffer(message, peerDeviceId);
				break;
			case 'media-accept':
				await this.serve(message.transferId, peerDeviceId);
				break;
			case 'media-abort': {
				// Only the transfer's counterparty may end it: any member can
				// name any transferId, and an abort marks the attachment failed.
				const id = message.transferId;
				const outgoing = this.outgoing.get(id);
				const wasPending = outgoing?.pending.delete(peerDeviceId) ?? false;
				if (wasPending && outgoing!.pending.size === 0) this.releaseOffer(id);
				const fromSender =
					this.incoming.get(id)?.peerDeviceId === peerDeviceId ||
					this.pendingConsent.get(id)?.peerDeviceId === peerDeviceId;
				if (fromSender) {
					this.incoming.delete(id);
					this.pendingConsent.delete(id);
				}
				if (wasPending || fromSender) {
					this.deps.events.onAborted(id, message.reason, peerDeviceId);
				}
				break;
			}
		}
	}

	private async handleOffer(offer: MediaOffer, peerDeviceId: string): Promise<void> {
		// A repeated transferId would overwrite the stored blob of the
		// original transfer; the first offer owns the slot.
		if (this.incoming.has(offer.transferId) || this.pendingConsent.has(offer.transferId)) return;
		if (!Object.hasOwn(SIZE_CAPS, offer.kind) || !Number.isSafeInteger(offer.size)) {
			this.abort(offer.transferId, peerDeviceId, 'malformed offer');
			return;
		}
		if (offer.size > SIZE_CAPS[offer.kind] || offer.size <= 0) {
			this.abort(offer.transferId, peerDeviceId, 'size cap exceeded');
			return;
		}
		if (!(await hasQuotaFor(offer.size))) {
			this.abort(offer.transferId, peerDeviceId, 'not enough storage space');
			return;
		}
		if (this.lifetime.signal.aborted) return;

		if (offer.size <= AUTO_ACCEPT_BYTES) {
			this.accept(offer, peerDeviceId);
		} else {
			this.pendingConsent.set(offer.transferId, { offer, peerDeviceId });
			this.deps.events.onProgress({
				transferId: offer.transferId,
				direction: 'receive',
				peerDeviceId,
				bytesDone: 0,
				bytesTotal: offer.size,
				status: 'offered'
			});
		}
	}

	/** Receiver consent (called directly for auto-accept, or from UI). */
	accept(offer: MediaOffer, peerDeviceId: string): void {
		if (this.lifetime.signal.aborted) return;
		this.pendingConsent.delete(offer.transferId);
		const salt = fromB64url(offer.nonceSalt);
		if (!salt || salt.length !== 8) {
			this.abort(offer.transferId, peerDeviceId, 'malformed offer');
			return;
		}
		this.incoming.set(offer.transferId, {
			offer,
			peerDeviceId,
			salt,
			chunks: new Map(),
			bytesDone: 0,
			queue: Promise.resolve()
		});
		this.deps.sendControl(peerDeviceId, {
			type: 'media-accept',
			transferId: offer.transferId,
			timestamp: Date.now()
		});
	}

	decline(transferId: string): void {
		const pending = this.pendingConsent.get(transferId);
		if (!pending) return;
		this.pendingConsent.delete(transferId);
		this.abort(transferId, pending.peerDeviceId, 'declined');
		// Resolve the local placeholder bubble too; without this the
		// receiver's message sits at 0% forever.
		this.deps.events.onAborted(transferId, 'declined', pending.peerDeviceId);
	}

	abort(transferId: string, peerDeviceId: string, reason: string): void {
		this.incoming.delete(transferId);
		if (this.lifetime.signal.aborted) return;
		this.deps.sendControl(peerDeviceId, {
			type: 'media-abort',
			transferId,
			reason,
			timestamp: Date.now()
		});
	}

	/** Sender side: pump chunks to an accepting peer with backpressure. */
	private async serve(transferId: string, peerDeviceId: string): Promise<void> {
		const transfer = this.outgoing.get(transferId);
		if (!transfer || !transfer.pending.has(peerDeviceId) || transfer.accepted.has(peerDeviceId))
			return;
		if (Date.now() >= transfer.expiresAt) {
			this.expireOffer(transferId);
			return;
		}
		transfer.accepted.add(peerDeviceId);
		transfer.pending.delete(peerDeviceId);
		if (transfer.pending.size === 0) this.releaseOffer(transferId);

		const channel = this.deps.openChannel(peerDeviceId, `media-${transferId}`);
		if (!channel) {
			this.deps.events.onAborted(transferId, 'peer unreachable for direct transfer', peerDeviceId);
			return;
		}
		channel.binaryType = 'arraybuffer';
		this.channels.add(channel);
		channel.addEventListener('close', () => this.channels.delete(channel), { once: true });
		channel.bufferedAmountLowThreshold = BUFFERED_LOW;

		const waitOpen = () =>
			new Promise<void>((resolve, reject) => {
				if (this.lifetime.signal.aborted || channel.readyState === 'closed')
					return reject(new Error('media channel closed'));
				if (channel.readyState === 'open') return resolve();
				const cleanup = () => {
					clearTimeout(timeout);
					channel.removeEventListener('open', opened);
					channel.removeEventListener('close', failed);
					channel.removeEventListener('error', failed);
					this.lifetime.signal.removeEventListener('abort', failed);
				};
				const opened = () => {
					cleanup();
					resolve();
				};
				const failed = () => {
					cleanup();
					reject(new Error('media channel failed to open'));
				};
				const timeout = setTimeout(failed, 20000);
				channel.addEventListener('open', opened);
				channel.addEventListener('close', failed);
				channel.addEventListener('error', failed);
				this.lifetime.signal.addEventListener('abort', failed, { once: true });
			});

		// Attach the persistent low-watermark waiter BEFORE sending (§5.2):
		// bufferedamountlow only fires on downward crossings.
		let lowResolve: (() => void) | null = null;
		let lowReject: ((error: Error) => void) | null = null;
		const onLow = () => {
			lowResolve?.();
			lowResolve = null;
			lowReject = null;
		};
		const onClosed = () => {
			lowReject?.(new Error('media channel closed mid-transfer'));
			lowResolve = null;
			lowReject = null;
		};
		channel.addEventListener('bufferedamountlow', onLow);
		channel.addEventListener('close', onClosed);
		this.lifetime.signal.addEventListener('abort', onClosed, { once: true });
		const drain = () =>
			new Promise<void>((resolve, reject) => {
				if (this.lifetime.signal.aborted || channel.readyState !== 'open')
					return reject(new Error('media channel closed mid-transfer'));
				if (channel.bufferedAmount <= BUFFERED_HIGH) return resolve();
				lowResolve = resolve;
				lowReject = reject;
				// Re-check after attach: the buffer may have drained already.
				if (channel.bufferedAmount <= BUFFERED_LOW) {
					lowResolve = null;
					lowReject = null;
					resolve();
				}
			});

		try {
			const stored = await getBlob(this.deps.session.roomKeys, this.deps.roomId, transferId);
			if (!stored) throw new Error('media no longer available');
			this.lifetime.signal.throwIfAborted();
			const key = await this.deps.session.mediaKey(transferId);
			const total = stored.data.byteLength;
			const chunkCount = Math.max(1, Math.ceil(total / CHUNK_SIZE));
			await waitOpen();
			for (let i = 0; i < chunkCount; i++) {
				this.lifetime.signal.throwIfAborted();
				const slice = stored.data.subarray(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
				const frame = await encryptChunk(key, transferId, i, transfer.salt, slice);
				await drain();
				if (channel.readyState !== 'open') throw new Error('media channel closed mid-transfer');
				channel.send(frame as unknown as ArrayBuffer);
				this.deps.events.onProgress({
					transferId,
					direction: 'send',
					peerDeviceId,
					bytesDone: Math.min((i + 1) * CHUNK_SIZE, total),
					bytesTotal: total,
					status: 'transferring'
				});
			}
			channel.send(JSON.stringify({ type: 'complete', transferId }));
			this.deps.events.onProgress({
				transferId,
				direction: 'send',
				peerDeviceId,
				bytesDone: total,
				bytesTotal: total,
				status: 'done'
			});
			// Close after the receiver had a moment to drain (§3.3 close discipline).
			setTimeout(() => channel.close(), 3000);
		} catch (error) {
			if (this.lifetime.signal.aborted) return;
			console.warn('[Media] send failed:', error);
			try {
				channel.close();
			} catch {
				/* already closed */
			}
			this.abort(transferId, peerDeviceId, 'send failed');
			this.deps.events.onAborted(transferId, 'send failed', peerDeviceId);
		} finally {
			channel.removeEventListener('bufferedamountlow', onLow);
			channel.removeEventListener('close', onClosed);
			this.lifetime.signal.removeEventListener('abort', onClosed);
		}
	}

	/** Receiver side: a media channel arrived from a peer. */
	attachIncomingChannel(peerDeviceId: string, transferId: string, channel: RTCDataChannel): void {
		const transfer = this.incoming.get(transferId);
		if (!transfer || transfer.peerDeviceId !== peerDeviceId) {
			channel.close();
			return;
		}
		channel.binaryType = 'arraybuffer';
		this.channels.add(channel);
		// Ordered DataChannel delivery does not serialize asynchronous WebCrypto work.
		channel.onmessage = (event) => {
			transfer.queue = transfer.queue.then(() => this.onFrame(transfer, channel, event.data));
		};
		channel.onclose = () => {
			this.channels.delete(channel);
			// Process already delivered frames, including complete, before deciding it failed.
			transfer.queue = transfer.queue.then(() => {
				if (this.incoming.get(transferId) === transfer) {
					this.incoming.delete(transferId);
					this.deps.events.onAborted(transferId, 'peer closed mid-transfer', peerDeviceId);
				}
			});
		};
	}

	private async onFrame(
		transfer: IncomingTransfer,
		channel: RTCDataChannel,
		raw: unknown
	): Promise<void> {
		const { offer, peerDeviceId } = transfer;
		if (!this.isActive(transfer)) return;

		if (typeof raw === 'string') {
			// Control frame: complete
			let control;
			try {
				control = JSON.parse(raw);
			} catch {
				return; // ignore malformed control frames, not persistence failures
			}
			if (control?.type === 'complete') {
				try {
					await this.finalize(transfer, channel);
				} catch {
					if (this.isActive(transfer)) this.failIncoming(transfer, channel, 'could not save media');
				}
			}
			return;
		}

		if (!(raw instanceof ArrayBuffer)) return;
		try {
			const key = await this.deps.session.mediaKey(offer.transferId);
			const { chunkIndex, plaintext } = await decryptChunk(
				key,
				offer.transferId,
				transfer.salt,
				new Uint8Array(raw)
			);
			if (!this.isActive(transfer)) return;
			if (!transfer.chunks.has(chunkIndex)) {
				transfer.chunks.set(chunkIndex, plaintext);
				transfer.bytesDone += plaintext.byteLength;
				if (transfer.bytesDone > offer.size) throw new Error('transfer exceeds offered size');
			}
			this.deps.events.onProgress({
				transferId: offer.transferId,
				direction: 'receive',
				peerDeviceId,
				bytesDone: transfer.bytesDone,
				bytesTotal: offer.size,
				status: 'transferring'
			});
		} catch (error) {
			if (!this.isActive(transfer)) return;
			console.warn('[Media] dropping transfer:', error);
			this.failIncoming(transfer, channel, 'chunk verification failed');
		}
	}

	private isActive(transfer: IncomingTransfer): boolean {
		return (
			!this.lifetime.signal.aborted && this.incoming.get(transfer.offer.transferId) === transfer
		);
	}

	private failIncoming(transfer: IncomingTransfer, channel: RTCDataChannel, reason: string): void {
		this.abort(transfer.offer.transferId, transfer.peerDeviceId, reason);
		channel.close();
		this.deps.events.onAborted(transfer.offer.transferId, reason, transfer.peerDeviceId);
	}

	private async finalize(transfer: IncomingTransfer, channel: RTCDataChannel): Promise<void> {
		const { offer, peerDeviceId } = transfer;

		this.deps.events.onProgress({
			transferId: offer.transferId,
			direction: 'receive',
			peerDeviceId,
			bytesDone: transfer.bytesDone,
			bytesTotal: offer.size,
			status: 'verifying'
		});

		const indices = [...transfer.chunks.keys()].sort((a, b) => a - b);
		const assembled = new Uint8Array(transfer.bytesDone);
		let offset = 0;
		for (const index of indices) {
			const chunk = transfer.chunks.get(index)!;
			assembled.set(chunk, offset);
			offset += chunk.byteLength;
		}

		const expectedCount = Math.max(1, Math.ceil(offer.size / CHUNK_SIZE));
		const hash = await sha256b64url(assembled);
		if (!this.isActive(transfer)) return;
		if (
			assembled.byteLength !== offer.size ||
			indices.length !== expectedCount ||
			hash !== offer.sha256
		) {
			this.failIncoming(transfer, channel, 'integrity check failed');
			return;
		}

		await putBlob(
			this.deps.session.roomKeys,
			this.deps.roomId,
			offer.transferId,
			assembled,
			offer.mime,
			this.lifetime.signal
		);
		if (!this.isActive(transfer)) return;
		this.incoming.delete(offer.transferId);
		channel.close();

		this.deps.events.onProgress({
			transferId: offer.transferId,
			direction: 'receive',
			peerDeviceId,
			bytesDone: offer.size,
			bytesTotal: offer.size,
			status: 'done'
		});
		this.deps.events.onReceived(offer, peerDeviceId);
	}
}
