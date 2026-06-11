/**
 * Burn a room from this device (PROTOCOL.md §4, PRIVACY.md): delete the
 * room's keys and replay state, encrypted history (and any legacy
 * plaintext), and media blobs. Keys go first so a racing fire-and-forget
 * save can no longer encrypt anything back. Device identity and its
 * monotonic epoch high-water (§2) are per-device, not per-room, and
 * deliberately survive — the high-water must never regress, or a burned
 * device would be censored by peers' persisted replay state. Peers keep
 * their copies.
 */

import { burnRoom } from '$lib/crypto/keystore';
import { burnRoomBlobs } from '$lib/media/blob-store';
import { clearRoomMessages } from './messages';

export async function burnRoomData(roomId: string): Promise<void> {
	const failures: string[] = [];
	const steps: Array<[string, () => Promise<void>]> = [
		['keys', () => burnRoom(roomId)],
		['history', () => clearRoomMessages(roomId)],
		['media', () => burnRoomBlobs(roomId)]
	];
	for (const [name, step] of steps) {
		try {
			await step();
		} catch (error) {
			failures.push(`${name}: ${String(error)}`);
		}
	}
	// Other tabs hold the room keys in memory and would re-persist history;
	// tell them to evacuate. Announced even on partial failure so they stop
	// writing either way.
	try {
		const channel = new BroadcastChannel('mindline_burn');
		channel.postMessage({ roomId });
		channel.close();
	} catch {
		/* BroadcastChannel unsupported: single-tab burn only */
	}
	if (failures.length > 0) {
		throw new Error(`burn incomplete — ${failures.join('; ')}`);
	}
}
