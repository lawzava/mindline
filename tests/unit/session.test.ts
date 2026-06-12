import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, test } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { CryptoSession } from '$lib/p2p/crypto-session';
import { createRoomKey } from '$lib/crypto/keys';

// §3.4 binding shape: a label plus lp() fields; tests use one field.
const bind = (s: string) => ({ label: 'hello-v4' as const, fields: [s] });

beforeEach(() => {
	indexedDB = new IDBFactory();
});

async function twoSessions(roomId = 'room-1') {
	const key = createRoomKey();
	const a = await CryptoSession.create(roomId, key);
	const b = await CryptoSession.create(roomId, key);
	return { a, b };
}

describe('CryptoSession', () => {
	test('hello exchange verifies and registers the peer', async () => {
		const { a, b } = await twoSessions();
		const binding = bind('AA:BB');
		const hello = await a.makeHello('Alice', binding);
		const result = await b.acceptHello(hello, binding);
		expect(result).not.toBeNull();
		expect(result!.deviceId).toBe(a.deviceId);
		expect(result!.name).toBe('Alice');
		expect(b.isVerified(a.deviceId)).toBe(true);
	});

	test('hello replayed onto a different channel binding is rejected', async () => {
		const { a, b } = await twoSessions();
		const hello = await a.makeHello('Alice', bind('binding-one'));
		expect(await b.acceptHello(hello, bind('binding-two'))).toBeNull();
		expect(b.isVerified(a.deviceId)).toBe(false);
	});

	test('hello from a different room key is rejected', async () => {
		const a = await CryptoSession.create('room-1', createRoomKey());
		const b = await CryptoSession.create('room-1', createRoomKey());
		const hello = await a.makeHello('Alice', bind('bind'));
		expect(await b.acceptHello(hello, bind('bind'))).toBeNull();
	});

	test('messages round-trip between verified peers', async () => {
		const { a, b } = await twoSessions();
		await b.acceptHello(await a.makeHello('Alice', bind('bind')), bind('bind'));
		const wire = await a.sealMessage({ type: 'chat', content: 'hi', messageId: 'm1' });
		const body = await b.openMessage(JSON.parse(wire));
		expect(body).toMatchObject({ type: 'chat', content: 'hi', messageId: 'm1' });
	});

	test('messages from unverified senders are rejected', async () => {
		const { a, b } = await twoSessions();
		const wire = await a.sealMessage({ type: 'chat', content: 'hi', messageId: 'm1' });
		await expect(b.openMessage(JSON.parse(wire))).rejects.toThrow(/unverified/i);
	});

	test('replayed message envelopes are rejected', async () => {
		const { a, b } = await twoSessions();
		await b.acceptHello(await a.makeHello('Alice', bind('bind')), bind('bind'));
		const wire = await a.sealMessage({ type: 'chat', content: 'hi', messageId: 'm1' });
		await b.openMessage(JSON.parse(wire));
		await expect(b.openMessage(JSON.parse(wire))).rejects.toThrow(/replay/i);
	});

	test('drafts seal under eph class and round-trip without verification', async () => {
		const { a, b } = await twoSessions();
		// drafts arrive before hello sometimes; they carry no authority
		const wire = await a.sealDraft({ type: 'typing', content: 'par' });
		const body = await b.openMessage(JSON.parse(wire));
		expect(body).toMatchObject({ type: 'typing', content: 'par' });
	});

	test('signaling auth tags verify per sender and clientId', async () => {
		const { a, b } = await twoSessions();
		const tag = await a.signalingAuth('client-123');
		expect(await b.verifySignalingAuth(a.deviceId, 'client-123', tag)).toBe(true);
		expect(await b.verifySignalingAuth(a.deviceId, 'client-999', tag)).toBe(false);
		expect(await b.verifySignalingAuth('other-device', 'client-123', tag)).toBe(false);
	});

	test('session persists keys; a second create for the same room reuses them', async () => {
		const key = createRoomKey();
		const s1 = await CryptoSession.create('room-1', key);
		// no fragment this time: loads from keystore
		const s2 = await CryptoSession.create('room-1', null);
		expect(s2).not.toBeNull();
		// same room keys: s2 can decrypt s1's envelopes once verified
		await s2!.acceptHello(await s1.makeHello('A', bind('bind')), bind('bind'));
		const wire = await s1.sealMessage({ type: 'chat', content: 'x', messageId: 'm1' });
		const body = await s2!.openMessage(JSON.parse(wire));
		expect(body).toMatchObject({ content: 'x' });
	});

	test('create returns null when no fragment and no stored keys (knocking)', async () => {
		expect(await CryptoSession.create('unknown-room', null)).toBeNull();
	});
});

