/**
 * Per-key cooldown gate for the §1.4 rekey rate limits.
 *
 * Keys MUST be stable identities (verified deviceIds) — the server-assigned
 * clientId rotates on every signaling reconnect, which both resets the
 * window (limiter bypass by socket cycling) and strands dead entries.
 * Sans-IO: the clock is injected for testability.
 */
export class CooldownGate {
	private last = new Map<string, number>();

	constructor(
		private readonly intervalMs: number,
		private readonly now: () => number = Date.now
	) {}

	/** True (and stamps the window) iff `key` is outside its cooldown. */
	allow(key: string): boolean {
		const last = this.last.get(key) ?? 0;
		if (this.now() - last < this.intervalMs) return false;
		this.last.set(key, this.now());
		return true;
	}

	forget(key: string): void {
		this.last.delete(key);
	}

	clear(): void {
		this.last.clear();
	}

	get size(): number {
		return this.last.size;
	}
}
