/**
 * Minter selection (PROTOCOL.md §1.4): the lowest deviceId among self and
 * the verified direct peers is the designated minter. Pure storm
 * avoidance — concurrent mints converge by (g, gid) regardless — so the
 * comparison is plain lexicographic, matching the gid tie-break. Callers
 * back it with a fallback timer in case the designated minter is absent.
 */
export function shouldMint(myDeviceId: string, directPeerDeviceIds: string[]): boolean {
	for (const id of directPeerDeviceIds) if (id < myDeviceId) return false;
	return true;
}

export interface RotationPolicy {
	/** Rotate an active generation at least this often. */
	maxAgeMs: number;
	/** Rotate after this many messages, whatever the time. */
	maxMessages: number;
}

/** Defaults: a device compromise reads at most about the last half hour. */
export const ROTATION: RotationPolicy = { maxAgeMs: 15 * 60_000, maxMessages: 200 };

/**
 * Whether the current generation should be retired (§1.4). Retired keys are
 * destroyed two generations on, so rotating on time and volume bounds how
 * much captured traffic a compromised device can open, not just rotating
 * on joins and leaves. An idle generation carries nothing worth rotating.
 */
export function rotationDue(
	generation: { startedAt: number; now: number; messages: number },
	policy: RotationPolicy = ROTATION
): boolean {
	if (generation.messages === 0) return false;
	return (
		generation.messages >= policy.maxMessages ||
		generation.now - generation.startedAt >= policy.maxAgeMs
	);
}
