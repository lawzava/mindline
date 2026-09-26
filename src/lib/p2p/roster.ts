/**
 * Room admission (PROTOCOL.md §3.8). The link lets a device reach the room;
 * in an approving room, only the room's host can let it in.
 *
 * Trust is anchored in the room id: a room made on this version has an id
 * that commits to its founder's device key, so every device can check the
 * founding operation without trusting whoever relays it. After that, the
 * roster is a single hash chain: each operation names the one before it and
 * is signed by the host of the moment (the founder, until it hands the role
 * on). One writer, no clocks: there is nothing to reorder, backdate, or race,
 * and anything a non-host signs is refused before it is stored.
 *
 * Members letting people in: when the host allows it (an `admit` of the
 * pseudo-device DELEGATE, a form older versions already accept), a member
 * signs a voucher for a waiting device. A voucher sits beside the
 * chain, not in it, and counts only while the chain still allows member
 * admission, its signer is still a member under the same admission, and
 * the device has not been removed. The host confirms vouchers into the
 * chain when it next sees them; until then, removing the signer or turning
 * member admission off ends them.
 */

import { fromB64url, toB64url } from '$lib/crypto/b64';
import { deviceIdFromSpki, importPeerPublicKey, type DeviceIdentity } from '$lib/crypto/identity';
import { lp } from '$lib/crypto/lp';

/**
 * admit/remove/host name a device (host hands the role to a member);
 * approve/open set the room's mode (device '*'). admit/remove of DELEGATE
 * turn member admission on and off.
 */
export type RosterAction = 'admit' | 'remove' | 'host' | 'approve' | 'open';

/**
 * The pseudo-device whose admission means "members may let people in".
 * Real device ids never start with '*', and older versions store it as a
 * harmless member, so they keep following the chain past it.
 */
export const DELEGATE = '*members';

export interface RosterLink {
	/** Position in the chain; 0 is the founding operation. */
	seq: number;
	/** Link (content hash) of the operation at seq - 1; '' for the founding. */
	prev: string;
}

export interface RosterOp extends RosterLink {
	device: string;
	action: RosterAction;
	/** The signer: the founder at seq 0, the host of the moment after. */
	by: string;
	/** Founding operation only: the salt the room id commits to. */
	salt?: string;
	sig: string;
	spki: string;
}

const MAX_CHAIN = 512;
const ANCHORED_PREFIX = 'f_';
const MODE = '*';
const DEVICE_ACTIONS = new Set<RosterAction>(['admit', 'remove', 'host']);
const MODE_ACTIONS = new Set<RosterAction>(['approve', 'open']);
/** Vouchers held at once; the host confirms them into the chain. */
const MAX_VOUCHERS = 32;
/** Unconfirmed vouchers held per signer, so one member cannot take every slot. */
const MAX_VOUCHERS_PER_SIGNER = 4;
/**
 * The chain's last positions are kept for removals and settings: nobody
 * (the host included, confirming vouchers) can fill the roster so full that
 * the host could no longer remove someone.
 */
export const ADMIT_LIMIT = MAX_CHAIN - 16;
const ECDSA = { name: 'ECDSA', hash: 'SHA-256' } as const;

async function founderCommitment(spkiB64: string, salt: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', lp('mindline/v1/founder', spkiB64, salt));
	return toB64url(new Uint8Array(digest).slice(0, 16));
}

/** A new room id that commits to its founder's key (with a fresh salt). */
export async function founderRoomId(
	founderSpki: Uint8Array
): Promise<{ roomId: string; salt: string }> {
	const salt = toB64url(crypto.getRandomValues(new Uint8Array(16)));
	return { roomId: ANCHORED_PREFIX + (await founderCommitment(toB64url(founderSpki), salt)), salt };
}

/** Rooms made before §3.8 have no anchor: they are always open. */
export function isAnchoredRoom(roomId: string): boolean {
	return /^f_[A-Za-z0-9_-]{22}$/.test(roomId);
}

/** What an operation says; the signature is over this, and the link is its hash. */
function content(roomId: string, op: Omit<RosterOp, 'sig' | 'spki'>): Uint8Array<ArrayBuffer> {
	return lp(
		'mindline/v2/roster',
		roomId,
		String(op.seq),
		op.prev,
		op.device,
		op.action,
		op.by,
		op.salt ?? ''
	);
}

/**
 * The next operation's `prev`. It hashes content only, so a re-encoded
 * signature (base64 slack, ECDSA malleability) names the same link.
 */
async function linkOf(roomId: string, op: RosterOp): Promise<string> {
	return toB64url(new Uint8Array(await crypto.subtle.digest('SHA-256', content(roomId, op))));
}

