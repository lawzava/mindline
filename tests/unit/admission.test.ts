import { beforeEach, describe, expect, test, vi } from 'vitest';
import { get } from 'svelte/store';
import { createDeviceIdentity, type DeviceIdentity } from '$lib/crypto/identity';
import { founderRoomId, signRosterOp, type RosterAction, type RosterLink } from '$lib/p2p/roster';
import { AdmissionController, admission, NEW_ROOM_KEY } from '$lib/p2p/admission';

vi.mock('$app/environment', () => ({ browser: true }));

const memory = new Map<string, string>();
vi.stubGlobal('localStorage', {
	getItem: (k: string) => memory.get(k) ?? null,
	setItem: (k: string, v: string) => memory.set(k, String(v)),
	removeItem: (k: string) => memory.delete(k),
	clear: () => memory.clear()
});
const session = new Map<string, string>();
vi.stubGlobal('sessionStorage', {
	getItem: (k: string) => session.get(k) ?? null,
	setItem: (k: string, v: string) => session.set(k, String(v)),
	removeItem: (k: string) => session.delete(k)
});

let founder: DeviceIdentity;
let bob: DeviceIdentity;
let mallory: DeviceIdentity;
let roomId: string;
let salt: string;

function controller(self: DeviceIdentity, connected: string[] = []) {
	const conn = {
		sendAdmission: vi.fn(async () => {}),
		sendToPeer: vi.fn(async () => {}),
		broadcast: vi.fn(() => 1),
		getConnectedPeers: vi.fn(() => connected)
	};
	const hooks = { onAdmitted: vi.fn(), onSelfAdmitted: vi.fn(), rekey: vi.fn() };
	const ctl = new AdmissionController({
		roomId,
		deviceId: self.deviceId,
		sign: (fields: RosterLink & { device: string; action: RosterAction; salt?: string }) =>
			signRosterOp(self, roomId, fields),
		conn,
		...hooks
	});
	return { ctl, conn, hooks };
}

type Notice = { type: string; state: string; roster: unknown[] };
const lastNotice = (conn: { sendAdmission: { mock: { calls: unknown[][] } } }) =>
	conn.sendAdmission.mock.calls.at(-1) as unknown as [string, Notice];

beforeEach(async () => {
	founder ??= await createDeviceIdentity();
	bob ??= await createDeviceIdentity();
	mallory ??= await createDeviceIdentity();
	({ roomId, salt } = await founderRoomId(founder.spki));
	memory.clear();
	session.clear();
});

async function foundedByFounder() {
	session.set(NEW_ROOM_KEY, JSON.stringify({ roomId, salt }));
	const made = controller(founder);
	await made.ctl.load();
	return made;
}

