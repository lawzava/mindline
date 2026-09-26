/**
 * Admission control for one room session (PROTOCOL.md §3.8): who is let in,
 * who is waiting, and where this device stands. The roster (./roster) is the
 * founder-anchored, host-signed chain; this controller turns connections and
 * notices into roster operations and tells the UI.
 *
 * Every notice carries the sender's roster chain. The receiver merges it (it
 * verifies itself from the room id down), so a device's standing always
 * follows from the roster, never from a claim in a notice.
 */

import { writable } from 'svelte/store';
import { Roster, type RosterAction, type RosterLink, type RosterOp } from './roster';
import type { PeerTransport, TypedP2PMessage } from './types';

export interface WaitingPeer {
	name: string;
	transport: PeerTransport;
}

export interface AdmissionState {
	/** The room asks before letting people in (founder-anchored rooms only). */
	approving: boolean;
	/** The room can ask at all: made on a version with admission. */
	anchored: boolean;
	/** This device is the room's host: it lets people in and removes them. */
	host: boolean;
	/** Join requests shown to the host (a few at a time). */
	pending: Map<string, WaitingPeer>;
	/** This device: in, waiting to be let in, turned away, or removed. */
	self: 'in' | 'waiting' | 'denied' | 'removed';
	/** The host's record forked: admission is frozen and the UI says so. */
	forked: boolean;
}

const initial = (): AdmissionState => ({
	approving: false,
	anchored: false,
	host: false,
	pending: new Map(),
	self: 'in',
	forked: false
});

export const admission = writable<AdmissionState>(initial());

/** Set by the landing page when this device creates a room: `{roomId, salt}`. */
export const NEW_ROOM_KEY = 'mindline_new_room';
/** Join requests shown at once; the rest wait their turn. */
const MAX_PROMPTS = 5;
/** Waiting devices remembered at once; more knocks are not tracked. */
const MAX_WAITING = 20;
/** Roster messages a peer may send per window before being ignored. */
const NOTICE_BUDGET = 8;
const NOTICE_WINDOW_MS = 10_000;
const rosterKey = (roomId: string) => `mindline_roster:${roomId}`;

export function forgetRoster(roomId: string): void {
	try {
		localStorage.removeItem(rosterKey(roomId));
	} catch {
		/* storage blocked */
	}
}

type SignFields = RosterLink & { device: string; action: RosterAction; salt?: string };

interface AdmissionDeps {
	roomId: string;
	deviceId: string;
	sign: (fields: SignFields) => Promise<RosterOp>;
	conn: {
		sendAdmission(deviceId: string, body: Record<string, unknown>): Promise<void>;
		sendToPeer(deviceId: string, message: TypedP2PMessage): Promise<void>;
		broadcast(message: TypedP2PMessage): number;
		getConnectedPeers(): string[];
	};
	/** A waiting device was let in: run the usual welcome (names, history). */
	onAdmitted: (deviceId: string, transport: PeerTransport) => void;
	/** This device was let in by `by`: ask it for history. */
	onSelfAdmitted: (by: string) => void;
	/**
	 * Someone lost access: mint a new generation now (§1.4), not debounced,
	 * so the last generation minted postdates the change on every member.
	 */
	rekey: () => void;
}

export class AdmissionController {
	private readonly roster: Roster;
	/** Connected devices the roster does not admit, oldest first. */
	private readonly waiting = new Map<string, WaitingPeer>();
	/** Turned away this session: no new prompt, even after reconnecting. */
	private readonly dismissed = new Set<string>();
	/** The host said no to this device (standing until the roster admits it). */
	private deniedHere = false;
	/** Per-peer notice budget: verifying a chain costs signatures (§3.8). */
	private readonly budget = new Map<string, { start: number; used: number }>();

	constructor(private readonly deps: AdmissionDeps) {
		this.roster = new Roster(deps.roomId);
	}