export async function signRosterOp(
	identity: DeviceIdentity,
	roomId: string,
	fields: RosterLink & { device: string; action: RosterAction; salt?: string }
): Promise<RosterOp> {
	const unsigned = {
		seq: fields.seq,
		prev: fields.prev,
		device: fields.device,
		action: fields.action,
		by: identity.deviceId,
		...(fields.salt ? { salt: fields.salt } : {})
	};
	const sig = await crypto.subtle.sign(ECDSA, identity.privateKey, content(roomId, unsigned));
	return { ...unsigned, sig: toB64url(new Uint8Array(sig)), spki: toB64url(identity.spki) };
}

function wellFormed(op: unknown): op is RosterOp {
	const o = op as RosterOp;
	if (!o || typeof o !== 'object') return false;
	const modeOp = MODE_ACTIONS.has(o.action);
	return (
		Number.isSafeInteger(o.seq) &&
		o.seq >= 0 &&
		o.seq < MAX_CHAIN &&
		typeof o.prev === 'string' &&
		(DEVICE_ACTIONS.has(o.action) || modeOp) &&
		typeof o.device === 'string' &&
		o.device.length > 0 &&
		o.device.length <= 64 &&
		(o.device === MODE) === modeOp &&
		typeof o.by === 'string' &&
		(o.salt === undefined || (typeof o.salt === 'string' && o.salt.length <= 64)) &&
		typeof o.sig === 'string' &&
		typeof o.spki === 'string'
	);
}

async function signatureValid(roomId: string, op: RosterOp): Promise<boolean> {
	const spki = fromB64url(op.spki);
	const sig = fromB64url(op.sig);
	if (!spki || !sig) return false;
	try {
		if ((await deviceIdFromSpki(spki)) !== op.by) return false;
		const key = await importPeerPublicKey(spki);
		return await crypto.subtle.verify(ECDSA, key, sig, content(roomId, op));
	} catch {
		return false;
	}
}

interface State {
	host: string | null;
	mode: 'approve' | 'open';
	members: Set<string>;
	removed: Set<string>;
	/** Members may let people in with vouchers. */
	membersAdmit: boolean;
	/**
	 * Vouchers name this: the seq of the op that last turned member
	 * admission on or closed the room again. Either voids older vouchers.
	 */
	delegateEpoch: number;
	/** For each member: the seq of the operation that let it in (founder: 0). */
	basis: Map<string, number>;
}

const emptyState = (): State => ({
	host: null,
	mode: 'approve',
	members: new Set(),
	removed: new Set(),
	membersAdmit: false,
	delegateEpoch: -1,
	basis: new Map()
});

/** A member's signed "let this device in", valid only as long as §3.8 says. */
export interface Voucher {
	device: string;
	/** The signer, a member. */
	by: string;
	/** The seq of the operation that let the signer in: a new admission voids old vouchers. */
	basis: number;
	/** The room's delegate epoch when signed (see State.delegateEpoch). */
	epoch: number;
	sig: string;
	spki: string;
}

function voucherContent(roomId: string, v: Omit<Voucher, 'sig' | 'spki'>): Uint8Array<ArrayBuffer> {
	return lp('mindline/v1/voucher', roomId, v.device, v.by, String(v.basis), String(v.epoch));
}

export async function signVoucher(
	identity: DeviceIdentity,
	roomId: string,
	fields: { device: string; basis: number; epoch: number }
): Promise<Voucher> {
	const unsigned = {
		device: fields.device,
		by: identity.deviceId,
		basis: fields.basis,
		epoch: fields.epoch
	};
	const sig = await crypto.subtle.sign(
		ECDSA,
		identity.privateKey,
		voucherContent(roomId, unsigned)
	);
	return { ...unsigned, sig: toB64url(new Uint8Array(sig)), spki: toB64url(identity.spki) };
}

function voucherWellFormed(v: unknown): v is Voucher {
	const o = v as Voucher;
	return (
		!!o &&
		typeof o === 'object' &&
		typeof o.device === 'string' &&
		o.device.length > 0 &&
		o.device.length <= 64 &&
		!o.device.startsWith('*') &&
		typeof o.by === 'string' &&
		Number.isSafeInteger(o.basis) &&
		o.basis >= 0 &&
		o.basis < MAX_CHAIN &&
		Number.isSafeInteger(o.epoch) &&
		o.epoch >= 0 &&
		o.epoch < MAX_CHAIN &&
		typeof o.sig === 'string' &&
		typeof o.spki === 'string'
	);
}

