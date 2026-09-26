/**
 * Passkey lock state for this tab (PROTOCOL.md §4). 'unknown' until the
 * keystore has been read; a room waits for that before it opens anything.
 */

import { get, writable } from 'svelte/store';
import {
	allRoomIds,
	disableLock,
	enableLock,
	forgetLock,
	loadLockRecord,
	lockPlan,
	unlock
} from '$lib/crypto/keystore';
import { deriveLockKey, isUnlocked, lockNow } from '$lib/crypto/lock';
import { createLockPasskey, passkeySecret } from '$lib/passkey';
import { burnRoomData } from '$lib/storage/burn';
import { recentRooms } from './recent-rooms';

export type LockState = 'unknown' | 'off' | 'locked' | 'unlocked';

export const deviceLock = writable<LockState>('unknown');

let ready: Promise<void> | null = null;

/** Other tabs hear when the lock goes on or off, and follow. */
const CHANNEL = 'mindline_lock';

function announce(state: 'on' | 'off'): void {
	try {
		const channel = new BroadcastChannel(CHANNEL);
		channel.postMessage({ state });
		channel.close();
	} catch {
		/* BroadcastChannel unsupported: other tabs catch up on their next write */
	}
}

function listen(): void {
	try {
		new BroadcastChannel(CHANNEL).onmessage = (event) => {
			if (event.data?.state === 'on') {
				// Rooms open here keep their in-memory keys; the gate closes them.
				if (!isUnlocked()) deviceLock.set('locked');
			} else if (event.data?.state === 'off') {
				lockNow();
				deviceLock.set('off');
			}
		};
	} catch {
		/* BroadcastChannel unsupported */
	}
}

/** The lock state, read from the keystore once per tab and kept current after. */
export async function lockReady(): Promise<LockState> {
	ready ??= (async () => {
		try {
			const lock = await loadLockRecord();
			deviceLock.set(lock ? (isUnlocked() ? 'unlocked' : 'locked') : 'off');
			listen();
		} catch {
			// No keystore at all: nothing to lock. Asked again next time.
			ready = null;
			deviceLock.set('off');
		}
	})();
	await ready;
	return get(deviceLock);
}

/**
 * Rooms that must go before the lock can go on: rooms whose link key this
 * device never kept, and Recent rooms entries that still hold a link key in
 * the clear from an older version.
 */
export async function roomsWithoutLink(): Promise<string[]> {
	const { unlockable } = await lockPlan();
	const held = new Set(await allRoomIds());
	// A room held here keeps its sealed link; only its stray plaintext copy goes.
	const legacy = recentRooms
		.legacyKeys()
		.map((r) => r.id)
		.filter((id) => !held.has(id));
	return [...new Set([...unlockable, ...legacy])];
}

/** Remove a room from this device without marking it burned. */
async function removeRoom(id: string): Promise<void> {
	await burnRoomData(id, { tombstone: false });
	recentRooms.remove(id);
}

export async function turnOnLock(): Promise<void> {
	const salt = crypto.getRandomValues(new Uint8Array(32));
	// The passkey first: cancelling, or a provider without PRF, costs nothing.
	const { credentialId, secret } = await createLockPasskey(salt);
	const key = await deriveLockKey(secret, salt);
	for (const id of await roomsWithoutLink()) await removeRoom(id);
	for (const { id } of recentRooms.legacyKeys()) recentRooms.forgetKey(id);
	await enableLock(key, { credentialId, salt });
	deviceLock.set('unlocked');
	announce('on');
}

/** Returns false when the passkey answered but is not this lock's passkey. */
export async function unlockWithPasskey(): Promise<boolean> {
	const lock = await loadLockRecord();
	if (!lock) {
		deviceLock.set('off');
		return true;
	}
	const secret = await passkeySecret(lock.credentialId, lock.salt);
	if (!(await unlock(await deriveLockKey(secret, lock.salt)))) return false;
	deviceLock.set('unlocked');
	return true;
}

export async function turnOffLock(): Promise<void> {
	await disableLock();
	deviceLock.set('off');
	announce('off');
}

/** Drop the key and every room already open in this tab. */
export function lockAgain(): void {
	lockNow();
	location.reload();
}

/** Lost passkey: every room on this device goes, then the lock. */
export async function removeAllRoomsAndLock(): Promise<void> {
	for (const id of await allRoomIds()) await removeRoom(id);
	for (const { id } of recentRooms.legacyKeys()) recentRooms.remove(id);
	await forgetLock();
	deviceLock.set('off');
	announce('off');
}

export function currentLock(): LockState {
	return get(deviceLock);
}
