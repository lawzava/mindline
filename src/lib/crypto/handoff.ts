/**
 * A link key handed from the start page to the room page in memory. On a
 * device with the passkey lock on, a key that went through the address bar
 * would also land in browser history, where the lock cannot reach it.
 */

let pending: { roomId: string; key: Uint8Array } | null = null;

export function handOffRoomKey(roomId: string, key: Uint8Array): void {
	pending = { roomId, key };
}

/** The handed-off key for this room, if any; it stays until taken. */
export function peekRoomKey(roomId: string): Uint8Array | null {
	return pending?.roomId === roomId ? pending.key : null;
}

export function takeRoomKey(roomId: string): Uint8Array | null {
	const key = peekRoomKey(roomId);
	if (key) pending = null;
	return key;
}