async function voucherSignatureValid(roomId: string, v: Voucher): Promise<boolean> {
	const spki = fromB64url(v.spki);
	const sig = fromB64url(v.sig);
	if (!spki || !sig) return false;
	try {
		if ((await deviceIdFromSpki(spki)) !== v.by) return false;
		const key = await importPeerPublicKey(spki);
		return await crypto.subtle.verify(ECDSA, key, sig, voucherContent(roomId, v));
	} catch {
		return false;
	}
}

export class Roster {
	readonly anchored: boolean;
	private chain: RosterOp[] = [];
	private links: string[] = [];
	private state: State = emptyState();
	private lock: Promise<void> = Promise.resolve();
	/** Signature-checked vouchers, keyed by signer and device. */
	private voucherMap = new Map<string, Voucher>();
	/** The host signed two conflicting handovers: admission is frozen (§3.8). */
	forked = false;

	constructor(readonly roomId: string) {
		this.anchored = isAnchoredRoom(roomId);
	}

	/** Whether this device has seen the room's founding operation. */
	get known(): boolean {
		return this.chain.length > 0;
	}

	get length(): number {
		return this.chain.length;
	}

	get host(): string | null {
		return this.state.host;
	}

	get approving(): boolean {
		return this.anchored && this.state.mode === 'approve';
	}

	/** The host lets members let people in. */
	get membersAdmit(): boolean {
		return this.anchored && this.state.membersAdmit;
	}

	/** What a voucher signed now must name as its epoch. */
	get delegateEpoch(): number {
		return this.state.delegateEpoch;
	}

	/** The seq of the operation that let this member in, or null (not a chain member). */
	basisOf(device: string): number | null {
		return this.state.basis.get(device) ?? null;
	}

	private voucherValid(v: Voucher): boolean {
		const s = this.state;
		return (
			!this.forked &&
			s.membersAdmit &&
			s.delegateEpoch === v.epoch &&
			s.members.has(v.by) &&
			s.basis.get(v.by) === v.basis &&
			!s.removed.has(v.device)
		);
	}

	/** Vouchers that count now; void ones are neither honored nor passed on. */
	vouchers(): Voucher[] {
		return [...this.voucherMap.values()].filter((v) => this.voucherValid(v));
	}

	/** Devices let in by a voucher alone: the host confirms these into the chain. */
	vouchedOnly(): string[] {
		return [
			...new Set(
				this.vouchers()
					.map((v) => v.device)
					.filter((d) => !this.state.members.has(d))
			)
		];
	}

	/**
	 * Take vouchers from anywhere. Only well-formed, correctly signed ones
	 * are kept, at most MAX_VOUCHERS, void and confirmed ones making room
	 * first. Returns whether any new voucher was kept.
	 */
	async addVouchers(list: unknown): Promise<boolean> {
		if (!this.anchored || !Array.isArray(list)) return false;
		for (const [key, v] of this.voucherMap) {
			if (!this.voucherValid(v) || this.state.members.has(v.device)) this.voucherMap.delete(key);
		}
		let changed = false;
		for (const v of list.slice(0, MAX_VOUCHERS).filter(voucherWellFormed)) {
			const key = v.by + '>' + v.device;
			if (this.voucherMap.has(key) || this.voucherMap.size >= MAX_VOUCHERS) continue;
			const bySigner = [...this.voucherMap.values()].filter((held) => held.by === v.by).length;
			if (bySigner >= MAX_VOUCHERS_PER_SIGNER) continue;
			if (!this.voucherValid(v) || !(await voucherSignatureValid(this.roomId, v))) continue;
			this.voucherMap.set(key, {
				device: v.device,
				by: v.by,
				basis: v.basis,
				epoch: v.epoch,
				sig: v.sig,
				spki: v.spki
			});
			changed = true;
		}
		return changed;
	}

	isAdmitted(device: string): boolean {
		if (!this.anchored) return true;
		// Until the founder is known, membership cannot be checked: refuse.
		if (!this.known) return false;
		if (this.state.mode === 'open' || this.state.members.has(device)) return true;
		for (const v of this.voucherMap.values()) {
			if (v.device === device && this.voucherValid(v)) return true;
		}
		return false;
	}

	/** This device was removed (as opposed to never let in). */
	wasRemoved(device: string): boolean {
		return this.state.removed.has(device) && !this.state.members.has(device);
	}

	/** Where the next operation goes: sign it with these to extend the chain. */
	nextLink(): RosterLink {
		return { seq: this.chain.length, prev: this.links.at(-1) ?? '' };
	}

	/** The link of the operation at `seq` (the `prev` of the one after it). */
	linkAfter(seq: number): string {
		return this.links[seq] ?? '';
	}

