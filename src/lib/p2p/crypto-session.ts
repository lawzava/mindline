/**
 * Per-room crypto context (PROTOCOL.md §1-§3).
 *
 * Owns the room keys, the device identity, the TOFU registry of peer
 * public keys, replay state, and the (epoch, seq) send counters. Every
 * byte the connection layer sends or accepts goes through here.
 */

import { fromB64url, toB64url } from '$lib/crypto/b64';
import { openEnvelope, sealEnvelope, type Envelope } from '$lib/crypto/envelope';
import { lp } from '$lib/crypto/lp';
import {
	createDeviceIdentity,
	deviceIdFromSpki,
	importPeerPublicKey,
	type DeviceIdentity
} from '$lib/crypto/identity';
import { deriveMediaKey, deriveRoomKeys, importRoomKeyMaterial, type RoomKeys } from '$lib/crypto/keys';
import {
	loadIdentity,
	loadReplayState,
	loadRoomKeys,
	saveIdentity,
	saveReplayState,
	saveRoomKeys
} from '$lib/crypto/keystore';
import { ReplayGuard } from '$lib/crypto/replay';

interface HelloBody {
	type: 'hello';
	deviceId: string;
	name: string;
	spki: string; // base64url
	proof: string; // base64url HMAC
	epoch: number;
	seq: number;
}

export interface PeerInfo {
	deviceId: string;
	name: string;
}

function epochStorageKey(deviceId: string): string {
	return `mindline_epoch_${deviceId}`;
}

export class CryptoSession {
	readonly roomId: string;
	readonly deviceId: string;

	private keys: RoomKeys;
	private identity: DeviceIdentity;
	private peers = new Map<string, { publicKey: CryptoKey; spki: string; name: string }>();
	private guard: ReplayGuard;
	private epoch: number;
	private seq = 0;
	private persistTimer: ReturnType<typeof setTimeout> | null = null;

	private constructor(
		roomId: string,
		keys: RoomKeys,
		identity: DeviceIdentity,
		guard: ReplayGuard,
		epoch: number
	) {
		this.roomId = roomId;
		this.keys = keys;
		this.identity = identity;
		this.guard = guard;
		this.epoch = epoch;
		this.deviceId = identity.deviceId;
	}

	/**
	 * fragmentKey: raw 32 bytes from the URL fragment, or null to load
	 * previously persisted keys. Returns null when neither exists — the
	 * caller is knocking on a room it has no key for.
	 */
	static async create(roomId: string, fragmentKey: Uint8Array | null): Promise<CryptoSession | null> {
		let keys: RoomKeys | null;
		if (fragmentKey) {
			keys = await deriveRoomKeys(await importRoomKeyMaterial(fragmentKey));
			await saveRoomKeys(roomId, keys);
			try {
				await navigator.storage?.persist?.();
			} catch {
				/* persistence is best-effort */
			}
		} else {
			keys = await loadRoomKeys(roomId);
		}
		if (!keys) return null;

		let identity = await loadIdentity();
		if (!identity) {
			identity = await createDeviceIdentity();
			await saveIdentity(identity);
		}

		// Session epoch: persisted counter, incremented every session start.
		// An absent counter (first run, or after a burn) seeds from the clock
		// so peers' persisted high-water replay state never censors this
		// device (PROTOCOL.md §2).
		let epoch: number;
		try {
			const stored = Number(localStorage.getItem(epochStorageKey(identity.deviceId))) || 0;
			epoch = stored > 0 ? stored + 1 : Date.now();
			localStorage.setItem(epochStorageKey(identity.deviceId), String(epoch));
		} catch {
			epoch = Date.now(); // no localStorage: monotonic enough per device
		}

		const replayState = await loadReplayState<import('$lib/crypto/replay').ReplayState>(roomId);
		const guard = replayState ? ReplayGuard.hydrate(replayState) : new ReplayGuard();

		return new CryptoSession(roomId, keys, identity, guard, epoch);
	}

	get roomKeys(): RoomKeys {
		return this.keys;
	}

	/** Per-transfer media subkey (PROTOCOL.md §5.2). */
	async mediaKey(transferId: string): Promise<CryptoKey> {
		return deriveMediaKey(this.keys, transferId);
	}

	isVerified(deviceId: string): boolean {
		return this.peers.has(deviceId);
	}

	peerName(deviceId: string): string | undefined {
		return this.peers.get(deviceId)?.name;
	}

	/** HMAC proof binding this device to a signaling clientId (§3.1). */
	async signalingAuth(clientId: string): Promise<string> {
		const tag = await crypto.subtle.sign(
			'HMAC',
			this.keys.auth,
			lp(this.deviceId, clientId, this.roomId)
		);
		return toB64url(new Uint8Array(tag));
	}

	async verifySignalingAuth(deviceId: string, clientId: string, tag: string): Promise<boolean> {
		const bytes = fromB64url(tag);
		if (!bytes) return false;
		return crypto.subtle.verify(
			'HMAC',
			this.keys.auth,
			bytes,
			lp(deviceId, clientId, this.roomId)
		);
	}

