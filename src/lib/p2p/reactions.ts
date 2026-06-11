/**
 * Pure reaction-state transition (PROTOCOL.md §3.5).
 *
 * Membership is keyed by the envelope-verified sender deviceId — ids
 * asserted inside message bodies are never trusted. A device can only
 * add or remove itself.
 */

export type ReactionMap = Record<string, { users: string[]; count: number }>;

export function applyReaction(
	reactions: ReactionMap,
	emoji: string,
	deviceId: string,
	action: 'add' | 'remove'
): ReactionMap {
	const next = { ...reactions };
	const entry = next[emoji] ?? { users: [], count: 0 };
	const users =
		action === 'add'
			? entry.users.includes(deviceId)
				? entry.users
				: [...entry.users, deviceId]
			: entry.users.filter((u) => u !== deviceId);
	if (users.length === 0) {
		delete next[emoji];
	} else {
		next[emoji] = { users, count: users.length };
	}
	return next;
}
