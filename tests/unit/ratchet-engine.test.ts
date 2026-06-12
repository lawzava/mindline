import { beforeEach, describe, expect, it } from 'vitest';
import { createDeviceIdentity, type DeviceIdentity } from '$lib/crypto/identity';
import { createRoomKey, deriveGenerationKeys, type GenerationKeys } from '$lib/crypto/keys';
import { GenerationRatchet, type RatchetOpts } from '$lib/p2p/ratchet';

const ROOM = 'room-engine';
const LINK_RK = createRoomKey();

let clock = 1_000_000;
const now = () => clock;

function opts(extra: Partial<RatchetOpts> = {}): RatchetOpts {
	return { now, ...extra };
}

async function freshEngine(extra: Partial<RatchetOpts> = {}): Promise<GenerationRatchet> {
	return GenerationRatchet.atLinkGeneration(ROOM, await deriveGenerationKeys(LINK_RK), opts(extra));
}

/** True iff something sealed under `from.msg` opens under any of `to`. */
async function canDecrypt(from: GenerationKeys, to: GenerationKeys[]): Promise<boolean> {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const ct = await crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv },
		from.msg,
		new TextEncoder().encode('probe')
	);
	for (const k of to) {
		try {
			await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, k.msg, ct);
			return true;
		} catch {
			/* try next retained key */
		}
	}
	return false;
}

let alice: DeviceIdentity;
let bob: DeviceIdentity;

beforeEach(async () => {
	clock = 1_000_000;
	alice = await createDeviceIdentity();
	bob = await createDeviceIdentity();
});

describe('GenerationRatchet — link generation and minting (§1.4)', () => {
	it('starts at the link generation: g=0, empty-gid chain anchor, nothing to grant', async () => {
		const e = await freshEngine();
		expect(e.g).toBe(0);
		expect(e.gid).toBe('');
		expect(e.canGrant()).toBe(false);
		expect(e.currentGrant()).toBeNull();
		expect(e.keysFor(0)).toHaveLength(1);
	});

	it('mintNext advances to g+1 with fresh keys and a grantable certificate', async () => {
		const e = await freshEngine();
		const before = e.currentKeys;
		const grant = await e.mintNext(alice);
		expect(e.g).toBe(1);
		expect(grant.g).toBe(1);
		expect(grant.prevGid).toBe('');
		expect(grant.minter).toBe(alice.deviceId);
		expect(e.gid).toBe(grant.gid);
		expect(e.canGrant()).toBe(true);
		expect(e.currentGrant()).toEqual(grant);
		// New generation keys are not the link-generation keys…
		expect(await canDecrypt(e.currentKeys, [before])).toBe(false);
		// …and the link generation stays retained for trial decrypt.
		expect(await canDecrypt(before, e.keysFor(0))).toBe(true);
	});

	it('a peer adopts a +1 grant and both ends converge on (g, gid)', async () => {
		const a = await freshEngine();
		const b = await freshEngine();
		const grant = await a.mintNext(alice);
		expect(await b.adopt(grant)).toBe('adopted');
		expect(b.g).toBe(1);
		expect(b.gid).toBe(a.gid);
		expect(await canDecrypt(a.currentKeys, b.keysFor(1))).toBe(true);
		// The adopter holds rk from the grant and can re-grant verbatim.
		expect(b.canGrant()).toBe(true);
		expect(b.currentGrant()).toEqual(grant);
	});

	it('rejects a grant for another room', async () => {
		const a = await freshEngine();
		const other = GenerationRatchet.atLinkGeneration(
			'other-room',
			await deriveGenerationKeys(LINK_RK),
			opts()
		);
		const grant = await other.mintNext(alice);
		expect(await a.adopt(grant)).toBe('rejected');
		expect(a.g).toBe(0);
	});
});

