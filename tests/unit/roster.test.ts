import { describe, expect, test } from 'vitest';
import { createDeviceIdentity, type DeviceIdentity } from '$lib/crypto/identity';
import {
	Roster,
	founderRoomId,
	isAnchoredRoom,
	signRosterOp,
	type RosterAction,
	type RosterOp
} from '$lib/p2p/roster';

async function people(n: number): Promise<DeviceIdentity[]> {
	return Promise.all(Array.from({ length: n }, () => createDeviceIdentity()));
}

/** Sign the next operation on `roster`'s chain as `who`. */
async function next(roster: Roster, who: DeviceIdentity, device: string, action: RosterAction) {
	return signRosterOp(who, roster.roomId, { ...roster.nextLink(), device, action });
}

async function foundRoom(founder: DeviceIdentity) {
	const { roomId, salt } = await founderRoomId(founder.spki);
	const roster = new Roster(roomId);
	const founding = await signRosterOp(founder, roomId, {
		seq: 0,
		prev: '',
		device: '*',
		action: 'approve',
		salt
	});
	expect(await roster.add([founding])).toBe(true);
	return { roomId, salt, roster };
}

describe('anchored rooms (PROTOCOL.md §3.8)', () => {
	test('a room id that commits to its founder is recognized; legacy ids are not', async () => {
		const [alice] = await people(1);
		const { roomId } = await founderRoomId(alice.spki);
		expect(isAnchoredRoom(roomId)).toBe(true);
		expect(isAnchoredRoom('3f0c2a51-7c7e-4f6b-9b4e-2c1a0e5f8d11')).toBe(false);
	});

	test('the founder is the host and a member; a stranger with the link is not', async () => {
		const [alice, bob] = await people(2);
		const { roster } = await foundRoom(alice);
		expect(roster.approving).toBe(true);
		expect(roster.host).toBe(alice.deviceId);
		expect(roster.isAdmitted(alice.deviceId)).toBe(true);
		expect(roster.isAdmitted(bob.deviceId)).toBe(false);
	});

	test('before the founding operation is known, nobody is a member', async () => {
		const [alice] = await people(1);
		const { roomId } = await founderRoomId(alice.spki);
		expect(new Roster(roomId).isAdmitted(alice.deviceId)).toBe(false);
	});

	test('only the host can change the roster; anyone else is refused at the door', async () => {
		const [alice, bob, mallory] = await people(3);
		const { roster } = await foundRoom(alice);
		expect(await roster.add([await next(roster, alice, bob.deviceId, 'admit')])).toBe(true);
		// Bob is a member but not the host; Mallory is nobody.
		expect(await roster.add([await next(roster, bob, mallory.deviceId, 'admit')])).toBe(false);
		expect(await roster.add([await next(roster, mallory, alice.deviceId, 'remove')])).toBe(false);
		expect(roster.isAdmitted(mallory.deviceId)).toBe(false);
		expect(roster.length).toBe(2);
	});

	test('a removed member cannot undo its removal: the chain has no room for backdating', async () => {
		const [alice, bob] = await people(2);
		const { roomId, roster } = await foundRoom(alice);
		const admitBob = await next(roster, alice, bob.deviceId, 'admit');
		await roster.add([admitBob]);
		await roster.add([await next(roster, alice, bob.deviceId, 'remove')]);
		// Bob signs an alternative second operation right after his admission.
		const forged = await signRosterOp(bob, roomId, {
			seq: 2,
			prev: roster.linkAfter(1),
			device: alice.deviceId,
			action: 'remove'
		});
		expect(await roster.add([forged])).toBe(false);
		expect(roster.isAdmitted(bob.deviceId)).toBe(false);
		expect(roster.isAdmitted(alice.deviceId)).toBe(true);
	});

	test('the host can hand the role to a member, who then decides', async () => {
		const [alice, bob, carol] = await people(3);
		const { roster } = await foundRoom(alice);
		await roster.add([await next(roster, alice, bob.deviceId, 'admit')]);
		await roster.add([await next(roster, alice, bob.deviceId, 'host')]);
		expect(roster.host).toBe(bob.deviceId);
		expect(await roster.add([await next(roster, alice, carol.deviceId, 'admit')])).toBe(false);
		expect(await roster.add([await next(roster, bob, carol.deviceId, 'admit')])).toBe(true);
		expect(roster.isAdmitted(carol.deviceId)).toBe(true);
	});

	test('an ex-host cannot rewrite history with a longer fork', async () => {
		const [alice, bob, mallory] = await people(3);
		const { roomId, roster } = await foundRoom(alice);
		await roster.add([await next(roster, alice, bob.deviceId, 'admit')]);
		const beforeHandoff = roster.ops();
		await roster.add([await next(roster, alice, bob.deviceId, 'host')]);

		// Alice builds her own continuation from before the handoff.
		const fork = new Roster(roomId);
		await fork.add(beforeHandoff);
		for (const device of [mallory.deviceId, 'x1', 'x2', 'x3']) {
			await fork.add([await next(fork, alice, device, 'admit')]);
		}
		expect(fork.length).toBeGreaterThan(roster.length);
		expect(await roster.add(fork.ops())).toBe(false);
		expect(roster.host).toBe(bob.deviceId);
		expect(roster.isAdmitted(mallory.deviceId)).toBe(false);
	});

	test('merging the same chain from several peers at once cannot corrupt it', async () => {
		const [alice, bob, carol] = await people(3);
		const { roomId, roster } = await foundRoom(alice);
		await roster.add([await next(roster, alice, bob.deviceId, 'admit')]);
		await roster.add([await next(roster, alice, carol.deviceId, 'admit')]);
		const joiner = new Roster(roomId);
		await Promise.all([
			joiner.add(roster.ops()),
			joiner.add(roster.ops()),
			joiner.add(roster.ops())
		]);
		expect(joiner.length).toBe(3);
		expect(joiner.isAdmitted(carol.deviceId)).toBe(true);
	});

	test('a device behind the fork point prefers the branch where the ex-host handed over', async () => {
		const [alice, bob, mallory] = await people(3);
		const { roomId, roster } = await foundRoom(alice);
		await roster.add([await next(roster, alice, bob.deviceId, 'admit')]);
		const beforeHandoff = roster.ops();
		await roster.add([await next(roster, alice, bob.deviceId, 'host')]);
		await roster.add([await next(roster, bob, alice.deviceId, 'remove')]);

		const fork = new Roster(roomId);
		await fork.add(beforeHandoff);
		await fork.add([await next(fork, alice, mallory.deviceId, 'admit')]);

		// A joiner hears Alice's fork first, then the real chain.
		const joiner = new Roster(roomId);
		await joiner.add(fork.ops());
		expect(joiner.isAdmitted(mallory.deviceId)).toBe(true);
		expect(await joiner.add(roster.ops())).toBe(true);
		expect(joiner.host).toBe(bob.deviceId);
		expect(joiner.isAdmitted(mallory.deviceId)).toBe(false);
		expect(joiner.isAdmitted(alice.deviceId)).toBe(false);
	});

	test('a host that signs two handovers is caught and admission freezes', async () => {
		const [alice, bob, carol] = await people(3);
		const { roomId, roster } = await foundRoom(alice);
		await roster.add([await next(roster, alice, bob.deviceId, 'admit')]);
		await roster.add([await next(roster, alice, carol.deviceId, 'admit')]);
		const shared = roster.ops();
		await roster.add([await next(roster, alice, bob.deviceId, 'host')]);
		const other = new Roster(roomId);
		await other.add(shared);
		await other.add([await next(other, alice, carol.deviceId, 'host')]);

		expect(await roster.add(other.ops())).toBe(false);
		expect(roster.forked).toBe(true);
		expect(roster.host).toBe(bob.deviceId);
	});

	test('a snapshot replaces a shorter chain and ignores a fake one', async () => {
		const [alice, bob, mallory] = await people(3);
		const { roomId, roster } = await foundRoom(alice);
		await roster.add([await next(roster, alice, bob.deviceId, 'admit')]);

		const joiner = new Roster(roomId);
		const fake = await foundRoom(mallory);
		expect(await joiner.add(fake.roster.ops())).toBe(false);
		expect(await joiner.add(roster.ops())).toBe(true);
		expect(joiner.isAdmitted(bob.deviceId)).toBe(true);
		// Older, shorter news never rolls it back.
		expect(await joiner.add(roster.ops().slice(0, 1))).toBe(false);
		expect(joiner.length).toBe(2);
	});

	test('re-encoded signatures do not fork the chain', async () => {
		const [alice, bob] = await people(2);
		const { roster } = await foundRoom(alice);
		const op = await next(roster, alice, bob.deviceId, 'admit');
		await roster.add([op]);
		const reencoded = { ...op, sig: op.sig.slice(0, -1) + (op.sig.endsWith('A') ? 'B' : 'A') };
		await roster.add([reencoded]);
		expect(roster.length).toBe(2);
		expect(roster.isAdmitted(bob.deviceId)).toBe(true);
	});

	test('the host can open the room and close it again', async () => {
		const [alice, dan] = await people(2);
		const { roster } = await foundRoom(alice);
		await roster.add([await next(roster, alice, '*', 'open')]);
		expect(roster.isAdmitted(dan.deviceId)).toBe(true);
		await roster.add([await next(roster, alice, '*', 'approve')]);
		expect(roster.isAdmitted(dan.deviceId)).toBe(false);
	});

	test('forged or other-room operations are refused', async () => {
		const [alice, bob] = await people(2);
		const { roster } = await foundRoom(alice);
		const op = await next(roster, alice, bob.deviceId, 'admit');
		expect(await roster.add([{ ...op, device: 'someone-else' } as RosterOp])).toBe(false);
		expect(await roster.add([{ ...op, action: 'remove' } as RosterOp])).toBe(false);
		const elsewhere = await signRosterOp(alice, 'other-room', {
			...roster.nextLink(),
			device: bob.deviceId,
			action: 'admit'
		});
		expect(await roster.add([elsewhere])).toBe(false);
		expect(roster.isAdmitted(bob.deviceId)).toBe(false);
	});
});

describe('legacy rooms', () => {
	test('rooms without a founder anchor stay open and take no operations', async () => {
		const [alice, bob] = await people(2);
		const roster = new Roster('test-room-legacy');
		const op = await signRosterOp(alice, 'test-room-legacy', {
			seq: 0,
			prev: '',
			device: '*',
			action: 'approve'
		});
		expect(await roster.add([op])).toBe(false);
		expect(roster.isAdmitted(bob.deviceId)).toBe(true);
	});
});
