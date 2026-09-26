import { describe, expect, test } from 'vitest';
import { createDeviceIdentity, type DeviceIdentity } from '$lib/crypto/identity';
import {
	ADMIT_LIMIT,
	DELEGATE,
	Roster,
	founderRoomId,
	signRosterOp,
	signVoucher,
	type RosterAction
} from '$lib/p2p/roster';

async function people(n: number): Promise<DeviceIdentity[]> {
	return Promise.all(Array.from({ length: n }, () => createDeviceIdentity()));
}

async function step(roster: Roster, who: DeviceIdentity, device: string, action: RosterAction) {
	const op = await signRosterOp(who, roster.roomId, { ...roster.nextLink(), device, action });
	expect(await roster.add([op])).toBe(true);
}

/** Alice founds; Bob is admitted by her; members may let people in. */
async function roomWithBob() {
	const [alice, bob, carol, dave] = await people(4);
	const { roomId, salt } = await founderRoomId(alice.spki);
	const roster = new Roster(roomId);
	await roster.add([
		await signRosterOp(alice, roomId, { seq: 0, prev: '', device: '*', action: 'approve', salt })
	]);
	await step(roster, alice, bob.deviceId, 'admit');
	await step(roster, alice, DELEGATE, 'admit');
	return { roster, roomId, alice, bob, carol, dave };
}

const vouch = (who: DeviceIdentity, roster: Roster, device: string) =>
	signVoucher(who, roster.roomId, {
		device,
		basis: roster.basisOf(who.deviceId)!,
		epoch: roster.delegateEpoch
	});

