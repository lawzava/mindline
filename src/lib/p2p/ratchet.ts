/**
 * Generation ratchet engine (PROTOCOL.md §1.4) — store-free so it is unit
 * testable in plain node (no `$app/*`, no IndexedDB, no stores).
 *
 * This file owns the cryptographic and convergence logic of the key
 * generations: minting fresh generation secrets, the minter-signed grant
 * certificate that makes the `minter` field unforgeable and chains
 * generations via `prevGid`, verifying grants, and (in later parts) the
 * `(g, gid)` convergence and retention. The wire/transport and persistence
 * live in the connection/manager layers.
 */

import { fromB64url, toB64url } from '$lib/crypto/b64';
import { deviceIdFromSpki, importPeerPublicKey, type DeviceIdentity } from '$lib/crypto/identity';
import { deriveGenerationKeys, generationId, type GenerationKeys } from '$lib/crypto/keys';
import { lp } from '$lib/crypto/lp';

/** Upper bound on a generation number (PROTOCOL.md §1.4 — bounded integer). */
export const MAX_GENERATION = 2 ** 32;

/**
 * The rk-free part of a grant: everything the minter signed. Chains of
 * these (no secrets) are what members retain and serve so a behind member
 * can verify lineage across a gap (§1.4) — the rk rides only on the tip.
 */
export interface GrantCert {
	g: number;
	minter: string; // deviceId of the original minter
	minterSpki: string; // base64url SPKI of the minter
	gid: string; // generationId(rk)
	prevGid: string; // gid of the generation this one succeeds ('' for g=1)
	cert: string; // base64url ECDSA over the bound payload
}

/** A wire `rekey-grant` body (`hs` class): a cert plus the secret itself. */
export interface RekeyGrant extends GrantCert {
	rk: string; // base64url(rk_g)
}

/** `hs`-class wire body distributing a generation (§1.4). Direct-only. */
export interface RekeyGrantBody {
	type: 'rekey-grant';
	grant: RekeyGrant;
	/** rk-free ancestor certs for behind receivers (≤ MAX_CHAIN). */
	chain?: GrantCert[];
}

/** `hs`-class wire body asking for a generation (§1.4). Direct-only. */
export interface RekeyRequestBody {
	type: 'rekey-request';
	/** The generation the sender could not read / saw advertised. */
	g: number;
	gid?: string;
	/** The sender's own position, so the responder can tailor the chain. */
	haveG: number;
	haveGid: string;
}

/** A grant whose certificate, minter binding, and gid commitment all hold. */
export interface VerifiedGrant {
	g: number;
	gid: string;
	prevGid: string;
	minter: string;
	rk: Uint8Array;
}

/** Bytes the minter signs: binds room, generation, minter, gid, and chain. */
function grantPayload(roomId: string, g: number, minter: string, gid: string, prevGid: string) {
	return lp('rekey-grant', roomId, String(g), minter, gid, prevGid);
}

/**
 * Build a minter-signed grant for a generation this device holds the raw
 * secret for. `prevGid` chains to the predecessor generation (§1.4): only
 * a holder of `rk_{g-1}` knows `gid_{g-1}`, so the chain forecloses leaps.
 */
export async function buildGrant(opts: {
	identity: DeviceIdentity;
	roomId: string;
	g: number;
	rk: Uint8Array;
	prevGid: string;
}): Promise<RekeyGrant> {
	const { identity, roomId, g, rk, prevGid } = opts;
	const gid = await generationId(rk);
	const cert = await crypto.subtle.sign(
		{ name: 'ECDSA', hash: 'SHA-256' },
		identity.privateKey,
		grantPayload(roomId, g, identity.deviceId, gid, prevGid) as BufferSource
	);
	return {
		g,
		minter: identity.deviceId,
		minterSpki: toB64url(identity.spki),
		gid,
		prevGid,
		rk: toB64url(rk),
		cert: toB64url(new Uint8Array(cert))
	};
}