describe('session generations (PROTOCOL.md §1.4 — ratchet wiring)', () => {
	async function verifiedPair(roomId = 'room-gen') {
		const key = createRoomKey();
		const a = (await CryptoSession.create(roomId, key))!;
		const b = (await CryptoSession.create(roomId, key))!;
		await b.acceptHello(await a.makeHello('A', bind('bind')), bind('bind'));
		await a.acceptHello(await b.makeHello('B', bind('bind')), bind('bind'));
		return { a, b };
	}

	test('chat seals at the current generation; a wire grant converges peers', async () => {
		const { a, b } = await verifiedPair();
		expect(a.generation).toEqual({ g: 0, gid: '' });
		await a.mintGeneration();
		const grantWire = await a.grantWireFor(b.deviceId, 0);
		expect(JSON.parse(grantWire).t).toBe('hs');
		const body = await b.openMessage(JSON.parse(grantWire));
		expect(await b.handleRekeyGrant(body as never)).toBe('adopted');
		expect(b.generation).toEqual(a.generation);
		expect(a.generation.g).toBe(1);
		const wire = await a.sealMessage({ type: 'chat', content: 'post-ratchet' });
		expect(JSON.parse(wire).g).toBe(1);
		expect(await b.openMessage(JSON.parse(wire))).toMatchObject({ content: 'post-ratchet' });
	});

	test('a member that missed the ratchet reads retained-generation traffic only', async () => {
		const { a, b } = await verifiedPair();
		await a.mintGeneration(); // a at g1, b still at g0
		// a still reads b's g0 traffic (retention + trial decrypt)…
		const oldWire = await b.sealMessage({ type: 'chat', content: 'old-gen' });
		expect(JSON.parse(oldWire).g).toBe(0);
		expect(await a.openMessage(JSON.parse(oldWire))).toMatchObject({ content: 'old-gen' });
		// …but b cannot read g1 until granted.
		const newWire = await a.sealMessage({ type: 'chat', content: 'new-gen' });
		await expect(b.openMessage(JSON.parse(newWire))).rejects.toThrow(/generation/i);
	});

	test('hello advertises the sender generation', async () => {
		const key = createRoomKey();
		const a = (await CryptoSession.create('room-adv', key))!;
		const b = (await CryptoSession.create('room-adv', key))!;
		await a.mintGeneration();
		const info = await b.acceptHello(await a.makeHello('A', bind('bind')), bind('bind'));
		expect(info!.g).toBe(1);
		expect(info!.gid).toBe(a.generation.gid);
	});

	test('handshake bodies are rejected under the msg class (§2 both-directions rule)', async () => {
		const { a, b } = await verifiedPair();
		const wire = await a.sealMessage({ type: 'rekey-request', g: 1, haveG: 0, haveGid: '' });
		await expect(b.openMessage(JSON.parse(wire))).rejects.toThrow(/class/i);
	});

	test('a rekey-request is answered with a chained grant the requester converges on', async () => {
		const { a, b } = await verifiedPair();
		// b establishes itself at g1, then misses two ratchets.
		await a.mintGeneration();
		const g1Body = await b.openMessage(JSON.parse(await a.grantWireFor(b.deviceId, 0)));
		expect(await b.handleRekeyGrant(g1Body as never)).toBe('adopted');
		await a.mintGeneration();
		await a.mintGeneration(); // a at g3, b at g1
		const wire = await a.grantWireFor(b.deviceId, b.generation.g);
		const body = await b.openMessage(JSON.parse(wire));
		expect(await b.handleRekeyGrant(body as never)).toBe('adopted');
		expect(b.generation).toEqual(a.generation);
		expect(b.generation.g).toBe(3);
	});

	test('grantWireFor mints first when the session cannot grant (reload liveness)', async () => {
		const key = createRoomKey();
		const s1 = (await CryptoSession.create('room-reload', key))!;
		await s1.mintGeneration(); // g1, persisted
		const s2 = (await CryptoSession.create('room-reload', null))!;
		expect(s2.generation.g).toBe(1); // ratchet state survived reload
		// the wrap needs a pinned recipient KEM key (§1.4 v4)
		await s2.acceptHello(await s1.makeHello('A', bind('bind')), bind('bind'));
		await s2.grantWireFor(s1.deviceId, 0); // raw rk gone: must mint g2 to serve this
		expect(s2.generation.g).toBe(2);
	});

	test('a losing sibling heals through a tailored rekey-request chain (§1.4)', async () => {
		const { a, b } = await verifiedPair('room-fork');
		// Shared g1, then a concurrent mint on each side: same-g siblings.
		await a.mintGeneration();
		const g1Body = await b.openMessage(JSON.parse(await a.grantWireFor(b.deviceId, 0)));
		await b.handleRekeyGrant(g1Body as never);
		await a.mintGeneration(); // a's sibling at g2
		await b.mintGeneration(); // b's sibling at g2
		const [winner, loser] = a.generation.gid < b.generation.gid ? [a, b] : [b, a];
		await winner.mintGeneration(); // the winning line extends past the fork
		// The loser asks, stating its position INCLUDING its gid; the
		// responder must serve the chain from the fork so the heal anchors.
		const wire = await winner.handleRekeyRequest(
			{
				type: 'rekey-request',
				g: winner.generation.g,
				haveG: loser.generation.g,
				haveGid: loser.generation.gid
			},
			loser.deviceId
		);
		const body = await loser.openMessage(JSON.parse(wire));
		expect(await loser.handleRekeyGrant(body as never)).toBe('adopted');
		expect(loser.generation).toEqual(winner.generation);
	});

	test('refreshFromStore picks up a sibling tab adoption (multi-tab)', async () => {
		const key = createRoomKey();
		const t1 = (await CryptoSession.create('room-tabs', key))!;
		const t2 = (await CryptoSession.create('room-tabs', key))!;
		await t1.mintGeneration();
		expect(t2.generation.g).toBe(0);
		expect(await t2.refreshFromStore()).toBe(true);
		expect(t2.generation.g).toBe(1);
		expect(t2.generation.gid).toBe(t1.generation.gid);
	});
});