describe('admission controller', () => {
	test('a room this device created starts approving with it as the only member', async () => {
		const { ctl } = await foundedByFounder();
		expect(ctl.isAdmitted(founder.deviceId)).toBe(true);
		expect(ctl.isAdmitted(bob.deviceId)).toBe(false);
		expect(get(admission).approving).toBe(true);
		expect(get(admission).self).toBe('in');
	});

	test('a legacy room (no founder anchor) stays open and sends no notices', async () => {
		roomId = 'legacy-room-1';
		const { ctl, conn } = controller(founder);
		await ctl.load();
		expect(await ctl.onVerifiedPeer(bob.deviceId, 'Bob', 'direct')).toBe(true);
		expect(conn.sendAdmission).not.toHaveBeenCalled();
	});

	test('a newcomer waits; letting them in tells them with the roster and rotates keys', async () => {
		const { ctl, conn, hooks } = await foundedByFounder();
		expect(await ctl.onVerifiedPeer(bob.deviceId, 'Bob', 'direct')).toBe(false);
		expect(get(admission).pending.get(bob.deviceId)?.name).toBe('Bob');
		expect(lastNotice(conn)[1].state).toBe('pending');

		await ctl.admit(bob.deviceId);
		expect(ctl.isAdmitted(bob.deviceId)).toBe(true);
		expect(get(admission).pending.has(bob.deviceId)).toBe(false);
		expect(lastNotice(conn)[1].state).toBe('admitted');
		expect(conn.broadcast).toHaveBeenCalledWith(expect.objectContaining({ type: 'roster' }));
		expect(hooks.onAdmitted).toHaveBeenCalledWith(bob.deviceId, 'direct');
		expect(hooks.rekey).toHaveBeenCalled();

		const again = controller(founder).ctl;
		await again.load();
		expect(again.isAdmitted(bob.deviceId)).toBe(true);
	});

	test('the joining side is let in only by a roster anchored to the founder', async () => {
		const host = await foundedByFounder();
		await host.ctl.onVerifiedPeer(bob.deviceId, 'Bob', 'direct');
		memory.clear(); // the joiner is another device with its own storage
		const joiner = controller(bob);
		await joiner.ctl.load();
		expect(joiner.ctl.isAdmitted(founder.deviceId)).toBe(false);

		// A stranger's own "roster" admitting Bob proves nothing.
		const founding = await signRosterOp(mallory, roomId, {
			seq: 0,
			prev: '',
			device: '*',
			action: 'approve',
			salt
		});
		const fake = [founding];
		await joiner.ctl.handleMessage(
			{ type: 'admission', state: 'admitted', roster: fake },
			mallory.deviceId
		);
		expect(get(admission).self).not.toBe('in');
		expect(joiner.ctl.isAdmitted(mallory.deviceId)).toBe(false);

		await joiner.ctl.handleMessage(lastNotice(host.conn)[1], founder.deviceId);
		expect(get(admission).self).toBe('waiting');
		await host.ctl.admit(bob.deviceId);
		await joiner.ctl.handleMessage(lastNotice(host.conn)[1], founder.deviceId);
		expect(get(admission).self).toBe('in');
		expect(joiner.ctl.isAdmitted(founder.deviceId)).toBe(true);
		expect(joiner.hooks.onSelfAdmitted).toHaveBeenCalledWith(founder.deviceId);
	});

	test('removing a member tells them, and forces a new key', async () => {
		const { ctl, conn, hooks } = await foundedByFounder();
		await ctl.onVerifiedPeer(bob.deviceId, 'Bob', 'direct');
		await ctl.admit(bob.deviceId);
		hooks.rekey.mockClear();
		await ctl.remove(bob.deviceId);
		expect(ctl.isAdmitted(bob.deviceId)).toBe(false);
		expect(lastNotice(conn)[1].state).toBe('removed');
		expect(hooks.rekey).toHaveBeenCalled();
	});

	test('a removal learned from another member also forces a new key', async () => {
		const host = await foundedByFounder();
		await host.ctl.onVerifiedPeer(bob.deviceId, 'Bob', 'direct');
		await host.ctl.admit(bob.deviceId);
		memory.clear(); // another device with its own storage
		const carol = await createDeviceIdentity();
		await host.ctl.onVerifiedPeer(carol.deviceId, 'Carol', 'direct');
		await host.ctl.admit(carol.deviceId);
		const other = controller(bob, [carol.deviceId]);
		await other.ctl.load();
		await other.ctl.handleMessage(lastNotice(host.conn)[1], founder.deviceId);
		await host.ctl.remove(carol.deviceId);
		other.hooks.rekey.mockClear();
		const broadcast = host.conn.broadcast.mock.calls.at(-1) as unknown as [{ ops: unknown[] }];
		await other.ctl.handleMessage({ type: 'roster', ops: broadcast[0].ops }, founder.deviceId);
		expect(other.hooks.rekey).toHaveBeenCalled();
		// Re-sending the same chain changes nothing and mints nothing.
		other.hooks.rekey.mockClear();
		await other.ctl.handleMessage({ type: 'roster', ops: broadcast[0].ops }, founder.deviceId);
		expect(other.hooks.rekey).not.toHaveBeenCalled();
	});

	test('notices from non-members cannot mark this device denied or removed', async () => {
		const host = await foundedByFounder();
		await host.ctl.onVerifiedPeer(bob.deviceId, 'Bob', 'direct');
		await host.ctl.admit(bob.deviceId);
		memory.clear(); // the joiner is another device with its own storage
		const joiner = controller(bob);
		await joiner.ctl.load();
		await joiner.ctl.handleMessage(lastNotice(host.conn)[1], founder.deviceId);
		await joiner.ctl.handleMessage(
			{ type: 'admission', state: 'removed', roster: [] },
			mallory.deviceId
		);
		await joiner.ctl.handleMessage(
			{ type: 'admission', state: 'denied', roster: [] },
			mallory.deviceId
		);
		expect(get(admission).self).toBe('in');
	});

	test('a turned-away device stays dismissed for the session, and waiting prompts are capped', async () => {
		const { ctl } = await foundedByFounder();
		await ctl.onVerifiedPeer(mallory.deviceId, 'Mallory', 'direct');
		await ctl.deny(mallory.deviceId);
		ctl.onPeerGone(mallory.deviceId);
		await ctl.onVerifiedPeer(mallory.deviceId, 'Mallory', 'direct');
		expect(get(admission).pending.has(mallory.deviceId)).toBe(false);

		for (let i = 0; i < 12; i++) {
			const d = await createDeviceIdentity();
			await ctl.onVerifiedPeer(d.deviceId, `Guest ${i}`, 'direct');
		}
		expect(get(admission).pending.size).toBeLessThanOrEqual(5);
	});

	test('a peer flooding notices is throttled', async () => {
		const host = await foundedByFounder();
		await host.ctl.onVerifiedPeer(bob.deviceId, 'Bob', 'direct');
		memory.clear();
		const joiner = controller(bob);
		await joiner.ctl.load();
		for (let i = 0; i < 30; i++) {
			await joiner.ctl.handleMessage(
				{ type: 'admission', state: 'pending', roster: [] },
				mallory.deviceId
			);
		}
		// Mallory's budget is spent; the host's notice still gets through.
		await joiner.ctl.handleMessage(lastNotice(host.conn)[1], founder.deviceId);
		expect(get(admission).self).toBe('waiting');
		expect(joiner.ctl.throttled(mallory.deviceId)).toBe(true);
		expect(joiner.ctl.throttled(founder.deviceId)).toBe(false);
	});

	test('members are sent the chain on connect, over any transport', async () => {
		const { ctl, conn } = await foundedByFounder();
		await ctl.onVerifiedPeer(bob.deviceId, 'Bob', 'direct');
		await ctl.admit(bob.deviceId);
		await ctl.onVerifiedPeer(bob.deviceId, 'Bob', 'relay');
		expect(conn.sendToPeer).toHaveBeenCalledWith(
			bob.deviceId,
			expect.objectContaining({ type: 'roster' })
		);
	});

	test('the host can open the room and close it again', async () => {
		const { ctl, conn } = await foundedByFounder();
		await ctl.setApproving(false);
		expect(get(admission).approving).toBe(false);
		expect(ctl.isAdmitted(bob.deviceId)).toBe(true);
		await ctl.setApproving(true);
		expect(get(admission).approving).toBe(true);
		expect(ctl.isAdmitted(bob.deviceId)).toBe(false);
		expect(conn.broadcast).toHaveBeenCalledWith(expect.objectContaining({ type: 'roster' }));
	});
});