/**
 * Verify a bare certificate (§1.4): bounded integer g, the minter is the
 * hash of the presented SPKI (no forged low `minter`, F2), and the
 * signature covers the exact bound payload (which includes gid and
 * prevGid, so neither can be swapped under an honest signature).
 */
export async function verifyCert(cert: GrantCert, roomId: string): Promise<boolean> {
	try {
		if (!Number.isInteger(cert.g) || cert.g < 1 || cert.g >= MAX_GENERATION) return false;
		if (typeof cert.gid !== 'string' || typeof cert.prevGid !== 'string') return false;
		const spki = fromB64url(cert.minterSpki);
		const sig = fromB64url(cert.cert);
		if (!spki || !sig) return false;
		if ((await deviceIdFromSpki(spki)) !== cert.minter) return false;
		const pub = await importPeerPublicKey(spki);
		return await crypto.subtle.verify(
			{ name: 'ECDSA', hash: 'SHA-256' },
			pub,
			sig as BufferSource,
			grantPayload(roomId, cert.g, cert.minter, cert.gid, cert.prevGid) as BufferSource
		);
	} catch {
		return false;
	}
}

/**
 * Verify a full grant (§1.4): the certificate must hold (above) and the
 * gid must commit to the carried rk (no rk substitution under an honest
 * member's identity). Returns null on any failure.
 */
export async function verifyGrant(grant: RekeyGrant, roomId: string): Promise<VerifiedGrant | null> {
	try {
		const rk = fromB64url(grant.rk);
		if (!rk || rk.length !== 32) return null;
		if ((await generationId(rk)) !== grant.gid) return null;
		if (!(await verifyCert(grant, roomId))) return null;
		return { g: grant.g, gid: grant.gid, prevGid: grant.prevGid, minter: grant.minter, rk };
	} catch {
		return null;
	}
}

/** Strip the secret off a grant, leaving the signed certificate. */
export function certOf(grant: RekeyGrant): GrantCert {
	const { g, minter, minterSpki, gid, prevGid, cert } = grant;
	return { g, minter, minterSpki, gid, prevGid, cert };
}

/** Same-`g` sibling convergence window (§1.4 review #3). */
export const SIBLING_WINDOW_MS = 30_000;
/** Max distinct generation instances witnessed per `g` (§1.4 review #3). */
export const MAX_SIBLINGS_PER_G = 3;
/** Max ancestor certs carried per grant; longer gaps iterate requests. */
export const MAX_CHAIN = 32;

export type AdoptOutcome = 'adopted' | 'sibling-retained' | 'behind' | 'stale' | 'rejected';

export interface RatchetOpts {
	now?: () => number;
	siblingWindowMs?: number;
	maxSiblings?: number;
	maxChain?: number;
}

/** A non-current generation kept decrypt-only for trial decrypt (§1.4). */
export interface RetainedGeneration {
	g: number;
	gid: string;
	keys: GenerationKeys;
	/** Signed cert when one exists (never for the link generation). */
	cert: GrantCert | null;
}

/**
 * What the keystore persists (§1.4): derived non-extractable CryptoKeys
 * and the public cert log — never a raw generation secret, so a reloaded
 * member reads and writes but cannot grant.
 */
export interface PersistedRatchet {
	g: number;
	gid: string;
	keys: GenerationKeys;
	retained: RetainedGeneration[];
	log: GrantCert[];
	bootstrapped: boolean;
}

/**
 * The generation state machine (§1.4): current generation, decrypt-only
 * retention, the rk-free cert log, and the convergence rules — chained
 * forward steps, windowed same-`g` siblings, newcomer bootstrap, and
 * window-free fork heal. Sans-IO: time is injected, transport and
 * persistence live in the connection/keystore layers.
 */