describe('per-device KEM grant wrapping (PROTOCOL.md §1.4 v4)', () => {
	/** A session on its own device: fresh IDB → fresh ECDSA + KEM identity. */
	async function isolatedDevice(roomId: string, key: Uint8Array) {
		indexedDB = new IDBFactory();
		return (await CryptoSession.create(roomId, key))!;
	}

	test('a grant wrapped for one device cannot be adopted by another', async () => {
		const key = createRoomKey();
		const a = await isolatedDevice('room-kem', key);
		const b = await isolatedDevice('room-kem', key);
		const c = await isolatedDevice('room-kem', key);
		expect(await a.acceptHello(await b.makeHello('B', bind('bind')), bind('bind'))).not.toBeNull();
		expect(await a.acceptHello(await c.makeHello('C', bind('bind')), bind('bind'))).not.toBeNull();
		await b.acceptHello(await a.makeHello('A', bind('bind')), bind('bind'));
		await c.acceptHello(await a.makeHello('A', bind('bind')), bind('bind'));
		await a.mintGeneration();
		const wireForB = await a.grantWireFor(b.deviceId, 0);
		// misdelivered: c cannot decapsulate a wrap addressed to b
		const atC = await c.openMessage(JSON.parse(wireForB));
		await expect(c.handleRekeyGrant(atC as never)).rejects.toThrow(/unwrap/i);
		expect(c.generation.g).toBe(0);
		// the intended recipient adopts
		const atB = await b.openMessage(JSON.parse(wireForB));
		expect(await b.handleRekeyGrant(atB as never)).toBe('adopted');
		expect(b.generation).toEqual(a.generation);
	});

	test('the wire grant carries a wrap, never the raw generation secret', async () => {
		const key = createRoomKey();
		const a = await isolatedDevice('room-kem-wire', key);
		const b = await isolatedDevice('room-kem-wire', key);
		await a.acceptHello(await b.makeHello('B', bind('bind')), bind('bind'));
		await b.acceptHello(await a.makeHello('A', bind('bind')), bind('bind'));
		await a.mintGeneration();
		const body = (await b.openMessage(
			JSON.parse(await a.grantWireFor(b.deviceId, 0))
		)) as Record<string, Record<string, unknown>>;
		expect(body.grant.rk).toBeUndefined();
		const wrap = body.grant.wrap as Record<string, string>;
		expect(typeof wrap.ct).toBe('string');
		expect(typeof wrap.n).toBe('string');
		expect(typeof wrap.wrapped).toBe('string');
	});

	test('a grant with a tampered certificate is rejected before unwrapping (§1.4 order)', async () => {
		const key = createRoomKey();
		const a = await isolatedDevice('room-kem-cert', key);
		const b = await isolatedDevice('room-kem-cert', key);
		await a.acceptHello(await b.makeHello('B', bind('bind')), bind('bind'));
		await b.acceptHello(await a.makeHello('A', bind('bind')), bind('bind'));
		await a.mintGeneration();
		const body = (await b.openMessage(
			JSON.parse(await a.grantWireFor(b.deviceId, 0))
		)) as Record<string, Record<string, string>>;
		body.grant.cert = body.grant.cert.slice(0, -4) + (body.grant.cert.endsWith('AAAA') ? 'BBBB' : 'AAAA');
		await expect(b.handleRekeyGrant(body as never)).rejects.toThrow(/cert/i);
		expect(b.generation.g).toBe(0);
	});

	test('granting to a peer with no pinned KEM key fails closed', async () => {
		const key = createRoomKey();
		const a = await isolatedDevice('room-kem-unknown', key);
		await a.mintGeneration();
		await expect(a.grantWireFor('unknown-device', 0)).rejects.toThrow();
	});

	test('TOFU pins the KEM key: a known device presenting a new one is rejected', async () => {
		const key = createRoomKey();
		indexedDB = new IDBFactory();
		const deviceDb = indexedDB; // b's device profile
		const b1 = (await CryptoSession.create('room-pin', key))!;
		const a = await isolatedDevice('room-pin', key);
		expect(await a.acceptHello(await b1.makeHello('B', bind('bind')), bind('bind'))).not.toBeNull();
		// Same ECDSA identity, fresh KEM identity: wipe only the KEM record
		// from b's profile so the next session regenerates it.
		indexedDB = deviceDb;
		await new Promise<void>((resolve, reject) => {
			const open = indexedDB.open('mindline-keys');
			open.onsuccess = () => {
				const tx = open.result.transaction('device', 'readwrite');
				tx.objectStore('device').delete('kem-identity');
				tx.oncomplete = () => {
					open.result.close();
					resolve();
				};
				tx.onerror = () => reject(tx.error);
			};
			open.onerror = () => reject(open.error);
		});
		const b2 = (await CryptoSession.create('room-pin', key))!;
		expect(b2.deviceId).toBe(b1.deviceId);
		expect(await a.acceptHello(await b2.makeHello('B', bind('bind')), bind('bind'))).toBeNull();
	});
});