describe('GenerationRatchet — chained convergence (§1.4 F1/F3)', () => {
	it('an established member does not adopt a far-ahead grant without a chain (F1)', async () => {
		const a = await freshEngine();
		const b = await freshEngine();
		await b.adopt(await a.mintNext(alice)); // b is established at g=1
		await a.mintNext(alice);
		const g3 = await a.mintNext(alice);
		expect(await b.adopt(g3)).toBe('behind');
		expect(b.g).toBe(1);
	});

	it('catches up across a gap with a verified ancestor chain', async () => {
		const a = await freshEngine();
		const b = await freshEngine();
		await b.adopt(await a.mintNext(alice)); // both at g=1
		await a.mintNext(alice);
		await a.mintNext(alice);
		const g4 = await a.mintNext(alice);
		const chain = a.chainTail(1); // certs for g=2..4, rk-free
		expect(chain.map((c) => c.g)).toEqual([2, 3, 4]);
		expect(await b.adopt(g4, chain)).toBe('adopted');
		expect(b.g).toBe(4);
		expect(b.gid).toBe(a.gid);
	});

	it('rejects a catch-up chain with a tampered certificate', async () => {
		const a = await freshEngine();
		const b = await freshEngine();
		await b.adopt(await a.mintNext(alice));
		await a.mintNext(alice);
		const g3 = await a.mintNext(alice);
		const chain = a.chainTail(1).map((c) => ({ ...c }));
		chain[0].gid = chain[0].gid.slice(1) + 'A'; // break the gid the cert signed
		expect(await b.adopt(g3, chain)).toBe('rejected');
		expect(b.g).toBe(1);
	});

	it('reports behind when the chain has a hole', async () => {
		const a = await freshEngine();
		const b = await freshEngine();
		await b.adopt(await a.mintNext(alice));
		await a.mintNext(alice);
		await a.mintNext(alice);
		const g4 = await a.mintNext(alice);
		const holey = a.chainTail(1).filter((c) => c.g !== 3);
		expect(await b.adopt(g4, holey)).toBe('behind');
		expect(b.g).toBe(1);
	});

	it('rejects a chain longer than the per-grant cap', async () => {
		const a = await freshEngine({ maxChain: 2 });
		const b = await freshEngine({ maxChain: 2 });
		await b.adopt(await a.mintNext(alice));
		for (let i = 0; i < 4; i++) await a.mintNext(alice);
		expect(await b.adopt(a.currentGrant()!, a.chainTail(1))).toBe('rejected');
		expect(b.g).toBe(1);
	});
});

describe('GenerationRatchet — same-g siblings (§1.4 review #3)', () => {
	/** Two members mint concurrently from the same parent generation. */
	async function siblings() {
		const a = await freshEngine();
		const b = await freshEngine();
		const d = await freshEngine();
		const g1 = await a.mintNext(alice);
		await b.adopt(g1);
		await d.adopt(g1);
		const ga = await a.mintNext(alice);
		const gb = await b.mintNext(bob);
		const [low, high] = ga.gid < gb.gid ? [ga, gb] : [gb, ga];
		return { d, low, high };
	}

	it('lower gid wins when the loser arrives second', async () => {
		const { d, low, high } = await siblings();
		expect(await d.adopt(low)).toBe('adopted');
		expect(await d.adopt(high)).toBe('sibling-retained');
		expect(d.gid).toBe(low.gid);
		// Both siblings stay decryptable at g=2 (in-flight traffic).
		expect(d.keysFor(2).length).toBe(2);
	});

	it('lower gid wins when it arrives second', async () => {
		const { d, low, high } = await siblings();
		expect(await d.adopt(high)).toBe('adopted');
		expect(await d.adopt(low)).toBe('adopted');
		expect(d.gid).toBe(low.gid);
		expect(d.keysFor(2).length).toBe(2);
	});

	it('rejects a lone sibling after the convergence window', async () => {
		const { d, low, high } = await siblings();
		await d.adopt(high);
		clock += 60_000; // past SIBLING_WINDOW
		expect(await d.adopt(low)).toBe('rejected');
		expect(d.gid).toBe(high.gid);
	});

	it('caps retained sibling instances per generation', async () => {
		const a = await freshEngine({ maxSiblings: 2 });
		const b = await freshEngine({ maxSiblings: 2 });
		const c = await freshEngine({ maxSiblings: 2 });
		const d = await freshEngine({ maxSiblings: 2 });
		const g1 = await a.mintNext(alice);
		for (const e of [b, c, d]) await e.adopt(g1);
		const carol = await createDeviceIdentity();
		const s1 = await a.mintNext(alice);
		const s2 = await b.mintNext(bob);
		const s3 = await c.mintNext(carol);
		await d.adopt(s1);
		await d.adopt(s2);
		// Two distinct instances witnessed at g=2 — the cap; the third is
		// rejected no matter how its gid ranks.
		expect(await d.adopt(s3)).toBe('rejected');
		expect(d.keysFor(2).length).toBe(2);
	});

	it('a +1 grant chaining from a losing sibling is not adopted (the line is final)', async () => {
		const { d, low, high } = await siblings();
		await d.adopt(low);
		await d.adopt(high); // retained sibling — decryptable, but not the line
		// The high-sibling minter ratchets again before learning it lost.
		const minterEngine = await freshEngine();
		await minterEngine.adopt(high);
		const g3 = await minterEngine.mintNext(bob);
		expect(g3.prevGid).toBe(high.gid);
		// Chainless it reads as a gap; with the chain the fork tie-break
		// rejects it — either way the established line stands, and the
		// stranded minter heals once the winning line extends past the fork.
		expect(await d.adopt(g3)).toBe('behind');
		expect(await d.adopt(g3, minterEngine.chainTail(1))).toBe('rejected');
		expect(d.g).toBe(2);
		expect(d.gid).toBe(low.gid);
	});
});