export class GenerationRatchet {
	readonly roomId: string;
	private readonly now: () => number;
	private readonly siblingWindowMs: number;
	private readonly maxSiblings: number;
	private readonly maxChain: number;

	private curG: number;
	private curGid: string;
	private curKeys: GenerationKeys;
	private curRk: Uint8Array | null = null;
	private curGrantMsg: RekeyGrant | null = null;
	private bootstrapped: boolean;

	private retained = new Map<string, RetainedGeneration>(); // `${g}|${gid}`
	private log = new Map<number, GrantCert>(); // our line, by g
	private firstSeen = new Map<number, number>(); // g → when it became current
	/** Mutation queue: adopt/mint decide on state across awaits, so they
	 *  serialize — concurrent grants must not race the sibling cap or the
	 *  convergence checks against stale state. */
	private op: Promise<unknown> = Promise.resolve();

	private constructor(roomId: string, state: PersistedRatchet, opts: RatchetOpts) {
		this.roomId = roomId;
		this.now = opts.now ?? (() => Date.now());
		this.siblingWindowMs = opts.siblingWindowMs ?? SIBLING_WINDOW_MS;
		this.maxSiblings = opts.maxSiblings ?? MAX_SIBLINGS_PER_G;
		this.maxChain = opts.maxChain ?? MAX_CHAIN;
		this.curG = state.g;
		this.curGid = state.gid;
		this.curKeys = state.keys;
		this.bootstrapped = state.bootstrapped;
		for (const r of state.retained) this.retained.set(`${r.g}|${r.gid}`, r);
		for (const c of state.log) this.log.set(c.g, c);
		this.firstSeen.set(this.curG, this.now());
	}

	/** A member that holds only the link: generation 0, chain anchor ''. */
	static atLinkGeneration(
		roomId: string,
		keys0: GenerationKeys,
		opts: RatchetOpts = {}
	): GenerationRatchet {
		return new GenerationRatchet(
			roomId,
			{ g: 0, gid: '', keys: keys0, retained: [], log: [], bootstrapped: false },
			opts
		);
	}

	static fromPersisted(
		roomId: string,
		state: PersistedRatchet,
		opts: RatchetOpts = {}
	): GenerationRatchet {
		return new GenerationRatchet(roomId, state, opts);
	}

	get g(): number {
		return this.curG;
	}

	get gid(): string {
		return this.curGid;
	}

	get currentKeys(): GenerationKeys {
		return this.curKeys;
	}

	/** True while the raw current rk is in memory (original mint or grant). */
	canGrant(): boolean {
		return this.curRk !== null && this.curGrantMsg !== null;
	}

	/** The current generation's grant, verbatim, for re-granting (gossip). */
	currentGrant(): RekeyGrant | null {
		return this.curGrantMsg;
	}

	/** True when (g, gid) is the current generation or a retained sibling. */
	hasInstance(g: number, gid: string): boolean {
		if (g === this.curG && gid === this.curGid) return true;
		return this.retained.has(`${g}|${gid}`);
	}

	/** True when (g, gid) sits on our established line (not a sibling). */
	onLine(g: number, gid: string): boolean {
		return this.lineGid(g) === gid;
	}

	/** All retained key sets at `g`, current first — the trial-decrypt set. */
	keysFor(g: number): GenerationKeys[] {
		const keys: GenerationKeys[] = [];
		if (g === this.curG) keys.push(this.curKeys);
		for (const r of this.retained.values()) if (r.g === g) keys.push(r.keys);
		return keys;
	}

	/** Our line's certs for g in (fromG, current], for catch-up serving. */
	chainTail(fromG: number): GrantCert[] {
		const out: GrantCert[] = [];
		for (let g = fromG + 1; g <= this.curG; g++) {
			const c = this.log.get(g);
			if (c) out.push(c);
		}
		return out;
	}

