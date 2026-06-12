/**
 * Per-sender replay rejection (PROTOCOL.md §2).
 *
 * Senders stamp every body with (epoch, seq): epoch comes from a
 * device-identity-scoped monotonic high-water (never regresses), seq
 * restarts at 0 per session. A device legitimately runs several tabs at
 * once, each with its own epoch, so the guard retains up to K
 * concurrently-active epochs per (sender, class) rather than a single
 * high-water — otherwise the lower-epoch tab is censored the moment a
 * higher-epoch tab sends. Within an epoch: 'msg' (ordered reliable
 * channel) requires strictly increasing seq; 'eph' (unordered lossy)
 * accepts within a sliding window, rejecting duplicates. Eviction of the
 * smallest epoch past K is one-way: an evicted epoch is rejected, never
 * reopened, so epoch churn cannot manufacture a replay slot.
 */

interface EpochSlot {
	epoch: number;
	/** Highest seq seen in this epoch. */
	high: number;
	/** Reorder bookkeeping for 'eph'; unused for 'msg'. */
	seen: number[];
}

interface SenderState {
	msg: EpochSlot[];
	eph: EpochSlot[];
}

export interface ReplayState {
	[senderId: string]: SenderState;
}

export class ReplayGuard {
	private senders = new Map<string, SenderState>();
	private readonly ephWindow: number;
	private readonly maxEpochs: number;

	constructor(opts: { ephWindow?: number; maxEpochs?: number } = {}) {
		this.ephWindow = opts.ephWindow ?? 64;
		this.maxEpochs = opts.maxEpochs ?? 4;
	}

	/** Returns true when (epoch, seq) is fresh; false means drop the payload. */
	check(senderId: string, klass: 'msg' | 'eph', epoch: number, seq: number): boolean {
		if (!Number.isFinite(epoch) || !Number.isFinite(seq) || epoch < 0 || seq < 0) return false;
		let state = this.senders.get(senderId);
		if (!state) {
			state = { msg: [], eph: [] };
			this.senders.set(senderId, state);
		}
		const slots = klass === 'msg' ? state.msg : state.eph;
		return klass === 'msg' ? this.checkMsg(slots, epoch, seq) : this.checkEph(slots, epoch, seq);
	}

	private largestEpoch(slots: EpochSlot[]): number {
		let max = -1;
		for (const s of slots) if (s.epoch > max) max = s.epoch;
		return max;
	}

	/** Add a new (higher-than-all-retained) epoch, evicting the smallest past K. */
	private admit(slots: EpochSlot[], slot: EpochSlot): void {
		slots.push(slot);
		if (slots.length > this.maxEpochs) {
			let minIdx = 0;
			for (let i = 1; i < slots.length; i++) {
				if (slots[i].epoch < slots[minIdx].epoch) minIdx = i;
			}
			slots.splice(minIdx, 1);
		}
	}

	private checkMsg(slots: EpochSlot[], epoch: number, seq: number): boolean {
		const slot = slots.find((s) => s.epoch === epoch);
		if (slot) {
			if (seq <= slot.high) return false;
			slot.high = seq;
			return true;
		}
		// Unknown epoch: admit only if it exceeds every retained epoch.
		// Anything at-or-below the retained range was evicted or never seen.
		if (epoch > this.largestEpoch(slots)) {
			this.admit(slots, { epoch, high: seq, seen: [] });
			return true;
		}
		return false;
	}

	private checkEph(slots: EpochSlot[], epoch: number, seq: number): boolean {
		const slot = slots.find((s) => s.epoch === epoch);
		if (!slot) {
			if (epoch > this.largestEpoch(slots)) {
				this.admit(slots, { epoch, high: seq, seen: [seq] });
				return true;
			}
			return false;
		}
		if (seq <= slot.high - this.ephWindow) return false;
		if (slot.seen.includes(seq)) return false;
		slot.seen.push(seq);
		if (seq > slot.high) {
			slot.high = seq;
			const floor = slot.high - this.ephWindow;
			slot.seen = slot.seen.filter((s) => s > floor);
		}
		return true;
	}

	/** Forget a sender entirely. */
	reset(senderId: string): void {
		this.senders.delete(senderId);
	}

	serialize(): ReplayState {
		const cloneSlots = (slots: EpochSlot[]): EpochSlot[] =>
			slots.map((s) => ({ epoch: s.epoch, high: s.high, seen: [...s.seen] }));
		return Object.fromEntries(
			[...this.senders.entries()].map(([id, s]) => [
				id,
				{ msg: cloneSlots(s.msg), eph: cloneSlots(s.eph) }
			])
		);
	}

	static hydrate(state: ReplayState, opts: { ephWindow?: number; maxEpochs?: number } = {}): ReplayGuard {
		const guard = new ReplayGuard(opts);
		const cloneSlots = (slots: unknown): EpochSlot[] =>
			Array.isArray(slots)
				? slots.map((s: EpochSlot) => ({ epoch: s.epoch, high: s.high, seen: [...(s.seen ?? [])] }))
				: [];
		for (const [id, s] of Object.entries(state)) {
			guard.senders.set(id, { msg: cloneSlots(s?.msg), eph: cloneSlots(s?.eph) });
		}
		return guard;
	}
}
