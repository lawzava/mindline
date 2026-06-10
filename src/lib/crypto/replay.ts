/**
 * Per-sender replay rejection (PROTOCOL.md §2).
 *
 * 'msg' rides an ordered reliable channel: seq must be strictly increasing.
 * 'eph' rides an unordered lossy channel: accept within a sliding window,
 * reject duplicates and anything older than the window.
 */

interface SenderState {
	msgHigh: number;
	ephHigh: number;
	ephSeen: Set<number>;
}

export class ReplayGuard {
	private senders = new Map<string, SenderState>();
	private readonly ephWindow: number;

	constructor(opts: { ephWindow?: number } = {}) {
		this.ephWindow = opts.ephWindow ?? 64;
	}

	/** Returns true when seq is fresh; false means drop the payload. */
	check(senderId: string, klass: 'msg' | 'eph', seq: number): boolean {
		if (!Number.isFinite(seq) || seq < 0) return false;
		let state = this.senders.get(senderId);
		if (!state) {
			state = { msgHigh: -1, ephHigh: -1, ephSeen: new Set() };
			this.senders.set(senderId, state);
		}

		if (klass === 'msg') {
			if (seq <= state.msgHigh) return false;
			state.msgHigh = seq;
			return true;
		}

		if (seq <= state.ephHigh - this.ephWindow) return false;
		if (state.ephSeen.has(seq)) return false;
		state.ephSeen.add(seq);
		if (seq > state.ephHigh) {
			state.ephHigh = seq;
			const floor = state.ephHigh - this.ephWindow;
			for (const s of state.ephSeen) if (s <= floor) state.ephSeen.delete(s);
		}
		return true;
	}

	/** Forget a sender entirely (their session restarted with a new seq=0). */
	reset(senderId: string): void {
		this.senders.delete(senderId);
	}
}