	state(): PersistedRatchet {
		return {
			g: this.curG,
			gid: this.curGid,
			keys: this.curKeys,
			retained: [...this.retained.values()].map((r) => ({ ...r })),
			log: [...this.log.keys()].sort((a, b) => a - b).map((g) => this.log.get(g)!),
			bootstrapped: this.bootstrapped
		};
	}

	/** Run a state mutation exclusively, in arrival order. */
	private locked<T>(fn: () => Promise<T>): Promise<T> {
		const next = this.op.then(fn, fn);
		this.op = next.catch(() => undefined);
		return next;
	}

	/** Mint a fresh generation off the current one (§1.4: always possible). */
	mintNext(identity: DeviceIdentity): Promise<RekeyGrant> {
		return this.locked(() => this.mintNextLocked(identity));
	}

	private async mintNextLocked(identity: DeviceIdentity): Promise<RekeyGrant> {
		const g = this.curG + 1;
		if (g >= MAX_GENERATION) throw new Error('generation space exhausted');
		const rk = crypto.getRandomValues(new Uint8Array(32));
		const grant = await buildGrant({ identity, roomId: this.roomId, g, rk, prevGid: this.curGid });
		this.advance(grant, await deriveGenerationKeys(rk), rk, []);
		return grant;
	}

	/**
	 * Consider a verified peer's grant (with optional rk-free ancestor
	 * chain) against the §1.4 convergence rules. The caller acts on the
	 * outcome: 'adopted' → persist + gossip; 'behind' → rekey-request;
	 * 'stale'/'sibling-retained'/'rejected' → nothing to propagate.
	 */
	adopt(grant: RekeyGrant, chain: GrantCert[] = []): Promise<AdoptOutcome> {
		return this.locked(() => this.adoptLocked(grant, chain));
	}

	private async adoptLocked(grant: RekeyGrant, chain: GrantCert[]): Promise<AdoptOutcome> {
		const verified = await verifyGrant(grant, this.roomId);
		if (!verified) return 'rejected';
		const tipCert = certOf(grant);

		// Assemble the consecutive, internally linked run ending at the tip.
		const byG = new Map<number, GrantCert>();
		for (const c of chain) {
			if (!c || !Number.isInteger(c.g) || c.g < 1 || c.g > grant.g) continue;
			const existing = byG.get(c.g);
			if (existing && existing.cert !== c.cert) return 'rejected'; // conflicting chain
			byG.set(c.g, c);
		}
		const tipDup = byG.get(grant.g);
		if (tipDup && tipDup.cert !== tipCert.cert) return 'rejected';
		byG.set(grant.g, tipCert);

		const run: GrantCert[] = [tipCert];
		for (let g = grant.g - 1; g >= 1; g--) {
			const c = byG.get(g);
			if (!c) break; // hole: the run starts above it
			if (run[0].prevGid !== c.gid) return 'rejected'; // broken line
			run.unshift(c);
		}
		if (run.length - 1 > this.maxChain) return 'rejected';

		// Every ancestor cert must verify (the tip already did, with its rk).
		const ancestors = run.slice(0, -1);
		const checks = await Promise.all(ancestors.map((c) => verifyCert(c, this.roomId)));
		if (checks.some((ok) => !ok)) return 'rejected';

		if (!this.bootstrapped) {
			// Newcomer bootstrap (§1.4): a member still at the link generation
			// adopts its first verified grant — a chain to the '' anchor proves
			// nothing a fabricated chain could not, so none is demanded. The
			// served certs seed our log so we can serve and compare later.
			this.advance(grant, await deriveGenerationKeys(verified.rk), verified.rk, ancestors);
			return 'adopted';
		}

		// Walk the shared prefix of their run along our own line.
		let i = 0;
		while (i < run.length && run[i].g <= this.curG && this.lineGid(run[i].g) === run[i].gid) i++;
		if (i === run.length) return 'stale'; // tip is on (or behind) our line

		const div = run[i];
		if (i === run.length - 1 && this.retained.has(`${div.g}|${div.gid}`)) {
			return 'stale'; // duplicate of a sibling we already hold
		}

		// Their divergence must hang off our established line — never off a
		// retained losing sibling (the line is final; a sibling-rooted branch
		// heals later through the fork rule once the winning line extends).
		if (i === 0 && div.prevGid !== this.lineGid(div.g - 1)) return 'behind';

		if (div.g > this.curG) {
			// Forward step: anchoring forces div.g === curG + 1, possibly with
			// further linked certs up to the tip (catch-up across a gap).
			this.advance(grant, await deriveGenerationKeys(verified.rk), verified.rk, run.slice(i, -1));
			return 'adopted';
		}

		if (grant.g === div.g) {
			// Lone same-g sibling: windowed and capped (§1.4 review #3).
			if (div.g !== this.curG) return 'rejected'; // stub of an old fork
			const since = this.firstSeen.get(this.curG) ?? this.now();
			if (this.now() - since > this.siblingWindowMs) return 'rejected';
			if (this.knownGidsAt(this.curG).size >= this.maxSiblings) return 'rejected';
			if (div.gid < this.curGid) {
				this.advance(grant, await deriveGenerationKeys(verified.rk), verified.rk, []);
				return 'adopted';
			}
			this.retained.set(`${div.g}|${div.gid}`, {
				g: div.g,
				gid: div.gid,
				keys: await deriveGenerationKeys(verified.rk),
				cert: div
			});
			return 'sibling-retained';
		}

		// Fork heal (§1.4): their line extends past the divergence point —
		// window-free lower-gid tie-break at the fork. Forks are availability
		// events, not confidentiality events (every line is member-minted),
		// so a deterministic symmetric rule is all that is needed.
		const oursAtFork = this.lineGid(div.g);
		if (oursAtFork === undefined || div.gid >= oursAtFork) return 'rejected';
		this.advance(grant, await deriveGenerationKeys(verified.rk), verified.rk, run.slice(i, -1));
		return 'adopted';
	}