	ops(): RosterOp[] {
		return [...this.chain];
	}

	/**
	 * Take operations from anywhere: storage, the host, a member's snapshot.
	 * They extend this chain when they continue it; a complete chain that
	 * contains this one and goes further replaces it. Forks and anything else
	 * are not stored. Returns
	 * whether the roster changed.
	 */
	async add(ops: unknown): Promise<boolean> {
		// One merge at a time: several peers send the chain at once on connect,
		// and interleaved appends would corrupt it for good.
		const run = this.lock.then(() => this.addNow(ops));
		this.lock = run.then(
			() => {},
			() => {}
		);
		return run;
	}

	private async addNow(ops: unknown): Promise<boolean> {
		if (!this.anchored || !Array.isArray(ops)) return false;
		const sorted = ops
			.slice(0, MAX_CHAIN)
			.filter(wellFormed)
			.sort((a, b) => a.seq - b.seq);
		if (sorted.length === 0) return false;
		if (await this.extend(sorted)) return true;
		// Not a continuation. A whole chain may know more, or reveal a fork.
		if (sorted[0].seq !== 0 || this.forked) return false;
		const theirs = await Promise.all(sorted.map((op) => linkOf(this.roomId, op)));
		const k = this.links.findIndex((link, i) => theirs[i] !== undefined && theirs[i] !== link);
		if (k === -1 && sorted.length <= this.chain.length) return false; // nothing new
		const candidate = new Roster(this.roomId);
		await candidate.extend(sorted);
		if (k === -1) return candidate.length > this.chain.length && this.adopt(candidate);
		if (candidate.length <= k) return false; // their side of the fork does not verify
		// Two valid operations at one position: whoever was host there signed
		// both. An ex-host cannot legitimately sign past its own handover, so
		// the branch that hands the role on wins; if both do, the host signed
		// two handovers and admission freezes where it is.
		const ours = this.chain[k].action === 'host';
		const other = candidate.chain[k].action === 'host';
		if (other && !ours) return this.adopt(candidate);
		if (other && ours) this.forked = true;
		return false;
	}

	private adopt(candidate: Roster): boolean {
		this.chain = candidate.chain;
		this.links = candidate.links;
		this.state = candidate.state;
		return true;
	}

	private async extend(sorted: RosterOp[]): Promise<boolean> {
		let changed = false;
		for (const op of sorted) {
			if (op.seq < this.chain.length) continue;
			if (op.seq > this.chain.length) break;
			if (!(await this.accepts(op))) continue;
			const link = await linkOf(this.roomId, op);
			// Append, link, and apply together, with no await in between.
			this.chain.push(op);
			this.links.push(link);
			this.apply(op);
			changed = true;
		}
		return changed;
	}

	private async accepts(op: RosterOp): Promise<boolean> {
		if (op.prev !== (this.links.at(-1) ?? '')) return false;
		if (!(await signatureValid(this.roomId, op))) return false;
		if (op.seq === 0) {
			return (
				op.action === 'approve' &&
				!!op.salt &&
				ANCHORED_PREFIX + (await founderCommitment(op.spki, op.salt)) === this.roomId
			);
		}
		if (op.salt !== undefined || op.by !== this.state.host) return false;
		// '*' names the room, DELEGATE the member-admission switch; nothing else.
		if (op.device !== MODE && op.device.startsWith('*')) {
			if (op.device !== DELEGATE || op.action === 'host') return false;
		}
		// The host hands the role on before leaving; it cannot orphan the room.
		if (op.action === 'remove' && op.device === this.state.host) return false;
		if (op.action === 'host' && !this.state.members.has(op.device)) return false;
		return true;
	}

	private apply(op: RosterOp): void {
		const s = this.state;
		switch (op.action) {
			case 'approve':
				if (op.seq === 0) {
					s.host = op.by;
					s.members.add(op.by);
					s.basis.set(op.by, 0);
				} else {
					// Closing the room again also ends unconfirmed vouchers.
					s.delegateEpoch = op.seq;
				}
				s.mode = 'approve';
				break;
			case 'open':
				s.mode = 'open';
				break;
			case 'admit':
				if (op.device === DELEGATE) {
					s.membersAdmit = true;
					s.delegateEpoch = op.seq;
					break;
				}
				s.members.add(op.device);
				s.removed.delete(op.device);
				s.basis.set(op.device, op.seq);
				break;
			case 'remove':
				if (op.device === DELEGATE) {
					s.membersAdmit = false;
					break;
				}
				s.members.delete(op.device);
				s.removed.add(op.device);
				s.basis.delete(op.device);
				break;
			case 'host':
				s.host = op.device;
				break;
		}
	}
}
