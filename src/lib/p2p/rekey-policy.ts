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