	/** Our own line's gid at `g`, if we know it. */
	private lineGid(g: number): string | undefined {
		if (g === 0) return '';
		if (g === this.curG) return this.curGid;
		return this.log.get(g)?.gid;
	}

	/** Every gid we hold at `g`: our line plus retained siblings. */
	private knownGidsAt(g: number): Set<string> {
		const gids = new Set<string>();
		const line = this.lineGid(g);
		if (line !== undefined) gids.add(line);
		for (const r of this.retained.values()) if (r.g === g) gids.add(r.gid);
		return gids;
	}

	/**
	 * Move current to `grant`'s generation: retire the old current to the
	 * decrypt-only set, splice the new line's certs into the log, and sweep
	 * retention (§1.4: a generation's keys die when two further generations
	 * have superseded it).
	 */
	private advance(
		grant: RekeyGrant,
		keys: GenerationKeys,
		rk: Uint8Array | null,
		lineCerts: GrantCert[]
	): void {
		this.retained.set(`${this.curG}|${this.curGid}`, {
			g: this.curG,
			gid: this.curGid,
			keys: this.curKeys,
			cert: this.log.get(this.curG) ?? null
		});
		for (const c of lineCerts) this.log.set(c.g, c);
		this.log.set(grant.g, certOf(grant));
		for (const g of [...this.log.keys()]) if (g > grant.g) this.log.delete(g);

		this.curG = grant.g;
		this.curGid = grant.gid;
		this.curKeys = keys;
		this.curRk = rk;
		this.curGrantMsg = rk ? grant : null;
		this.bootstrapped = true;
		if (!this.firstSeen.has(grant.g)) this.firstSeen.set(grant.g, this.now());

		for (const [k, r] of this.retained) if (r.g < this.curG - 1) this.retained.delete(k);
		for (const g of [...this.firstSeen.keys()]) if (g < this.curG - 1) this.firstSeen.delete(g);
	}
}