	/** Key-confirmation hello (§3.4), serialized for the wire. */
	async makeHello(name: string, channelBinding: string): Promise<string> {
		const proof = await crypto.subtle.sign(
			'HMAC',
			this.keys.auth,
			lp('hello', this.deviceId, channelBinding)
		);
		const body: HelloBody = {
			type: 'hello',
			deviceId: this.deviceId,
			name,
			spki: toB64url(this.identity.spki),
			proof: toB64url(new Uint8Array(proof)),
			epoch: this.epoch,
			seq: ++this.seq
		};
		const envelope = await sealEnvelope(body, {
			keys: this.keys,
			roomId: this.roomId,
			identity: this.identity,
			klass: 'msg'
		});
		return JSON.stringify(envelope);
	}

	/**
	 * Verify an incoming hello against this side's view of the channel
	 * binding. Registers the peer (TOFU) on success; null on any failure.
	 */
	async acceptHello(wire: string | Envelope, channelBinding: string): Promise<PeerInfo | null> {
		try {
			const envelope: Envelope = typeof wire === 'string' ? JSON.parse(wire) : wire;
			if (envelope.t !== 'msg' || !envelope.sig) return null;

			// The hello carries the key we verify it with: decrypt first
			// (room-key AAD gate), then check the key binds to the claimed id.
			const spkiProbe = await openEnvelope(envelope, {
				keys: this.keys,
				roomId: this.roomId,
				senderPublicKey: await this.probeHelloKey(envelope)
			});
			const body = spkiProbe as HelloBody;
			if (body.type !== 'hello') return null;

			const spki = fromB64url(body.spki);
			if (!spki) return null;
			if ((await deviceIdFromSpki(spki)) !== body.deviceId || body.deviceId !== envelope.s) {
				return null;
			}

			// TOFU: a known deviceId must present the same key
			const known = this.peers.get(body.deviceId);
			if (known && known.spki !== body.spki) return null;

			// Channel binding proof
			const proof = fromB64url(body.proof);
			if (!proof) return null;
			const valid = await crypto.subtle.verify(
				'HMAC',
				this.keys.auth,
				proof,
				lp('hello', body.deviceId, channelBinding)
			);
			if (!valid) return null;

			if (!this.guard.check(body.deviceId, 'msg', body.epoch, body.seq)) return null;
			this.schedulePersist();

			const publicKey = await importPeerPublicKey(spki);
			this.peers.set(body.deviceId, { publicKey, spki: body.spki, name: body.name });
			return { deviceId: body.deviceId, name: body.name };
		} catch {
			return null;
		}
	}

	/**
	 * The hello carries the key it is verified with, so peek inside first:
	 * decrypt manually (room-key + AAD gate keeps out non-members), import
	 * the self-declared SPKI, and hand it back for the full signed open.
	 */
	private async probeHelloKey(envelope: Envelope): Promise<CryptoKey> {
		const nonce = fromB64url(envelope.n);
		const ciphertext = fromB64url(envelope.c);
		if (!nonce || !ciphertext) throw new Error('malformed hello');
		const aad = lp(this.roomId, envelope.s, 'msg');
		const plaintext = await crypto.subtle.decrypt(
			{ name: 'AES-GCM', iv: nonce, additionalData: aad },
			this.keys.msg,
			ciphertext
		);
		const body = JSON.parse(new TextDecoder().decode(plaintext)) as HelloBody;
		const spki = fromB64url(body.spki);
		if (!spki) throw new Error('malformed hello spki');
		return importPeerPublicKey(spki);
	}

	/** Seal a reliable message body ('msg' class, signed). */
	async sealMessage(body: Record<string, unknown>): Promise<string> {
		const stamped = { ...body, epoch: this.epoch, seq: ++this.seq };
		const envelope = await sealEnvelope(stamped, {
			keys: this.keys,
			roomId: this.roomId,
			identity: this.identity,
			klass: 'msg'
		});
		return JSON.stringify(envelope);
	}

	/** Seal a draft/presence body ('eph' class, unsigned). */
	async sealDraft(body: Record<string, unknown>): Promise<string> {
		const stamped = { ...body, epoch: this.epoch, seq: ++this.seq };
		const envelope = await sealEnvelope(stamped, {
			keys: this.keys,
			roomId: this.roomId,
			identity: this.identity,
			klass: 'eph'
		});
		return JSON.stringify(envelope);
	}

	/**
	 * Open any incoming envelope. Throws on unverified senders ('msg'),
	 * bad signatures, failed decryption, or replays.
	 */
	async openMessage(envelope: Envelope): Promise<Record<string, unknown>> {
		let senderPublicKey: CryptoKey | undefined;
		if (envelope.t === 'msg') {
			const peer = this.peers.get(envelope.s);
			if (!peer) throw new Error(`unverified sender: ${envelope.s}`);
			senderPublicKey = peer.publicKey;
		}

		const body = (await openEnvelope(envelope, {
			keys: this.keys,
			roomId: this.roomId,
			senderPublicKey
		})) as Record<string, unknown>;

		const epoch = Number(body.epoch);
		const seq = Number(body.seq);
		if (!this.guard.check(envelope.s, envelope.t, epoch, seq)) {
			throw new Error(`replayed envelope from ${envelope.s} (${epoch}:${seq})`);
		}
		this.schedulePersist();

		return body;
	}

	/** Debounced replay-state persistence. */
	private schedulePersist(): void {
		if (this.persistTimer) return;
		this.persistTimer = setTimeout(() => {
			this.persistTimer = null;
			void saveReplayState(this.roomId, this.guard.serialize());
		}, 1000);
	}
}
