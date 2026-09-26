import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createRoomKey, deriveRoomKeys, importRoomKeyMaterial } from '$lib/crypto/keys';
import { burnRoom, loadInviteKey, saveInviteKey, saveRoomKeys } from '$lib/crypto/keystore';
import { CryptoSession } from '$lib/p2p/crypto-session';
import { isBurned, markBurned, clearBurned } from '$lib/storage/tombstone';

vi.mock('$app/environment', () => ({ browser: true }));

const memory = new Map<string, string>();
vi.stubGlobal('localStorage', {
	getItem: (k: string) => memory.get(k) ?? null,
	setItem: (k: string, v: string) => memory.set(k, String(v)),
	removeItem: (k: string) => memory.delete(k),
	clear: () => memory.clear()
});

beforeEach(() => {
	indexedDB = new IDBFactory();
	localStorage.clear();
});

describe('invite keys at rest', () => {
	test('the link key is kept only wrapped inside the room record, and burn removes it', async () => {
		const raw = createRoomKey();
		const keys = await deriveRoomKeys(await importRoomKeyMaterial(raw));
		await saveRoomKeys('room-1', keys, raw);
		expect(await loadInviteKey('room-1')).toEqual(raw);

		const record = await new Promise<Record<string, unknown>>((resolve) => {
			const open = indexedDB.open('mindline-keys');
			open.onsuccess = () => {
				const req = open.result.transaction('rooms').objectStore('rooms').get('room-1');
				req.onsuccess = () => resolve(req.result);
			};
		});
		const bytes = JSON.stringify(record, (_k, v) => (v instanceof Uint8Array ? [...v] : v));
		expect(bytes).not.toContain(JSON.stringify([...raw]).slice(1, -1));

		await burnRoom('room-1');
		expect(await loadInviteKey('room-1')).toBeNull();
	});

	test('a legacy key can be attached to an existing room only', async () => {
		const raw = createRoomKey();
		expect(await saveInviteKey('nowhere', raw)).toBe(false);
		await saveRoomKeys('room-2', await deriveRoomKeys(await importRoomKeyMaterial(raw)));
		expect(await saveInviteKey('room-2', raw)).toBe(true);
		expect(await loadInviteKey('room-2')).toEqual(raw);
	});

	test('creating a session from a link stores the invite key', async () => {
		const raw = createRoomKey();
		await CryptoSession.create('room-3', raw);
		expect(await loadInviteKey('room-3')).toEqual(raw);
	});
});

describe('rendezvous id', () => {
	test('is derived from the key: same room and key agree, a different key does not', async () => {
		const raw = createRoomKey();
		const a = (await CryptoSession.create('room-r', raw))!;
		indexedDB = new IDBFactory();
		const b = (await CryptoSession.create('room-r', raw))!;
		indexedDB = new IDBFactory();
		const c = (await CryptoSession.create('room-r', createRoomKey()))!;
		expect(a.rendezvousId).toBe(b.rendezvousId);
		expect(a.rendezvousId).not.toBe(c.rendezvousId);
		expect(a.rendezvousId).not.toContain('room-r');
		expect(a.rendezvousId).toMatch(/^[A-Za-z0-9_-]{32}$/);
	});
});

describe('burn tombstones', () => {
	test('a burned room is remembered by a hash, and can be cleared', async () => {
		expect(await isBurned('room-t')).toBe(false);
		await markBurned('room-t');
		expect(await isBurned('room-t')).toBe(true);
		expect(localStorage.getItem('mindline_burned')).not.toContain('room-t');
		await clearBurned('room-t');
		expect(await isBurned('room-t')).toBe(false);
	});
});
