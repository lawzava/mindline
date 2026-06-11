import { describe, expect, it } from 'vitest';
import { createDeviceIdentity } from '$lib/crypto/identity';
import { createRoomKey, generationId } from '$lib/crypto/keys';
import { buildGrant, verifyGrant, type RekeyGrant } from '$lib/p2p/ratchet';

const ROOM = 'room-ratchet';

async function freshGrant(overrides: Partial<{ g: number; prevGid: string }> = {}) {
	const minter = await createDeviceIdentity();
	const rk = createRoomKey();
	const grant = await buildGrant({
		identity: minter,
		roomId: ROOM,
		g: overrides.g ?? 1,
		rk,
		prevGid: overrides.prevGid ?? 'gid-0'
	});
	return { minter, rk, grant };
}

describe('rekey-grant certificate (PROTOCOL.md §1.4)', () => {
	it('round-trips: a built grant verifies and yields its fields', async () => {
		const { minter, rk, grant } = await freshGrant({ g: 5, prevGid: 'prev-abc' });
		const v = await verifyGrant(grant, ROOM);
		expect(v).not.toBeNull();
		expect(v!.g).toBe(5);
		expect(v!.minter).toBe(minter.deviceId);
		expect(v!.prevGid).toBe('prev-abc');
		expect(v!.gid).toBe(await generationId(rk));
		expect(Buffer.from(v!.rk).equals(Buffer.from(rk))).toBe(true);
	});

	it('rejects a grant whose gid does not commit to rk', async () => {
		const { grant } = await freshGrant();
		const tampered: RekeyGrant = { ...grant, gid: 'not-the-real-gid' };
		expect(await verifyGrant(tampered, ROOM)).toBeNull();
	});

	it('rejects a forged minter id (F2 tie-break hijack)', async () => {
		const { grant } = await freshGrant();
		// Claim a lexicographically tiny minter to win same-g ties, keeping
		// the real spki/cert: deviceIdFromSpki(spki) no longer matches.
		const forged: RekeyGrant = { ...grant, minter: '0000000000000000' };
		expect(await verifyGrant(forged, ROOM)).toBeNull();
	});

	it('rejects rk substitution under an honest identity', async () => {
		const { grant } = await freshGrant();
		const otherRk = createRoomKey();
		// New rk + its honest gid, but the cert was signed over the old gid.
		const substituted: RekeyGrant = {
			...grant,
			rk: Buffer.from(otherRk).toString('base64url'),
			gid: await generationId(otherRk)
		};
		expect(await verifyGrant(substituted, ROOM)).toBeNull();
	});

	it('rejects a tampered certificate', async () => {
		const { grant } = await freshGrant();
		const cert = Buffer.from(grant.cert, 'base64url');
		cert[0] ^= 0xff;
		const tampered: RekeyGrant = { ...grant, cert: cert.toString('base64url') };
		expect(await verifyGrant(tampered, ROOM)).toBeNull();
	});

	it('rejects a grant verified against the wrong room', async () => {
		const { grant } = await freshGrant();
		expect(await verifyGrant(grant, 'other-room')).toBeNull();
	});

	it('rejects out-of-range or non-integer generations', async () => {
		const { minter, rk } = await freshGrant();
		for (const g of [0, -1, 1.5, 2 ** 32, Number.MAX_SAFE_INTEGER]) {
			const grant = await buildGrant({ identity: minter, roomId: ROOM, g, rk, prevGid: 'p' });
			expect(await verifyGrant(grant, ROOM)).toBeNull();
		}
	});

	it('rejects a prevGid mismatch (cert binds the chain link)', async () => {
		const { grant } = await freshGrant({ prevGid: 'real-prev' });
		const tampered: RekeyGrant = { ...grant, prevGid: 'different-prev' };
		expect(await verifyGrant(tampered, ROOM)).toBeNull();
	});
});
