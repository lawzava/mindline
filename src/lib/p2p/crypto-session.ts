/**
 * Per-room crypto context (PROTOCOL.md §1-§3).
 *
 * Owns the room keys, the device identity, the TOFU registry of peer
 * public keys, replay state, and the (epoch, seq) send counters. Every
 * byte the connection layer sends or accepts goes through here.
 */

import { fromB64url, toB64url } from '$lib/crypto/b64';
import { ENVELOPE_VERSION, openEnvelope, sealEnvelope, type Envelope } from '$lib/crypto/envelope';
import { lp } from '$lib/crypto/lp';
import {
	createDeviceIdentity,
	deviceIdFromSpki,
	importPeerPublicKey,
	type DeviceIdentity
} from '$lib/crypto/identity';
import {
	deriveGenerationKeys,
	deriveMediaKey,
	deriveRoomKeys,
	importRoomKeyMaterial,
	type RoomKeys
} from '$lib/crypto/keys';
import {
	allocateEpoch,
	loadIdentity,
	loadRatchetState,
	loadReplayState,
	loadRoomKeys,
	saveIdentity,
	saveRatchetState,
	saveReplayState,
	saveRoomKeys
} from '$lib/crypto/keystore';
import { ReplayGuard } from '$lib/crypto/replay';
import {
	GenerationRatchet,
	MAX_CHAIN,
	type AdoptOutcome,
	type RekeyGrantBody,
	type RekeyRequestBody
} from './ratchet';

interface HelloBody {
	type: 'hello';
	deviceId: string;
	name: string;
	spki: string; // base64url
	proof: string; // base64url HMAC
	g: number; // advertised key generation (§3.4)
	gid: string;
	epoch: number;
	seq: number;
}

export interface PeerInfo {
	deviceId: string;
	name: string;
	/** The peer's advertised generation (§3.4) — advisory, never adopted. */
	g: number;
	gid: string;
}

/** Body types that ride the `hs` class — and only the `hs` class (§2). */
const HS_BODY_TYPES = new Set(['hello', 'rekey-grant', 'rekey-request']);

/**
 * Channel binding for the hello proof (§3.4): a domain label plus the
 * binding fields, fed to lp() as separate fields (§0 — no delimiter
 * joining). Direct: ('hello-v3', [fpLow, fpHigh]); relay:
 * ('hello-relay-v3', [clientIdLow, clientIdHigh, roomId]).
 */
export interface HelloBinding {
	label: 'hello-v3' | 'hello-relay-v3';
	fields: string[];
}

export class CryptoSession {
	readonly roomId: string;
	readonly deviceId: string;

	private keys: RoomKeys;
	private identity: DeviceIdentity;
	private ratchet: GenerationRatchet;
	private peers = new Map<string, { publicKey: CryptoKey; spki: string; name: string }>();
	private guard: ReplayGuard;
	private epoch: number;
	private seq = 0;
	private persistTimer: ReturnType<typeof setTimeout> | null = null;
	private generationCb: ((g: number, gid: string) => void) | null = null;