	async load(): Promise<void> {
		const { roomId } = this.deps;
		if (this.roster.anchored) {
			try {
				await this.roster.add(JSON.parse(localStorage.getItem(rosterKey(roomId)) ?? '[]'));
			} catch {
				/* unreadable: start from what peers send */
			}
			const created = readCreated();
			if (!this.roster.known && created?.roomId === roomId) {
				// This device made the room: its founding approval is the anchor.
				await this.roster.add([
					await this.deps.sign({
						seq: 0,
						prev: '',
						device: '*',
						action: 'approve',
						salt: created.salt
					})
				]);
				this.persist();
			}
		}
		sessionStorage.removeItem(NEW_ROOM_KEY);
		this.publish();
	}

	isAdmitted(deviceId: string): boolean {
		return this.roster.isAdmitted(deviceId);
	}

	private get amMember(): boolean {
		return this.roster.known && this.isAdmitted(this.deps.deviceId);
	}

	private get amHost(): boolean {
		return this.roster.host === this.deps.deviceId && this.amMember;
	}

	/**
	 * A peer passed the hello. Returns true when it is a member and the usual
	 * welcome should run. In a founder-anchored room it is always told where
	 * it stands, with this device's roster so it can check for itself.
	 */
	async onVerifiedPeer(deviceId: string, name: string, transport: PeerTransport): Promise<boolean> {
		if (!this.roster.anchored) return true;
		const member = this.isAdmitted(deviceId);
		if (this.roster.known) await this.notify(deviceId, member ? 'admitted' : 'pending');
		if (member) {
			// Members get the chain over any transport (relay included), so a
			// member that was offline learns of removals from whoever it meets.
			if (this.roster.known) {
				void this.deps.conn.sendToPeer(deviceId, {
					type: 'roster',
					ops: this.roster.ops()
				} as TypedP2PMessage);
			}
			return true;
		}
		if (this.waiting.size >= MAX_WAITING && !this.waiting.has(deviceId)) return false;
		this.waiting.set(deviceId, { name, transport });
		this.publish();
		return false;
	}

	onPeerGone(deviceId: string): void {
		if (this.waiting.delete(deviceId)) this.publish();
	}

	async admit(deviceId: string): Promise<void> {
		if (!(await this.change(deviceId, 'admit')) || !this.isAdmitted(deviceId)) {
			throw new Error('only the host can let people in');
		}
		await this.welcomeNewMembers();
		await this.notify(deviceId, 'admitted');
		// A newcomer must not read what was said before it arrived.
		this.deps.rekey();
	}

	async deny(deviceId: string): Promise<void> {
		this.dismissed.add(deviceId);
		this.publish();
		await this.notify(deviceId, 'denied');
	}

	async remove(deviceId: string): Promise<void> {
		if (!(await this.change(deviceId, 'remove')) || this.isAdmitted(deviceId)) {
			throw new Error('only the host can remove people');
		}
		this.dismissed.add(deviceId);
		await this.notify(deviceId, 'removed');
		this.deps.rekey();
	}

	async makeHost(deviceId: string): Promise<void> {
		if (!(await this.change(deviceId, 'host'))) throw new Error('only the host can hand it on');
	}

	async setApproving(on: boolean): Promise<void> {
		if (!this.roster.anchored || on === this.roster.approving) return;
		if (!(await this.change('*', on ? 'approve' : 'open'))) {
			throw new Error('only the host can change who may join');
		}
		// Closing the room ends access for everyone who came in while it was open.
		if (on) this.deps.rekey();
	}

	/** Admission notices (handshake class) and roster changes from anyone. */
	async handleMessage(body: Record<string, unknown>, from: string): Promise<void> {
		if (!this.roster.anchored || this.throttle(from)) return;
		if (body.type === 'admission') await this.onNotice(body, from);
		else if (body.type === 'roster') await this.merge(body.ops);
	}

	private async onNotice(body: Record<string, unknown>, from: string): Promise<void> {
		const wasIn = this.amMember;
		await this.merge(body.roster);
		// Only the host decides, so only the host's refusal counts.
		if (body.state === 'denied' && this.roster.known && this.roster.host === from) {
			this.deniedHere = true;
		}
		if (!wasIn && this.amMember) {
			this.deniedHere = false;
			this.deps.onSelfAdmitted(from);
		}
		this.publish();
	}

