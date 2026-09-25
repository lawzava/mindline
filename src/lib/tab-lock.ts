/**
 * One live tab per room. Tabs of one browser share a device identity, so
 * two live tabs look like one peer connecting twice: each replaces the
 * other's connection and messages silently stop flowing. Like WhatsApp Web,
 * the second tab waits and can take the room over explicitly.
 */

export interface RoomTab {
	release(): void;
}

const ALWAYS: RoomTab = { release() {} };

function lockName(roomId: string): string {
	return `mindline-room:${roomId}`;
}

/**
 * Take-over uses the Web Locks `steal` option: the holder's lock request
 * rejects, which is its signal to step back. Nothing depends on the holder
 * cooperating, so a frozen background tab cannot block "Use here".
 */
function acquire(
	roomId: string,
	options: LockOptions,
	onTakenOver: () => void
): Promise<RoomTab | null> {
	let free!: () => void;
	const held = new Promise<void>((resolve) => (free = resolve));
	let granted = false;
	let released = false;
	return new Promise((resolve) => {
		navigator.locks
			.request(lockName(roomId), options, (lock) => {
				if (!lock) {
					resolve(null);
					return;
				}
				granted = true;
				resolve({
					release() {
						released = true;
						free();
					}
				});
				return held;
			})
			.catch(() => {
				if (granted && !released) onTakenOver();
				resolve(null);
			});
	});
}

/**
 * Hold the room if no other tab does. Returns null when another tab holds
 * it. Without the Web Locks API every tab proceeds, as before.
 */
export async function claimRoomTab(
	roomId: string,
	onTakenOver: () => void
): Promise<RoomTab | null> {
	if (typeof navigator === 'undefined' || !navigator.locks) return ALWAYS;
	return acquire(roomId, { ifAvailable: true }, onTakenOver);
}

/** Take the room from whichever tab holds it. */
export async function takeOverRoomTab(roomId: string, onTakenOver: () => void): Promise<RoomTab> {
	if (typeof navigator === 'undefined' || !navigator.locks) return ALWAYS;
	return (await acquire(roomId, { steal: true }, onTakenOver)) ?? ALWAYS;
}