	private constructor(
		roomId: string,
		keys: RoomKeys,
		identity: DeviceIdentity,
		ratchet: GenerationRatchet,
		guard: ReplayGuard,
		epoch: number
	) {
		this.roomId = roomId;
		this.keys = keys;
		this.identity = identity;
		this.ratchet = ratchet;
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
		let ratchet: GenerationRatchet;
		if (fragmentKey) {
			keys = await deriveRoomKeys(await importRoomKeyMaterial(fragmentKey));
			await saveRoomKeys(roomId, keys);
			// Generation state: resume where the room ratcheted to, else start
			// at the link generation (rk_0 = fragment key, §1.4).
			const state = await loadRatchetState(roomId);
			ratchet = state
				? GenerationRatchet.fromPersisted(roomId, state)
				: GenerationRatchet.atLinkGeneration(roomId, await deriveGenerationKeys(fragmentKey));
			if (!state) await saveRatchetState(roomId, ratchet.state());
			try {
				await navigator.storage?.persist?.();
			} catch {
				/* persistence is best-effort */
			}
		} else {
			keys = await loadRoomKeys(roomId);
			if (!keys) return null;
			// v3 rooms persist generation state alongside the static keys; a
			// room without it cannot derive wire keys — ask for the link again.
			const state = await loadRatchetState(roomId);
			if (!state) return null;
			ratchet = GenerationRatchet.fromPersisted(roomId, state);
		}
		if (!keys) return null;

		let identity = await loadIdentity();
		if (!identity) {
			identity = await createDeviceIdentity();
			await saveIdentity(identity);
		}

		// Session epoch from the device-identity-scoped monotonic high-water
		// (PROTOCOL.md §2). It never regresses across reload, clock
		// correction, or burn, so peers' persisted high-water replay state
		// never censors this device, and concurrent tabs get distinct epochs.
		const epoch = await allocateEpoch(identity.deviceId);

		const replayState = await loadReplayState<import('$lib/crypto/replay').ReplayState>(roomId);
		const guard = replayState ? ReplayGuard.hydrate(replayState) : new ReplayGuard();

		return new CryptoSession(roomId, keys, identity, ratchet, guard, epoch);
	}

	get roomKeys(): RoomKeys {
		return this.keys;
	}

	/** The room's current key generation (§1.4). */
	get generation(): { g: number; gid: string } {
		return { g: this.ratchet.g, gid: this.ratchet.gid };
	}

	/** True when (g, gid) is held — drives the §3.4 hello response. */
	hasGeneration(g: number, gid: string): boolean {
		return this.ratchet.hasInstance(g, gid);
	}

	/** True when any retained instance can decrypt generation `g`. */
	canReadGeneration(g: number): boolean {
		return this.ratchet.keysFor(g).length > 0;
	}

