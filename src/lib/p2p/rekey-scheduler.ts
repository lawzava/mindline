/**
 * §1.4 rekey trigger state machine, extracted from manager.ts so the timer
 * hygiene is testable. Joins/leaves debounce into ONE mint decision; the
 * lowest-deviceId direct member mints (shouldMint), everyone else arms a
 * fallback that mints only if the designated minter never delivered.
 *
 * clear() MUST be called on every disconnect path — a stale baseline or a
 * stale pending fallback from a previous room suppresses the next room's
 * rekey (the baseline ??= keeps the old room's (g, gid), and the
 * one-fallback-at-a-time rule blocks arming a fresh one).
 */
export interface RekeyDeps {
	generation: () => { g: number; gid: string };
	shouldMint: () => boolean;
	mint: () => void;
}

export class RekeyScheduler {
	private debounce: ReturnType<typeof setTimeout> | null = null;
	private fallback: ReturnType<typeof setTimeout> | null = null;
	private baseline: { g: number; gid: string } | null = null;

	constructor(
		private readonly debounceMs: number,
		private readonly fallbackMs: number
	) {}

	schedule(deps: RekeyDeps): void {
		this.baseline ??= deps.generation();
		if (this.debounce) clearTimeout(this.debounce);
		this.debounce = setTimeout(() => {
			this.debounce = null;
			const baseline = this.baseline;
			this.baseline = null;
			if (!baseline) return;
			const cur = deps.generation();
			// Someone already ratcheted past the trigger burst's baseline —
			// the rotation this burst asked for has happened.
			if (cur.g !== baseline.g || cur.gid !== baseline.gid) return;
			if (deps.shouldMint()) {
				deps.mint();
			} else if (!this.fallback) {
				this.fallback = setTimeout(() => {
					this.fallback = null;
					const now = deps.generation();
					if (now.g === baseline.g && now.gid === baseline.gid) deps.mint();
				}, this.fallbackMs);
			}
		}, this.debounceMs);
	}

	clear(): void {
		if (this.debounce) clearTimeout(this.debounce);
		if (this.fallback) clearTimeout(this.fallback);
		this.debounce = null;
		this.fallback = null;
		this.baseline = null;
	}
}
