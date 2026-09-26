/**
 * Per-room crypto context (PROTOCOL.md §1-§3).
 *
 * Owns the room keys, the device identity, the TOFU registry of peer
 * public keys, replay state, and the (epoch, seq) send counters. Every
 * byte the connection layer sends or accepts goes through here.
 */

import { fromB64url, toB64url } from '$lib/crypto/b64';
import {
	ENVELOPE_VERSION,
	envelopeSignatureValid,
	openEnvelope,
	sealEnvelope,
	type Envelope
} from '$lib/crypto/envelope';
import { lp } from '$lib/crypto/lp';
import { deviceFingerprint, safetyNumber, toHex } from '$lib/crypto/safety';
import { signOrigin } from '$lib/crypto/origin';
import {
	signRosterOp,
	signVoucher,
	type RosterAction,
	type RosterLink,
	type RosterOp,
	type Voucher
} from './roster';
import type { Message, MessageOrigin } from '$lib/types/message';
import {
	deviceIdFromSpki,
	importPeerPublicKey,
	type DeviceIdentity,
	type KemIdentity
} from '$lib/crypto/identity';
import {
	generateKemSeed,
	isUsableKemPublicKey,
	kemKeypair,
	unwrapSecret,
	wrapSecret
} from '$lib/crypto/kem';
import {
	deriveGenerationKeys,
	deriveMediaKey,
	deriveRoomKeys,
	importRoomKeyMaterial,
	type RoomKeys
} from '$lib/crypto/keys';
import {
	allocateEpoch,
	getOrCreateIdentity,
	getOrCreateKemIdentity,
	loadRatchetState,
	loadReplayState,
	loadRoomKeys,
	saveRatchetState,
	saveReplayState,
	saveRoomKeys
} from '$lib/crypto/keystore';
import { ReplayGuard } from '$lib/crypto/replay';
import { ChainStore, sendKey, startChain, type Chain } from '$lib/crypto/chain';
import {
	certOf,
	GenerationRatchet,
	MAX_CHAIN,
	verifyCert,
	type AdoptOutcome,
	type RekeyGrant,
	type RekeyGrantBody,
	type RekeyRequestBody,
	type WrappedGrant
} from './ratchet';

/** A chained message arrived for a chain this device was never granted (§1.5). */
export class ChainMissingError extends Error {
	constructor(
		readonly sender: string,
		readonly g: number,
		readonly chainId: string
	) {
		super('no grant for this sender-key chain');
		this.name = 'ChainMissingError';
	}
}

/** A sender's chain position, X-Wing wrapped for one member (§1.5). */
export interface ChainGrantBody {
	type: 'chain-grant';
	g: number;
	k: string;
	i: number;
	wrap: { ct: string; n: string; wrapped: string };
}

interface HelloBody {
	type: 'hello';
	deviceId: string;
	name: string;
	spki: string; // base64url
	kem: string; // base64url X-Wing public key (§1.3/§1.4 v4)
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

/**
 * The URL carries a key for a room this device already holds under a
 * different key. Adopting it would re-encrypt the real history under the
 * newcomer's key and serve it to whoever minted that link (§1.2).
 */
export class RoomKeyMismatchError extends Error {
	constructor() {
		super('The link key does not match the key stored for this room');
		this.name = 'RoomKeyMismatchError';
	}
}

/** 24 bytes of HMAC(k_auth, "mindline/v2/rendezvous", roomId), base64url. */
async function rendezvousFor(keys: RoomKeys, roomId: string): Promise<string> {
	const mac = await crypto.subtle.sign('HMAC', keys.auth, lp('mindline/v2/rendezvous', roomId));
	return toB64url(new Uint8Array(mac).slice(0, 24));
}

/** Whether two link-static key sets came from the same link key. */
async function sameRoomKey(roomId: string, a: RoomKeys, b: RoomKeys): Promise<boolean> {
	const probe = lp('mindline/v2/key-commit', roomId);
	const tag = await crypto.subtle.sign('HMAC', a.auth, probe);
	return crypto.subtle.verify('HMAC', b.auth, tag, probe);
}

/** Body types that ride the `hs` class — and only the `hs` class (§2). */
const HS_BODY_TYPES = new Set(['hello', 'rekey-grant', 'rekey-request', 'admission']);

/** Display-name cap in hellos (§3.4) — keeps relay hellos frame-bounded. */
export const HELLO_NAME_MAX = 64;

/**
 * Channel binding for the hello proof (§3.4): a domain label plus the
 * binding fields, fed to lp() as separate fields (§0 — no delimiter
 * joining). Direct: ('hello-v4', [fpLow, fpHigh]); relay:
 * ('hello-relay-v4', [clientIdLow, clientIdHigh, roomId]). The proof also
 * covers the sender's KEM public key (between deviceId and the fields).
 */
export interface HelloBinding {
	label: 'hello-v4' | 'hello-relay-v4';
	fields: string[];
}

export class CryptoSession {
	readonly roomId: string;
	/**
	 * The signaling room name (§3.1): derived from the link key, so the
	 * operator and anyone who only saw the URL path cannot find the room.
	 */
	rendezvousId = '';
	readonly deviceId: string;

