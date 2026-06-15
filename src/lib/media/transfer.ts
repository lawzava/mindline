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
import { hasQuotaFor, putBlob } from './blob-store';

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
/** Caps per kind (§5.1). */
export const SIZE_CAPS: Record<MediaKind, number> = {
	image: 25 * 1024 * 1024,
	file: 100 * 1024 * 1024,
	voice: 30 * 1024 * 1024,
	video: 50 * 1024 * 1024
};

interface OutgoingTransfer {
	offer: MediaOffer;
	data: Uint8Array;
	salt: Uint8Array;
	accepted: Set<string>; // peerDeviceIds already served
}

interface IncomingTransfer {
	offer: MediaOffer;
	peerDeviceId: string;
	salt: Uint8Array;
	chunks: Map<number, Uint8Array>;
	bytesDone: number;
}

export async function sha256b64url(data: Uint8Array): Promise<string> {
	return toB64url(new Uint8Array(await crypto.subtle.digest('SHA-256', data as BufferSource)));
}

export class MediaTransferEngine {
	private deps: TransferDeps;
	private outgoing = new Map<string, OutgoingTransfer>();
	private incoming = new Map<string, IncomingTransfer>();
	/** Offers awaiting explicit user consent, keyed by transferId. */
	readonly pendingConsent = new Map<string, { offer: MediaOffer; peerDeviceId: string }>();

	constructor(deps: TransferDeps) {
		this.deps = deps;
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

		this.outgoing.set(transferId, { offer, data, salt, accepted: new Set() });

		// Persist locally so the sender can re-render their own media.
		await putBlob(this.deps.session.roomKeys, this.deps.roomId, transferId, data, meta.mime);

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
		switch (message.type) {
			case 'media-offer':
				await this.handleOffer(message, peerDeviceId);
				break;
			case 'media-accept':
				await this.serve(message.transferId, peerDeviceId);
				break;
			case 'media-abort': {
				this.incoming.delete(message.transferId);
				this.pendingConsent.delete(message.transferId);
				this.deps.events.onAborted(message.transferId, message.reason, peerDeviceId);
				break;
			}
		}
	}

	private async handleOffer(offer: MediaOffer, peerDeviceId: string): Promise<void> {
		if (offer.size > SIZE_CAPS[offer.kind] || offer.size <= 0) {
			this.abort(offer.transferId, peerDeviceId, 'size cap exceeded');
			return;
		}
		if (!(await hasQuotaFor(offer.size))) {
			this.abort(offer.transferId, peerDeviceId, 'not enough storage space');
			return;
		}

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
			bytesDone: 0
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
		if (!transfer || transfer.accepted.has(peerDeviceId)) return;
		transfer.accepted.add(peerDeviceId);

		const channel = this.deps.openChannel(peerDeviceId, `media-${transferId}`);
		if (!channel) {
			this.deps.events.onAborted(transferId, 'peer unreachable for direct transfer', peerDeviceId);
			return;
		}
		channel.binaryType = 'arraybuffer';
		channel.bufferedAmountLowThreshold = BUFFERED_LOW;

		const key = await this.deps.session.mediaKey(transferId);
		const total = transfer.data.byteLength;
		const chunkCount = Math.max(1, Math.ceil(total / CHUNK_SIZE));

		const waitOpen = () =>
			new Promise<void>((resolve, reject) => {
				if (channel.readyState === 'open') return resolve();
				channel.onopen = () => resolve();
				channel.onerror = () => reject(new Error('media channel failed to open'));
				setTimeout(() => reject(new Error('media channel open timeout')), 20000);
			});

		// Attach the persistent low-watermark waiter BEFORE sending (§5.2):
		// bufferedamountlow only fires on downward crossings.
		let lowResolve: (() => void) | null = null;
		channel.addEventListener('bufferedamountlow', () => {
			lowResolve?.();
			lowResolve = null;
		});
		const drain = () =>
			new Promise<void>((resolve) => {
				if (channel.bufferedAmount <= BUFFERED_HIGH) return resolve();
				lowResolve = resolve;
				// Re-check after attach: the buffer may have drained already.
				if (channel.bufferedAmount <= BUFFERED_LOW) {
					lowResolve = null;
					resolve();
				}
			});

		try {
			await waitOpen();
			for (let i = 0; i < chunkCount; i++) {
				const slice = transfer.data.subarray(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
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
			console.warn('[Media] send failed:', error);
			try {
				channel.close();
			} catch {
				/* already closed */
			}
			this.abort(transferId, peerDeviceId, 'send failed');
			this.deps.events.onAborted(transferId, 'send failed', peerDeviceId);
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

		channel.onmessage = (event) => void this.onFrame(transfer, channel, event.data);
		channel.onclose = () => {
			// Closed before completion: drop partials (no resume in v1).
			if (this.incoming.has(transferId)) {
				this.incoming.delete(transferId);
				this.deps.events.onAborted(transferId, 'peer closed mid-transfer', peerDeviceId);
			}
		};
	}

	private async onFrame(
		transfer: IncomingTransfer,
		channel: RTCDataChannel,
		raw: unknown
	): Promise<void> {
		const { offer, peerDeviceId } = transfer;

		if (typeof raw === 'string') {
			// Control frame: complete
			try {
				const control = JSON.parse(raw);
				if (control.type === 'complete') await this.finalize(transfer, channel);
			} catch {
				/* ignore noise */
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
			console.warn('[Media] dropping transfer:', error);
			this.incoming.delete(offer.transferId);
			channel.close();
			this.abort(offer.transferId, peerDeviceId, 'chunk verification failed');
			this.deps.events.onAborted(offer.transferId, 'chunk verification failed', peerDeviceId);
		}
	}

	private async finalize(transfer: IncomingTransfer, channel: RTCDataChannel): Promise<void> {
		const { offer, peerDeviceId } = transfer;
		this.incoming.delete(offer.transferId);

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
		if (
			assembled.byteLength !== offer.size ||
			indices.length !== expectedCount ||
			hash !== offer.sha256
		) {
			channel.close();
			this.abort(offer.transferId, peerDeviceId, 'integrity check failed');
			this.deps.events.onAborted(offer.transferId, 'integrity check failed', peerDeviceId);
			return;
		}

		await putBlob(
			this.deps.session.roomKeys,
			this.deps.roomId,
			offer.transferId,
			assembled,
			offer.mime
		);
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