	/** Whether this peer has spent its notice budget for this window. */
	throttled(peer: string): boolean {
		const b = this.budget.get(peer);
		return !!b && Date.now() - b.start < NOTICE_WINDOW_MS && b.used >= NOTICE_BUDGET;
	}

	private throttle(peer: string): boolean {
		const now = Date.now();
		const b = this.budget.get(peer);
		if (!b || now - b.start >= NOTICE_WINDOW_MS) {
			this.budget.set(peer, { start: now, used: 1 });
			return false;
		}
		if (b.used >= NOTICE_BUDGET) return true;
		b.used++;
		return false;
	}

	/** Merge a chain; react to what actually changed. */
	private async merge(ops: unknown): Promise<void> {
		const known = this.roster.ops();
		if (!(await this.roster.add(ops))) return;
		this.persist();
		await this.welcomeNewMembers();
		// Only host-signed chain operations get this far, so a mint here is
		// bounded by real removals (or a re-closed room), never by message count.
		const fresh = this.roster.ops().filter((op, i) => known[i]?.sig !== op.sig);
		if (fresh.some((op) => op.action === 'remove' || (op.action === 'approve' && op.seq > 0))) {
			this.deps.rekey();
		}
		this.publish();
	}

	/** Connected devices the roster now admits get the usual welcome here too. */
	private async welcomeNewMembers(): Promise<void> {
		for (const [id, waiting] of [...this.waiting]) {
			if (!this.isAdmitted(id)) continue;
			this.waiting.delete(id);
			this.deps.onAdmitted(id, waiting.transport);
		}
		this.publish();
	}

	private async change(device: string, action: RosterAction): Promise<boolean> {
		if (!this.amHost) return false;
		if (this.roster.forked) {
			throw new Error(
				'The host signed conflicting changes; start a new room to be sure who is in.'
			);
		}
		if (this.roster.length >= 512) {
			throw new Error("This room's member history is full. Start a new room.");
		}
		const op = await this.deps.sign({ ...this.roster.nextLink(), device, action });
		if (!(await this.roster.add([op]))) return false;
		this.persist();
		this.deps.conn.broadcast({ type: 'roster', ops: this.roster.ops() } as TypedP2PMessage);
		this.publish();
		return true;
	}

	private async notify(deviceId: string, state: string): Promise<void> {
		await this.deps.conn.sendAdmission(deviceId, {
			type: 'admission',
			state,
			roster: this.roster.ops()
		});
	}

	private persist(): void {
		try {
			localStorage.setItem(rosterKey(this.deps.roomId), JSON.stringify(this.roster.ops()));
		} catch {
			/* storage blocked: admission still holds for this session */
		}
	}

	private publish(): void {
		const me = this.deps.deviceId;
		let self: AdmissionState['self'] = 'in';
		if (this.roster.anchored && !this.amMember) {
			self = this.roster.wasRemoved(me) ? 'removed' : this.deniedHere ? 'denied' : 'waiting';
		}
		// The host sees the oldest few requests; the rest wait their turn.
		const pending = new Map<string, WaitingPeer>();
		if (this.amHost && this.roster.approving) {
			for (const [id, waiting] of this.waiting) {
				if (pending.size >= MAX_PROMPTS) break;
				if (!this.dismissed.has(id)) pending.set(id, waiting);
			}
		}
		admission.set({
			approving: this.roster.approving,
			anchored: this.roster.anchored,
			host: this.amHost,
			pending,
			self,
			forked: this.roster.forked
		});
	}
}

function readCreated(): { roomId: string; salt: string } | null {
	try {
		const parsed = JSON.parse(sessionStorage.getItem(NEW_ROOM_KEY) ?? 'null');
		return parsed && typeof parsed.roomId === 'string' && typeof parsed.salt === 'string'
			? parsed
			: null;
	} catch {
		return null;
	}
}

export function resetAdmission(): void {
	admission.set(initial());
}