	private keys: RoomKeys;
	private identity: DeviceIdentity;
	private kem: KemIdentity;
	private ratchet: GenerationRatchet;
	private peers = new Map<
		string,
		{ publicKey: CryptoKey; spki: string; kem: string; name: string }
	>();
	private guard: ReplayGuard;
	private epoch: number;
	private seq = 0;
	private persistTimer: ReturnType<typeof setTimeout> | null = null;
	private generationCb: ((g: number, gid: string) => void) | null = null;
	/** This tab's sender-key chain for the current generation (§1.5), memory only. */
	private sendChain: Chain | null = null;
	/** Serializes chain use: no two messages or grants race on one index. */
	private chainLock: Promise<unknown> = Promise.resolve();
	/** Chains other members granted this device. */
	private readonly receivedChains = new ChainStore();
	/** This tab's in-memory X-Wing pair for receiving chain grants. */
	private chainKem: { seed: Uint8Array; publicKey: Uint8Array } | null = null;
	/** Members' in-memory chain keys, from their signed chain-key bodies. */
	private readonly peerChainKeys = new Map<string, Uint8Array>();

	private constructor(
		roomId: string,
		keys: RoomKeys,
		identity: DeviceIdentity,
		kem: KemIdentity,
		ratchet: GenerationRatchet,
		guard: ReplayGuard,
		epoch: number
	) {
		this.roomId = roomId;
		this.keys = keys;
		this.identity = identity;
		this.kem = kem;
		this.ratchet = ratchet;
		this.guard = guard;
		this.epoch = epoch;
		this.deviceId = identity.deviceId;
	}