describe('GenerationRatchet — retention and the FS horizon (§1.4)', () => {
	it('destroys a generation once two further generations supersede it', async () => {
		const a = await freshEngine();
		const link = a.currentKeys;
		await a.mintNext(alice); // g=1: holds {1, 0}
		expect(a.keysFor(0).length).toBe(1);
		await a.mintNext(alice); // g=2: holds {2, 1}; link keys destroyed
		expect(a.keysFor(0)).toHaveLength(0);
		expect(await canDecrypt(link, a.keysFor(0))).toBe(false);
		expect(a.keysFor(1).length).toBe(1);
		await a.mintNext(alice); // g=3: holds {3, 2}
		expect(a.keysFor(1)).toHaveLength(0);
		expect(a.keysFor(2).length).toBe(1);
	});

	it('returns no keys for unknown or future generations', async () => {
		const a = await freshEngine();
		await a.mintNext(alice);
		expect(a.keysFor(5)).toHaveLength(0);
		expect(a.keysFor(a.g + 1)).toHaveLength(0);
	});

	it('treats older and duplicate grants as stale', async () => {
		const a = await freshEngine();
		const b = await freshEngine();
		const g1 = await a.mintNext(alice);
		await b.adopt(g1);
		const g2 = await a.mintNext(alice);
		await b.adopt(g2);
		expect(await b.adopt(g2)).toBe('stale'); // duplicate of current
		expect(await b.adopt(g1)).toBe('stale'); // older generation
		expect(b.g).toBe(2);
	});
});

describe('GenerationRatchet — newcomer bootstrap (§1.4)', () => {
	it('a link-generation member adopts its first verified grant at any g', async () => {
		const a = await freshEngine();
		for (let i = 0; i < 5; i++) await a.mintNext(alice);
		const newcomer = await freshEngine();
		expect(await newcomer.adopt(a.currentGrant()!, a.chainTail(0))).toBe('adopted');
		expect(newcomer.g).toBe(5);
		expect(newcomer.gid).toBe(a.gid);
		// The served chain becomes the newcomer's own log, so it can serve
		// catch-up chains in turn.
		expect(newcomer.chainTail(0).map((c) => c.g)).toEqual([1, 2, 3, 4, 5]);
	});

	it('applies normal chain rules once bootstrapped', async () => {
		const a = await freshEngine();
		const newcomer = await freshEngine();
		await newcomer.adopt(await a.mintNext(alice)); // bootstrap at g=1
		await a.mintNext(alice);
		const g3 = await a.mintNext(alice);
		expect(await newcomer.adopt(g3)).toBe('behind'); // no leap without chain
	});

	it('minting locally also ends bootstrap eligibility', async () => {
		const a = await freshEngine();
		const b = await freshEngine();
		await a.mintNext(alice); // a anchored itself at its own g=1
		for (let i = 0; i < 3; i++) await b.mintNext(bob);
		expect(await a.adopt(b.currentGrant()!)).toBe('behind');
	});
});