describe('session epoch (PROTOCOL.md §2 — monotonic device high-water)', () => {
	test('stamps a clock-seeded epoch on first use (post-burn safety)', async () => {
		// A burned device restarting at epoch 1 would be censored forever by
		// peers holding a higher persisted high-water; the high-water seeds
		// from the clock on first allocation instead.
		const before = Date.now();
		const { a, b } = await twoSessions();
		await b.acceptHello(await a.makeHello('A', bind('bind')), bind('bind'));
		const body = await b.openMessage(
			JSON.parse(await a.sealMessage({ type: 'chat', content: 'x' }))
		);
		expect(Number(body.epoch)).toBeGreaterThanOrEqual(before);
	});

	test('epoch advances across sessions of the same device (never regresses)', async () => {
		// All CryptoSessions here share one device identity (one keystore),
		// so the monotonic high-water must hand out strictly increasing
		// epochs to successive sessions.
		const key = createRoomKey();
		const verifier = await CryptoSession.create('room-epoch', key);
		const s1 = await CryptoSession.create('room-epoch', key);
		await verifier!.acceptHello(await s1!.makeHello('A', bind('bind')), bind('bind'));
		const e1 = Number(
			(await verifier!.openMessage(JSON.parse(await s1!.sealMessage({ type: 'chat', content: '1' }))))
				.epoch
		);

		const s2 = await CryptoSession.create('room-epoch', key);
		await verifier!.acceptHello(await s2!.makeHello('A', bind('bind2')), bind('bind2'));
		const e2 = Number(
			(await verifier!.openMessage(JSON.parse(await s2!.sealMessage({ type: 'chat', content: '2' }))))
				.epoch
		);

		expect(e2).toBeGreaterThan(e1);
	});
});