describe('members letting people in (PROTOCOL.md §3.8)', () => {
	test('a member lets someone in when the host allows it', async () => {
		const { roster, bob, carol } = await roomWithBob();
		expect(roster.membersAdmit).toBe(true);
		expect(await roster.addVouchers([await vouch(bob, roster, carol.deviceId)])).toBe(true);
		expect(roster.isAdmitted(carol.deviceId)).toBe(true);
		expect(roster.vouchers()).toHaveLength(1);
	});

	test('without the host allowing it, a member vouching does nothing', async () => {
		const { roster, alice, bob, carol } = await roomWithBob();
		await step(roster, alice, DELEGATE, 'remove');
		await roster.addVouchers([await vouch(bob, roster, carol.deviceId)]);
		expect(roster.isAdmitted(carol.deviceId)).toBe(false);
		expect(roster.vouchers()).toEqual([]);
	});

	test('turning it off again ends admissions the host has not confirmed', async () => {
		const { roster, alice, bob, carol } = await roomWithBob();
		await roster.addVouchers([await vouch(bob, roster, carol.deviceId)]);
		await step(roster, alice, DELEGATE, 'remove');
		expect(roster.isAdmitted(carol.deviceId)).toBe(false);
	});

	test('removing a member ends the admissions it made, even ones it signs afterwards', async () => {
		const { roster, alice, bob, carol, dave } = await roomWithBob();
		const early = await vouch(bob, roster, carol.deviceId);
		await roster.addVouchers([early]);
		await step(roster, alice, bob.deviceId, 'remove');
		expect(roster.isAdmitted(carol.deviceId)).toBe(false);
		// Signed after the removal, claiming Bob's old membership.
		await roster.addVouchers([
			await signVoucher(bob, roster.roomId, {
				device: dave.deviceId,
				basis: 1,
				epoch: roster.delegateEpoch
			})
		]);
		expect(roster.isAdmitted(dave.deviceId)).toBe(false);
		// Let back in, Bob's old vouchers stay dead: they name his old membership.
		await step(roster, alice, bob.deviceId, 'admit');
		expect(roster.isAdmitted(carol.deviceId)).toBe(false);
	});

	test('someone the host removed cannot be vouched back in', async () => {
		const { roster, alice, bob, carol } = await roomWithBob();
		await step(roster, alice, carol.deviceId, 'admit');
		await step(roster, alice, carol.deviceId, 'remove');
		await roster.addVouchers([await vouch(bob, roster, carol.deviceId)]);
		expect(roster.isAdmitted(carol.deviceId)).toBe(false);
	});

	test('only members vouch, only with their own key, and only for this room', async () => {
		const { roster, bob, carol, dave } = await roomWithBob();
		// Carol is not a member.
		await roster.addVouchers([
			await signVoucher(carol, roster.roomId, {
				device: dave.deviceId,
				basis: 0,
				epoch: roster.delegateEpoch
			})
		]);
		// Bob's voucher, re-labelled as someone else's device.
		const forged = { ...(await vouch(bob, roster, dave.deviceId)), device: carol.deviceId };
		// Bob's voucher for another room.
		const elsewhere = await signVoucher(bob, 'f_AAAAAAAAAAAAAAAAAAAAAA', {
			device: dave.deviceId,
			basis: roster.basisOf(bob.deviceId)!,
			epoch: roster.delegateEpoch
		});
		await roster.addVouchers([forged, elsewhere, { junk: true }]);
		expect(roster.isAdmitted(carol.deviceId)).toBe(false);
		expect(roster.isAdmitted(dave.deviceId)).toBe(false);
		expect(roster.vouchers()).toEqual([]);
	});

	test('someone let in by a member cannot let others in until the host confirms them', async () => {
		const { roster, alice, bob, carol, dave } = await roomWithBob();
		await roster.addVouchers([await vouch(bob, roster, carol.deviceId)]);
		expect(roster.basisOf(carol.deviceId)).toBeNull();
		await roster.addVouchers([
			await signVoucher(carol, roster.roomId, {
				device: dave.deviceId,
				basis: 0,
				epoch: roster.delegateEpoch
			})
		]);
		expect(roster.isAdmitted(dave.deviceId)).toBe(false);
		// Confirmed by the host, Carol is a full member.
		await step(roster, alice, carol.deviceId, 'admit');
		await roster.addVouchers([await vouch(carol, roster, dave.deviceId)]);
		expect(roster.isAdmitted(dave.deviceId)).toBe(true);
	});

	test('the switch is an ordinary admit of a pseudo-device, which older versions accept', async () => {
		const { roster } = await roomWithBob();
		expect(roster.ops().at(-1)).toMatchObject({ action: 'admit', device: DELEGATE });
		expect(roster.isAdmitted(DELEGATE)).toBe(false);
	});

	test('turning member admission off and on again does not revive old vouchers', async () => {
		const { roster, alice, bob, carol } = await roomWithBob();
		const old = await vouch(bob, roster, carol.deviceId);
		await step(roster, alice, DELEGATE, 'remove');
		await step(roster, alice, DELEGATE, 'admit');
		await roster.addVouchers([old]);
		expect(roster.isAdmitted(carol.deviceId)).toBe(false);
	});

	test('closing the room again ends vouchers the host has not confirmed', async () => {
		const { roster, alice, bob, carol } = await roomWithBob();
		await roster.addVouchers([await vouch(bob, roster, carol.deviceId)]);
		await step(roster, alice, '*', 'open');
		await step(roster, alice, '*', 'approve');
		expect(roster.isAdmitted(carol.deviceId)).toBe(false);
	});

	test('one member cannot take every voucher slot', async () => {
		const { roster, alice, bob, carol } = await roomWithBob();
		const [erin] = await people(1);
		await step(roster, alice, erin.deviceId, 'admit');
		const flood = await Promise.all(
			Array.from({ length: 10 }, async () =>
				vouch(bob, roster, (await createDeviceIdentity()).deviceId)
			)
		);
		await roster.addVouchers(flood);
		expect(roster.vouchers().filter((v) => v.by === bob.deviceId)).toHaveLength(4);
		expect(await roster.addVouchers([await vouch(erin, roster, carol.deviceId)])).toBe(true);
	});

	test('chains written before the admit limit still load past it', async () => {
		const { roster, alice, bob } = await roomWithBob();
		while (roster.length < ADMIT_LIMIT + 2) {
			await step(roster, alice, (await createDeviceIdentity()).deviceId, 'admit');
		}
		// A removal after those old admits still applies.
		await step(roster, alice, bob.deviceId, 'remove');
		expect(roster.isAdmitted(bob.deviceId)).toBe(false);
		const copy = new Roster(roster.roomId);
		expect(await copy.add(roster.ops())).toBe(true);
		expect(copy.length).toBe(roster.length);
	}, 60_000);

	test('vouchers are bounded', async () => {
		const { roster, bob } = await roomWithBob();
		const many = await Promise.all(
			Array.from({ length: 40 }, async () =>
				vouch(bob, roster, (await createDeviceIdentity()).deviceId)
			)
		);
		await roster.addVouchers(many);
		expect(roster.vouchers().length).toBeLessThanOrEqual(32);
	});
});