	/**
	 * fragmentKey: raw 32 bytes from the URL fragment, or null to load
	 * previously persisted keys. Returns null when neither exists — the
	 * caller is knocking on a room it has no key for. Throws
	 * RoomKeyMismatchError when the fragment key differs from the stored one.
	 */
	static async create(
		roomId: string,
		fragmentKey: Uint8Array | null
	): Promise<CryptoSession | null> {
		let keys: RoomKeys | null;
		let ratchet: GenerationRatchet;
		if (fragmentKey) {
			keys = await deriveRoomKeys(await importRoomKeyMaterial(fragmentKey));
			const stored = await loadRoomKeys(roomId);
			if (stored && !(await sameRoomKey(roomId, keys, stored))) {
				throw new RoomKeyMismatchError();
			}
			await saveRoomKeys(roomId, keys, fragmentKey);
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

		// Atomic get-or-create (§1.3): concurrent first tabs must converge on
		// one deviceId — a plain load-then-save races them onto divergent
		// identities and peers TOFU-reject the loser.
		const identity = await getOrCreateIdentity();

		// Device KEM identity (§1.3 v4): receives the hybrid grant wraps.
		// Atomic get-or-create — concurrent tabs must converge on one seed.
		const kem = await getOrCreateKemIdentity();

		// Session epoch from the device-identity-scoped monotonic high-water
		// (PROTOCOL.md §2). It never regresses across reload, clock
		// correction, or burn, so peers' persisted high-water replay state
		// never censors this device, and concurrent tabs get distinct epochs.
		const epoch = await allocateEpoch(identity.deviceId);

		const replayState = await loadReplayState<import('$lib/crypto/replay').ReplayState>(roomId);
		const guard = replayState ? ReplayGuard.hydrate(replayState) : new ReplayGuard();

		const session = new CryptoSession(roomId, keys, identity, kem, ratchet, guard, epoch);
		session.rendezvousId = await rendezvousFor(keys, roomId);
		return session;
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

	/**
	 * An admission notice (§3.8) on the handshake class: readable by a device
	 * that holds the link but has not been granted the current generation.
	 */
	sealAdmission(body: Record<string, unknown>): Promise<string> {
		return this.sealHs(body);
	}

	/** Sign a roster change as this device (§3.8). */
	rosterOp(
		fields: RosterLink & { device: string; action: RosterAction; salt?: string }
	): Promise<RosterOp> {
		return signRosterOp(this.identity, this.roomId, fields);
	}

	/** Sign a voucher letting a waiting device in, as a member (§3.8). */
	voucher(fields: { device: string; basis: number; epoch: number }): Promise<Voucher> {
		return signVoucher(this.identity, this.roomId, fields);
	}

	/** Sign a message's current state as its author (§3.5). */
	signMessage(msg: Message): Promise<MessageOrigin> {
		return signOrigin(this.identity, this.roomId, msg);
	}

	isVerified(deviceId: string): boolean {
		return this.peers.has(deviceId);
	}

	/**
	 * Safety number with a hello-verified peer (§1.3), plus the peer's hex
	 * fingerprint so a person's verification can be pinned to exact keys.
	 */
	async safetyFor(deviceId: string): Promise<{ number: string; fingerprint: string } | null> {
		const peer = this.peers.get(deviceId);
		if (!peer) return null;
		const [mine, theirs] = await Promise.all([
			deviceFingerprint(toB64url(this.identity.spki), toB64url(this.kem.publicKey)),
			deviceFingerprint(peer.spki, peer.kem)
		]);
		return { number: await safetyNumber(mine, theirs), fingerprint: toHex(theirs) };
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
		return crypto.subtle.verify('HMAC', this.keys.auth, bytes, lp(deviceId, clientId, this.roomId));
	}

	/** Key-confirmation hello (§3.4), serialized for the wire. */
	async makeHello(name: string, binding: HelloBinding): Promise<string> {
		// Names are display hints (§3.7); the clamp bounds the hello so the
		// relay variant always fits the §3.6 frame budget (review V4-PQ-03).
		name = name.slice(0, HELLO_NAME_MAX);
		const kemB64 = toB64url(this.kem.publicKey);
		// The proof covers the KEM key: a stripped or substituted key fails
		// the HMAC even before the envelope signature is considered.
		const proof = await crypto.subtle.sign(
			'HMAC',
			this.keys.auth,
			lp(binding.label, this.deviceId, kemB64, ...binding.fields)
		);
		const body: HelloBody = {
			type: 'hello',
			deviceId: this.deviceId,
			name,
			spki: toB64url(this.identity.spki),
			kem: kemB64,
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

			// The KEM key is mandatory in v4 — fail closed on absence, shape,
			// or an encapsulation-invalid key (it would strand its presenter
			// from every future grant; reject at the door instead).
			const kemBytes = typeof body.kem === 'string' ? fromB64url(body.kem) : null;
			if (!kemBytes || !isUsableKemPublicKey(kemBytes)) return null;

			// TOFU: a known deviceId must present the same keys (both of them)
			const known = this.peers.get(body.deviceId);
			if (known && (known.spki !== body.spki || known.kem !== body.kem)) return null;

			// Channel binding proof, recomputed from our own view (§3.4)
			const proof = fromB64url(body.proof);
			if (!proof) return null;
			const valid = await crypto.subtle.verify(
				'HMAC',
				this.keys.auth,
				proof,
				lp(binding.label, body.deviceId, body.kem, ...binding.fields)
			);
			if (!valid) return null;

			if (!this.guard.check(body.deviceId, 'msg', body.epoch, body.seq)) return null;
			this.schedulePersist();

			const publicKey = await importPeerPublicKey(spki);
			this.peers.set(body.deviceId, {
				publicKey,
				spki: body.spki,
				kem: body.kem,
				name: body.name
			});
			// A new connection may be a new tab with a new chain key (§1.5):
			// wait for it instead of wrapping grants to the old one.
			this.peerChainKeys.delete(body.deviceId);
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

	// ============ sender-key chains (§1.5) ============

	private currentSendChain(): Chain {
		if (!this.sendChain || this.sendChain.g !== this.ratchet.g) {
			this.sendChain?.key.fill(0);
			this.sendChain = startChain(this.ratchet.g);
		}
		return this.sendChain;
	}

	private withChain<T>(fn: () => Promise<T>): Promise<T> {
		const run = this.chainLock.then(fn, fn);
		this.chainLock = run.catch(() => {});
		return run;
	}

	/** The chain the next chained message uses; a new generation starts a new one. */
	currentChainId(): string {
		return this.currentSendChain().id;
	}

	/**
	 * Seal a reliable body under the next key of chain `chainId`, or null when
	 * that chain is no longer current (the generation moved): the caller then
	 * grants the new chain before sealing again.
	 */
	sealChained(body: Record<string, unknown>, chainId: string): Promise<string | null> {
		return this.withChain(async () => {
			const chain = this.currentSendChain();
			if (chain.id !== chainId) return null;
			const { index, key } = await sendKey(chain);
			const stamped = { ...body, epoch: this.epoch, seq: ++this.seq };
			const envelope = await sealEnvelope(stamped, {
				key,
				roomId: this.roomId,
				identity: this.identity,
				klass: 'msg',
				g: chain.g,
				chain: { id: chain.id, index }
			});
			return JSON.stringify(envelope);
		});
	}

	/**
	 * This tab's own key pair for receiving chain grants (§1.5): X-Wing, drawn
	 * fresh and held in memory only, so a grant recorded on the wire cannot be
	 * unwrapped by anyone who later reads this device's storage.
	 */
	private chainKemPair(): { seed: Uint8Array; publicKey: Uint8Array } {
		if (!this.chainKem) {
			const seed = generateKemSeed();
			this.chainKem = { seed, publicKey: kemKeypair(seed).publicKey };
		}
		return this.chainKem;
	}

	/** Tell a member where to wrap chain grants for this tab (a signed msg). */
	async chainKeyWire(): Promise<string> {
		const body = { type: 'chain-key', pub: toB64url(this.chainKemPair().publicKey) };
		return this.sealMessage(body);
	}

	/** A member's in-memory chain key, from the verified device that sent it. */
	async handleChainKey(body: { pub?: unknown }, from: string): Promise<void> {
		if (!this.peers.has(from)) throw new Error('chain key from an unverified device');
		const pub = typeof body?.pub === 'string' ? fromB64url(body.pub) : null;
		if (!pub || !isUsableKemPublicKey(pub)) throw new Error('malformed chain key');
		this.peerChainKeys.set(from, pub);
	}

	/** Whether this member has sent the key its chain grants are wrapped to. */
	hasChainKeyFor(deviceId: string): boolean {
		return this.peerChainKeys.has(deviceId);
	}

	/**
	 * A grant of this tab's current chain position for one verified member,
	 * wrapped to that member's in-memory chain key and bound to room,
	 * generation, sender, chain, index, and recipient. Null when the member
	 * has not sent its chain key yet, or when `chainId` is no longer current.
	 */
	chainGrantWireFor(
		recipientDeviceId: string,
		chainId?: string
	): Promise<{ wire: string; chainId: string; g: number; gid: string } | null> {
		return this.withChain(async () => {
			if (!this.peers.has(recipientDeviceId)) {
				throw new Error(`unverified recipient ${recipientDeviceId}`);
			}
			const recipientKem = this.peerChainKeys.get(recipientDeviceId);
			if (!recipientKem) return null;
			const chain = this.currentSendChain();
			if (chainId !== undefined && chain.id !== chainId) return null;
			const index = chain.index;
			const secret = chain.key.slice();
			try {
				const wrap = await wrapSecret(recipientKem, secret, {
					roomId: this.roomId,
					g: chain.g,
					gid: `${this.deviceId}/${chain.id}/${index}`,
					recipientDeviceId,
					purpose: 'chain-wrap'
				});
				const body: ChainGrantBody = {
					type: 'chain-grant',
					g: chain.g,
					k: chain.id,
					i: index,
					wrap: { ct: toB64url(wrap.ct), n: toB64url(wrap.n), wrapped: toB64url(wrap.wrapped) }
				};
				// Sealed at the chain's generation, which the caller has granted.
				const wire = await this.sealMessage(body as unknown as Record<string, unknown>);
				// The generation the grant was sealed at, captured under the lock.
				return { wire, chainId: chain.id, g: chain.g, gid: this.ratchet.gid };
			} finally {
				secret.fill(0);
			}
		});
	}

	/**
	 * Take a chain grant from `from` (the verified device the envelope came
	 * from), sealed at generation `envelopeG`. Fail-closed: a grant wrapped
	 * for another device or another tab, re-sent by a member as its own, or
	 * naming another generation, yields nothing.
	 */
	async handleChainGrant(body: ChainGrantBody, from: string, envelopeG: number): Promise<void> {
		const { g, k, i, wrap } = body ?? ({} as ChainGrantBody);
		if (!Number.isSafeInteger(g) || g < 0 || !Number.isSafeInteger(i) || i < 0) {
			throw new Error('malformed chain grant');
		}
		if (typeof k !== 'string' || k.length === 0 || k.length > 64) {
			throw new Error('malformed chain grant');
		}
		if (g !== envelopeG || this.ratchet.keysFor(g).length === 0) {
			throw new Error('chain grant for a generation this device does not hold');
		}
		if (!this.peers.has(from)) throw new Error('chain grant from an unverified device');
		if (!this.chainKem) throw new Error('no chain key to unwrap with');
		const ct = wrap && fromB64url(wrap.ct);
		const n = wrap && fromB64url(wrap.n);
		const wrapped = wrap && fromB64url(wrap.wrapped);
		if (!ct || !n || !wrapped) throw new Error('malformed chain grant');
		const secret = await unwrapSecret(
			this.chainKem.seed,
			{ ct, n, wrapped },
			{
				roomId: this.roomId,
				g,
				gid: `${from}/${k}/${i}`,
				recipientDeviceId: this.deviceId,
				purpose: 'chain-wrap'
			}
		);
		if (!secret || secret.length !== 32) throw new Error('chain grant unwrap failed');
		this.receivedChains.accept(from, g, k, i, secret);
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
	/**
	 * channelDevice: the verified device on the channel the envelope arrived
	 * on. Forwarders re-sign (§1.4), so a signer other than the channel's
	 * device means a member is replaying someone else's envelope as theirs.
	 */
	async openMessage(envelope: Envelope, channelDevice?: string): Promise<Record<string, unknown>> {
		if (channelDevice !== undefined && envelope.s !== channelDevice) {
			throw new Error(`envelope signer ${envelope.s} is not the channel device`);
		}
		let senderPublicKey: CryptoKey | undefined;
		// Signed classes (msg, hs) require the sender's TOFU key. A duplicate
		// hello arrives here as an 'hs' envelope after the peer is verified.
		if (envelope.t === 'msg' || envelope.t === 'hs') {
			const peer = this.peers.get(envelope.s);
			if (!peer) throw new Error(`unverified sender: ${envelope.s}`);
			senderPublicKey = peer.publicKey;
		}

		// Candidate keys: static k_hs, the granted chain's message key (§1.5),
		// or trial-decrypt across the retained generation instances (§1.4).
		let candidates: CryptoKey[];
		let chainStep: { commit(): void } | null = null;
		if (envelope.k !== undefined || envelope.i !== undefined) {
			if (envelope.t !== 'msg' || typeof envelope.k !== 'string') {
				throw new Error('malformed chain position');
			}
			// Signature first: deriving up to MAX_SKIP chain steps is work a
			// forger must not be able to make us do.
			if (
				!senderPublicKey ||
				!(await envelopeSignatureValid(envelope, this.roomId, senderPublicKey))
			) {
				throw new Error('invalid signature');
			}
			const prepared = await this.receivedChains.prepare(
				envelope.s,
				envelope.g,
				envelope.k,
				Number(envelope.i)
			);
			if (!prepared) throw new ChainMissingError(envelope.s, envelope.g, envelope.k);
			chainStep = prepared;
			candidates = [prepared.key];
		} else if (envelope.t === 'hs') {
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
		// The chain moves past this message only once it has fully verified.
		chainStep?.commit();
		this.schedulePersist();

		return body;
	}

	// ============ generation ratchet (§1.4) ============

	/** Persist + announce a generation change. */
	private async ratchetChanged(): Promise<void> {
		// Chains of generations no longer held are forgotten with them.
		this.receivedChains.prune((g) => this.ratchet.keysFor(g).length > 0);
		await saveRatchetState(this.roomId, this.ratchet.state());
		this.generationCb?.(this.ratchet.g, this.ratchet.gid);
	}

	/** Mint the next generation; grants flow per recipient (grantWireFor). */
	async mintGeneration(): Promise<void> {
		await this.ratchet.mintNext(this.identity);
		await this.ratchetChanged();
	}

	/**
	 * Wrap the current generation secret for one verified recipient
	 * (§1.4 v4): X-Wing encapsulate against the hello-pinned KEM key, the
	 * wrap AAD-bound to room, generation, and recipient. Fails closed for
	 * unknown recipients — a grant can only ever address a verified peer.
	 */
	private async wrapCurrentGrantFor(recipientDeviceId: string): Promise<WrappedGrant> {
		const grant = this.ratchet.currentGrant()!;
		const peer = this.peers.get(recipientDeviceId);
		if (!peer) throw new Error(`no pinned KEM key for ${recipientDeviceId}`);
		const recipientKem = fromB64url(peer.kem);
		const rk = fromB64url(grant.rk);
		if (!recipientKem || !rk) throw new Error('malformed grant wrap inputs');
		const wrap = await wrapSecret(recipientKem, rk, {
			roomId: this.roomId,
			g: grant.g,
			gid: grant.gid,
			recipientDeviceId
		});
		return {
			...certOf(grant),
			wrap: { ct: toB64url(wrap.ct), n: toB64url(wrap.n), wrapped: toB64url(wrap.wrapped) }
		};
	}

	/**
	 * A grant wire for a verified peer at `peerG`, with the chain it needs
	 * to verify the gap. When the peer's stated gid is off our line (a
	 * losing sibling / fork), the chain starts one generation earlier so it
	 * carries our cert AT the fork — the receiver's heal rule anchors at
	 * the shared parent (§1.4 "tailor the chain"). Mints first when this
	 * session cannot grant (§1.4 liveness).
	 */
	async grantWireFor(peerDeviceId: string, peerG: number, peerGid?: string): Promise<string> {
		if (!this.ratchet.canGrant()) {
			await this.ratchet.mintNext(this.identity);
			await this.ratchetChanged();
		}
		const grant = await this.wrapCurrentGrantFor(peerDeviceId);
		let fromG = Math.max(0, peerG);
		if (peerGid !== undefined && fromG >= 1 && !this.ratchet.onLine(fromG, peerGid)) {
			fromG -= 1;
		}
		// The tip cert already rides as `grant`; serving it again in the
		// chain would waste one of the MAX_CHAIN slots and push the fork
		// cert out at exactly the spec's boundary depth (P2.0 review F3).
		const chain =
			grant.g - fromG > MAX_CHAIN
				? // Deep gap (§1.4 segmented catch-up): serve the FIRST MAX_CHAIN
					// ancestors above the requester's frontier so it extends its
					// verified run upward one bounded segment per round.
					this.ratchet.chainAbove(fromG, MAX_CHAIN).filter((c) => c.g < grant.g)
				: // Within the chain bound: the tail run that links the tip to the
					// requester's line in a single admissible round (unchanged).
					this.ratchet
						.chainTail(fromG)
						.filter((c) => c.g < grant.g)
						.slice(-MAX_CHAIN);
		const body: RekeyGrantBody = { type: 'rekey-grant', grant, chain };
		return this.sealHs(body as unknown as Record<string, unknown>);
	}

	/**
	 * Run a received grant through §1.4 convergence: unwrap the recipient
	 * wrap first (fail-closed — a wrap addressed to another device, or
	 * with any swapped context, yields nothing), then adopt on the engine,
	 * whose gid == H(rk) check ties the unwrapped secret to the signed cert.
	 */
	/**
	 * mayMint (§3.8): whether the grant's minter is a member. Members only
	 * adopt member-minted tips, so no line minted by a device that was never
	 * let in can enter anyone's history, even when a member forwards it.
	 */
	async handleRekeyGrant(
		body: RekeyGrantBody,
		mayMint: (deviceId: string) => boolean = () => true
	): Promise<AdoptOutcome> {
		const { wrap, ...cert } = body.grant;
		// §1.4 order: the cert is verified before the (more expensive) KEM
		// decapsulation runs; adopt() re-verifies as part of convergence.
		if (!(await verifyCert(cert, this.roomId))) throw new Error('invalid grant certificate');
		if (!mayMint(cert.minter)) throw new Error('grant minted by a non-member');
		const ct = wrap && fromB64url(wrap.ct);
		const n = wrap && fromB64url(wrap.n);
		const wrapped = wrap && fromB64url(wrap.wrapped);
		if (!ct || !n || !wrapped) throw new Error('malformed grant wrap');
		const rk = await unwrapSecret(
			this.kem.seed,
			{ ct, n, wrapped },
			{ roomId: this.roomId, g: cert.g, gid: cert.gid, recipientDeviceId: this.deviceId }
		);
		if (!rk) throw new Error('grant unwrap failed (not wrapped for this device?)');
		const grant: RekeyGrant = { ...cert, rk: toB64url(rk) };
		const chain = body.chain ?? [];
		const outcome = await this.ratchet.adopt(grant, chain);
		// A tip more than MAX_CHAIN above our current generation cannot be
		// reached by one admissible run; fall to the segmented path, which
		// accumulates a verified run across rounds (§1.4). adopt() left our
		// state untouched on 'behind', so this is purely additive.
		if (outcome === 'behind' && cert.g - this.ratchet.g > MAX_CHAIN) {
			const seg = await this.ratchet.adoptSegment(grant, chain);
			if (seg === 'adopted') await this.ratchetChanged();
			return seg;
		}
		if (outcome === 'adopted' || outcome === 'sibling-retained') await this.ratchetChanged();
		return outcome;
	}

	/** The position a segmented requester reports / drives catch-up from (§1.4). */
	catchUpFrontier(): { g: number; gid: string } {
		return this.ratchet.aheadFrontier();
	}

	/** The direct-only ask for a generation we saw but cannot read (§1.4). */
	async makeRekeyRequestWire(g: number, gid?: string): Promise<string> {
		// Report our accumulation frontier, not just curG: mid-catch-up it has
		// advanced past curG, so the responder serves the NEXT segment (§1.4).
		const frontier = this.ratchet.aheadFrontier();
		const body: RekeyRequestBody = {
			type: 'rekey-request',
			g,
			gid,
			haveG: frontier.g,
			haveGid: frontier.gid
		};
		return this.sealHs(body as unknown as Record<string, unknown>);
	}

	/** Answer a rekey-request: grant, minting if necessary (liveness). */
	async handleRekeyRequest(body: RekeyRequestBody, requesterDeviceId: string): Promise<string> {
		const haveG = Number.isInteger(body.haveG) && body.haveG >= 0 ? body.haveG : 0;
		const haveGid = typeof body.haveGid === 'string' ? body.haveGid : undefined;
		return this.grantWireFor(requesterDeviceId, haveG, haveGid);
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
