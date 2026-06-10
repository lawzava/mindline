/**
 * Per-sender replay rejection (PROTOCOL.md §2).
 *
 * Senders stamp every body with (epoch, seq): epoch is a persisted counter
 * incremented each session start, seq restarts at 0 per session. A newer
 * epoch legitimately resets seq (a reloaded peer is never censored); an
 * older epoch is always a replay. Within an epoch: 'msg' (ordered reliable
 * channel) requires strictly increasing seq; 'eph' (unordered lossy)
 * accepts within a sliding window, rejecting duplicates.
 */

interface SenderState {
	msgEpoch: number;
	msgHigh: number;
	ephEpoch: number;
	ephHigh: number;
	ephSeen: number[];
}

export interface ReplayState {
	[senderId: string]: SenderState;
}

export class ReplayGuard {
	private senders = new Map<string, SenderState>();
	private readonly ephWindow: number;

	constructor(opts: { ephWindow?: number } = {}) {
		this.ephWindow = opts.ephWindow ?? 64;
	}

	/** Returns true when (epoch, seq) is fresh; false means drop the payload. */
	check(senderId: string, klass: 'msg' | 'eph', epoch: number, seq: number): boolean {
		if (!Number.isFinite(epoch) || !Number.isFinite(seq) || epoch < 0 || seq < 0) return false;
		let state = this.senders.get(senderId);
		if (!state) {
			state = { msgEpoch: -1, msgHigh: -1, ephEpoch: -1, ephHigh: -1, ephSeen: [] };
			this.senders.set(senderId, state);
		}

		if (klass === 'msg') {
			if (epoch < state.msgEpoch) return false;
			if (epoch > state.msgEpoch) {
				state.msgEpoch = epoch;
				state.msgHigh = -1;
			}
			if (seq <= state.msgHigh) return false;
			state.msgHigh = seq;
			return true;
		}

		if (epoch < state.ephEpoch) return false;
		if (epoch > state.ephEpoch) {
			state.ephEpoch = epoch;
			state.ephHigh = -1;
			state.ephSeen = [];
		}
		if (seq <= state.ephHigh - this.ephWindow) return false;
		if (state.ephSeen.includes(seq)) return false;
		state.ephSeen.push(seq);
		if (seq > state.ephHigh) {
			state.ephHigh = seq;
			const floor = state.ephHigh - this.ephWindow;
			state.ephSeen = state.ephSeen.filter((s) => s > floor);
		}
		return true;
	}

	/** Forget a sender entirely. */
	reset(senderId: string): void {
		this.senders.delete(senderId);
	}

	serialize(): ReplayState {
		return Object.fromEntries(
			[...this.senders.entries()].map(([id, s]) => [id, { ...s, ephSeen: [...s.ephSeen] }])
		);
	}

	static hydrate(state: ReplayState, opts: { ephWindow?: number } = {}): ReplayGuard {
		const guard = new ReplayGuard(opts);
		for (const [id, s] of Object.entries(state)) {
			guard.senders.set(id, { ...s, ephSeen: [...s.ephSeen] });
		}
		return guard;
	}
}