describe('GenerationRatchet — fork heal (§1.4 partitions)', () => {
	it('a line extending past the fork heals the losing side, window-free', async () => {
		const a = await freshEngine();
		const b = await freshEngine();
		const g1 = await a.mintNext(alice);
		await b.adopt(g1);
		// Partition: each side ratchets twice, independently.
		const a2 = await a.mintNext(alice);
		const b2 = await b.mintNext(bob);
		await a.mintNext(alice);
		await b.mintNext(bob);
		clock += 120_000; // far past the sibling window
		const [winner, loser] = a2.gid < b2.gid ? [a, b] : [b, a];
		const losingTip = loser.currentGrant()!;
		const losingChain = loser.chainTail(1);
		// The losing line receives the winning line's tip + chain and heals.
		expect(await loser.adopt(winner.currentGrant()!, winner.chainTail(1))).toBe('adopted');
		expect(loser.g).toBe(winner.g);
		expect(loser.gid).toBe(winner.gid);
		// The winning line rejects the losing line's tip — it won the fork.
		expect(await winner.adopt(losingTip, losingChain)).toBe('rejected');
	});

	it('a fork deeper than the chain cap does not heal in-protocol (re-entry via link)', async () => {
		// §1.4 depth bound: the heal needs the fork cert inside one
		// admissible run, and runs end at the tip — so once the winning
		// line's tip is more than maxChain past the fork, every exchange
		// stays 'behind'/'rejected' and the loser re-enters via the link
		// (bootstrap), which is the documented recovery.
		const a = await freshEngine({ maxChain: 2 });
		const b = await freshEngine({ maxChain: 2 });
		const g1 = await a.mintNext(alice);
		await b.adopt(g1);
		for (let i = 0; i < 4; i++) {
			await a.mintNext(alice); // fork at g=2, tips at g=5
			await b.mintNext(bob);
		}
		clock += 120_000;
		// Modeling the wire: the responder serves at most maxChain certs
		// ending at its tip (chainTail sliced), so the fork cert at g=2
		// can never ride an admissible run.
		const served = a.chainTail(1).slice(-2);
		const outcome = await b.adopt(a.currentGrant()!, served);
		expect(outcome).not.toBe('adopted');
		expect(b.g).toBe(5);
		// The documented recovery works: a fresh link-generation engine
		// (rejoin) bootstraps straight onto the winning line.
		const rejoined = await freshEngine({ maxChain: 2 });
		expect(await rejoined.adopt(a.currentGrant()!, served)).toBe('adopted');
		expect(rejoined.gid).toBe(a.gid);
	});

	it('serializes concurrent adopts so the sibling cap cannot be raced', async () => {
		const a = await freshEngine({ maxSiblings: 2 });
		const b = await freshEngine({ maxSiblings: 2 });
		const c = await freshEngine({ maxSiblings: 2 });
		const d = await freshEngine({ maxSiblings: 2 });
		const g1 = await a.mintNext(alice);
		for (const e of [b, c, d]) await e.adopt(g1);
		const carol = await createDeviceIdentity();
		await d.adopt(await a.mintNext(alice)); // d current at g2 (1 instance)
		const s2 = await b.mintNext(bob);
		const s3 = await c.mintNext(carol);
		// Two sibling grants arrive concurrently: without internal
		// serialization both pass the cap check against stale state.
		await Promise.all([d.adopt(s2), d.adopt(s3)]);
		expect(d.keysFor(2).length).toBeLessThanOrEqual(2);
	});

	it('a shorter winning line converges after its side extends past the fork', async () => {
		const a = await freshEngine();
		const b = await freshEngine();
		const g1 = await a.mintNext(alice);
		await b.adopt(g1);
		const a2 = await a.mintNext(alice); // a's line: one mint
		const b2 = await b.mintNext(bob); // b's line: two mints
		await b.mintNext(bob);
		clock += 120_000;
		if (a2.gid < b2.gid) {
			// b's longer line loses at the fork, but a's tip IS the fork — a
			// lone post-window sibling, rejected (review #3 flood bound)…
			expect(await b.adopt(a.currentGrant()!, a.chainTail(1))).toBe('rejected');
			// …until a's side extends past the fork; then b heals onto it.
			await a.mintNext(alice);
			expect(await b.adopt(a.currentGrant()!, a.chainTail(1))).toBe('adopted');
			expect(b.g).toBe(3);
			expect(b.gid).toBe(a.gid);
		} else {
			// b's longer line wins outright; a heals forward onto it.
			expect(await a.adopt(b.currentGrant()!, b.chainTail(1))).toBe('adopted');
			expect(a.gid).toBe(b.gid);
		}
	});
});

describe('GenerationRatchet — persistence and reload liveness (§1.4 F8)', () => {
	it('round-trips through persisted state without raw secrets', async () => {
		const a = await freshEngine();
		const b = await freshEngine();
		await b.adopt(await a.mintNext(alice));
		const g2 = await a.mintNext(alice);
		await b.adopt(g2);
		const revived = GenerationRatchet.fromPersisted(ROOM, b.state(), opts());
		expect(revived.g).toBe(2);
		expect(revived.gid).toBe(b.gid);
		// Keys survive; the raw rk does not — read/write yes, grant no.
		expect(await canDecrypt(a.currentKeys, revived.keysFor(2))).toBe(true);
		expect(revived.canGrant()).toBe(false);
		expect(revived.currentGrant()).toBeNull();
		// The cert log survives so it can still serve catch-up chains.
		expect(revived.chainTail(0).map((c) => c.g)).toEqual([1, 2]);
	});

	it('a reloaded member can still mint the next generation (liveness)', async () => {
		const a = await freshEngine();
		await a.mintNext(alice);
		const revived = GenerationRatchet.fromPersisted(ROOM, a.state(), opts());
		expect(revived.canGrant()).toBe(false);
		const grant = await revived.mintNext(alice);
		expect(grant.g).toBe(2);
		expect(revived.canGrant()).toBe(true);
		expect(grant.prevGid).toBe(a.gid);
	});
});