	/** Fires on every local generation change (mint, adopt, refresh). */
	onGenerationChange(cb: (g: number, gid: string) => void): void {
		this.generationCb = cb;
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
	async makeHello(name: string, binding: HelloBinding): Promise<string> {
		const proof = await crypto.subtle.sign(
			'HMAC',
			this.keys.auth,
			lp(binding.label, this.deviceId, ...binding.fields)
		);
		const body: HelloBody = {
			type: 'hello',
			deviceId: this.deviceId,
			name,
			spki: toB64url(this.identity.spki),
			proof: toB64url(new Uint8Array(proof)),
			// Advertise our generation (§3.4) — receivers grant or request
			// off this, but never move their own generation from it.
			g: this.ratchet.g,
			gid: this.ratchet.gid,
			epoch: this.epoch,
			seq: ++this.seq
		};
		// Hello is an 'hs' envelope under the static handshake key (§3.4):
		// a member can verify a joiner regardless of the room's generation.
		return this.sealHs(body as unknown as Record<string, unknown>, false);
	}

	/**
	 * Verify an incoming hello against this side's view of the channel
	 * binding. Registers the peer (TOFU) on success; null on any failure.
	 */
	async acceptHello(wire: string | Envelope, binding: HelloBinding): Promise<PeerInfo | null> {
		try {
			const envelope: Envelope = typeof wire === 'string' ? JSON.parse(wire) : wire;
			if (envelope.t !== 'hs' || !envelope.sig) return null;

			// The hello carries the key we verify it with: decrypt first
			// (handshake-key AAD gate), then check the key binds to the id.
			const spkiProbe = await openEnvelope(envelope, {
				key: this.keys.hs,
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
			if (!Number.isInteger(body.g) || body.g < 0 || typeof body.gid !== 'string') return null;

			// TOFU: a known deviceId must present the same key
			const known = this.peers.get(body.deviceId);
			if (known && known.spki !== body.spki) return null;

			// Channel binding proof, recomputed from our own view (§3.4)
			const proof = fromB64url(body.proof);
			if (!proof) return null;
			const valid = await crypto.subtle.verify(
				'HMAC',
				this.keys.auth,
				proof,
				lp(binding.label, body.deviceId, ...binding.fields)
			);
			if (!valid) return null;

			if (!this.guard.check(body.deviceId, 'msg', body.epoch, body.seq)) return null;
			this.schedulePersist();

			const publicKey = await importPeerPublicKey(spki);
			this.peers.set(body.deviceId, { publicKey, spki: body.spki, name: body.name });
			return { deviceId: body.deviceId, name: body.name, g: body.g, gid: body.gid };
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
		// Must match the v3 envelope AAD for an 'hs' (g=0) envelope (§2).
		const aad = lp(String(ENVELOPE_VERSION), this.roomId, envelope.s, 'hs', '0');
		const plaintext = await crypto.subtle.decrypt(
			{ name: 'AES-GCM', iv: nonce, additionalData: aad },
			this.keys.hs,
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
			key: this.ratchet.currentKeys.msg,
			roomId: this.roomId,
			identity: this.identity,
			klass: 'msg',
			g: this.ratchet.g
		});
		return JSON.stringify(envelope);
	}

	/** Seal a draft/presence body ('eph' class, unsigned). */
	async sealDraft(body: Record<string, unknown>): Promise<string> {
		const stamped = { ...body, epoch: this.epoch, seq: ++this.seq };
		const envelope = await sealEnvelope(stamped, {
			key: this.ratchet.currentKeys.eph,
			roomId: this.roomId,
			identity: this.identity,
			klass: 'eph',
			g: this.ratchet.g
		});
		return JSON.stringify(envelope);
	}

	/** Seal an `hs`-class body (hello, rekey-grant, rekey-request). */
	private async sealHs(body: Record<string, unknown>, stamp = true): Promise<string> {
		const payload = stamp ? { ...body, epoch: this.epoch, seq: ++this.seq } : body;
		const envelope = await sealEnvelope(payload, {
			key: this.keys.hs,
			roomId: this.roomId,
			identity: this.identity,
			klass: 'hs',
			g: 0
		});
		return JSON.stringify(envelope);
	}

	/**
	 * Open any incoming envelope. Throws on unverified senders ('msg'),
	 * bad signatures, failed decryption, unknown generations, body types
	 * on the wrong class (§2), or replays.
	 */
	async openMessage(envelope: Envelope): Promise<Record<string, unknown>> {
		let senderPublicKey: CryptoKey | undefined;
		// Signed classes (msg, hs) require the sender's TOFU key. A duplicate
		// hello arrives here as an 'hs' envelope after the peer is verified.
		if (envelope.t === 'msg' || envelope.t === 'hs') {
			const peer = this.peers.get(envelope.s);
			if (!peer) throw new Error(`unverified sender: ${envelope.s}`);
			senderPublicKey = peer.publicKey;
		}

		// Candidate keys: static k_hs, or trial-decrypt across the retained
		// generation instances at the envelope's g (§1.4).
		let candidates: CryptoKey[];
		if (envelope.t === 'hs') {
			candidates = [this.keys.hs];
		} else {
			const generations = this.ratchet.keysFor(envelope.g);
			if (generations.length === 0) {
				throw new Error(`unknown generation ${envelope.g} from ${envelope.s}`);
			}
			candidates = generations.map((k) => (envelope.t === 'eph' ? k.eph : k.msg));
		}

		let body: Record<string, unknown> | undefined;
		let lastError: unknown;
		for (const key of candidates) {
			try {
				body = (await openEnvelope(envelope, {
					key,
					roomId: this.roomId,
					senderPublicKey
				})) as Record<string, unknown>;
				break;
			} catch (error) {
				lastError = error;
			}
		}
		if (body === undefined) throw lastError ?? new Error('envelope authentication failed');

		// §2: hs carries only handshake bodies; handshake bodies ride only hs.
		if ((envelope.t === 'hs') !== HS_BODY_TYPES.has(String(body.type))) {
			throw new Error(`body type ${String(body.type)} forbidden under ${envelope.t} class`);
		}

		const epoch = Number(body.epoch);
		const seq = Number(body.seq);
		// 'hs' (e.g. a duplicate hello) replays under the reliable 'msg'
		// class, matching how acceptHello tracks the initial hello.
		const replayClass = envelope.t === 'eph' ? 'eph' : 'msg';
		if (!this.guard.check(envelope.s, replayClass, epoch, seq)) {
			throw new Error(`replayed envelope from ${envelope.s} (${epoch}:${seq})`);
		}
		this.schedulePersist();

		return body;
	}

	// ============ generation ratchet (§1.4) ============

	/** Persist + announce a generation change. */
	private async ratchetChanged(): Promise<void> {
		await saveRatchetState(this.roomId, this.ratchet.state());
		this.generationCb?.(this.ratchet.g, this.ratchet.gid);
	}

	/** Mint the next generation; returns the grant wire for broadcast. */
	async mintGeneration(): Promise<string> {
		const grant = await this.ratchet.mintNext(this.identity);
		await this.ratchetChanged();
		const body: RekeyGrantBody = { type: 'rekey-grant', grant };
		return this.sealHs(body as unknown as Record<string, unknown>);
	}

	/**
	 * A grant wire for a peer at `peerG`, with the chain it needs to verify
	 * the gap. When the peer's stated gid is off our line (a losing
	 * sibling / fork), the chain starts one generation earlier so it
	 * carries our cert AT the fork — the receiver's heal rule anchors at
	 * the shared parent (§1.4 "tailor the chain"). Mints first when this
	 * session cannot grant (§1.4 liveness).
	 */
	async grantWireFor(peerG: number, peerGid?: string): Promise<string> {
		if (!this.ratchet.canGrant()) {
			await this.ratchet.mintNext(this.identity);
			await this.ratchetChanged();
		}
		const grant = this.ratchet.currentGrant()!;
		let fromG = Math.max(0, peerG);
		if (peerGid !== undefined && fromG >= 1 && !this.ratchet.onLine(fromG, peerGid)) {
			fromG -= 1;
		}
		const chain = this.ratchet.chainTail(fromG).slice(-MAX_CHAIN);
		const body: RekeyGrantBody = { type: 'rekey-grant', grant, chain };
		return this.sealHs(body as unknown as Record<string, unknown>);
	}

	/** Run a received grant through §1.4 convergence. */
	async handleRekeyGrant(body: RekeyGrantBody): Promise<AdoptOutcome> {
		const outcome = await this.ratchet.adopt(body.grant, body.chain ?? []);
		if (outcome === 'adopted' || outcome === 'sibling-retained') await this.ratchetChanged();
		return outcome;
	}

	/** The direct-only ask for a generation we saw but cannot read (§1.4). */
	async makeRekeyRequestWire(g: number, gid?: string): Promise<string> {
		const body: RekeyRequestBody = {
			type: 'rekey-request',
			g,
			gid,
			haveG: this.ratchet.g,
			haveGid: this.ratchet.gid
		};
		return this.sealHs(body as unknown as Record<string, unknown>);
	}

	/** Answer a rekey-request: grant, minting if necessary (liveness). */
	async handleRekeyRequest(body: RekeyRequestBody): Promise<string> {
		const haveG = Number.isInteger(body.haveG) && body.haveG >= 0 ? body.haveG : 0;
		const haveGid = typeof body.haveGid === 'string' ? body.haveGid : undefined;
		return this.grantWireFor(haveG, haveGid);
	}

	/**
	 * Re-read the persisted generation state (multi-tab: a sibling tab
	 * minted or adopted and notified us). True when the generation moved.
	 */
	async refreshFromStore(): Promise<boolean> {
		const state = await loadRatchetState(this.roomId);
		if (!state) return false;
		if (state.g === this.ratchet.g && state.gid === this.ratchet.gid) return false;
		this.ratchet = GenerationRatchet.fromPersisted(this.roomId, state);
		this.generationCb?.(this.ratchet.g, this.ratchet.gid);
		return true;
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
