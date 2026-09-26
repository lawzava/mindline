import { describe, expect, test } from 'vitest';
import { ChainStore, MAX_SKIP, sendKey, startChain } from '$lib/crypto/chain';

async function seal(key: CryptoKey, text: string) {
	const iv = new Uint8Array(12);
	return crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text));
}

async function open(key: CryptoKey, data: ArrayBuffer) {
	const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(12) }, key, data);
	return new TextDecoder().decode(plain);
}

describe('sender-key chains (PROTOCOL.md §1.5)', () => {
	test('each message gets its own key, and a receiver with the grant derives the same', async () => {
		const chain = startChain(3);
		const grant = { index: chain.index, key: chain.key.slice() };
		const store = new ChainStore();
		store.accept('alice', 3, chain.id, grant.index, grant.key);

		const first = await sendKey(chain);
		const second = await sendKey(chain);
		expect([first.index, second.index]).toEqual([0, 1]);
		const one = await seal(first.key, 'one');
		const two = await seal(second.key, 'two');
		// Different keys: the first key cannot open the second message.
		await expect(open(first.key, two)).rejects.toThrow();

		const k0 = await store.prepare('alice', 3, chain.id, 0);
		expect(await open(k0!.key, one)).toBe('one');
		k0!.commit();
		const k1 = await store.prepare('alice', 3, chain.id, 1);
		expect(await open(k1!.key, two)).toBe('two');
		k1!.commit();
	});

	test('the sender forgets each chain key once it moves on', async () => {
		const chain = startChain(0);
		const before = chain.key;
		await sendKey(chain);
		expect(chain.key).not.toBe(before);
		expect(before.every((b) => b === 0)).toBe(true);
	});

	test('a receiver skips ahead over lost messages but never goes back', async () => {
		const chain = startChain(1);
		const store = new ChainStore();
		store.accept('alice', 1, chain.id, 0, chain.key.slice());
		const keys = [];
		for (let i = 0; i < 5; i++) keys.push(await sendKey(chain));
		const late = await store.prepare('alice', 1, chain.id, 4);
		expect(await open(late!.key, await seal(keys[4].key, 'four'))).toBe('four');
		late!.commit();
		await expect(store.prepare('alice', 1, chain.id, 2)).rejects.toThrow();
		await expect(store.prepare('alice', 1, chain.id, 4)).rejects.toThrow();
	});

	test('a failed decryption commits nothing', async () => {
		const chain = startChain(1);
		const store = new ChainStore();
		store.accept('alice', 1, chain.id, 0, chain.key.slice());
		const attempt = await store.prepare('alice', 1, chain.id, 3);
		expect(attempt).not.toBeNull();
		// Not committed: index 0 is still usable.
		const k0 = await store.prepare('alice', 1, chain.id, 0);
		const sent = await sendKey(chain);
		expect(await open(k0!.key, await seal(sent.key, 'zero'))).toBe('zero');
	});

	test('a jump beyond the skip bound needs a fresh grant', async () => {
		const chain = startChain(1);
		const store = new ChainStore();
		store.accept('alice', 1, chain.id, 0, chain.key.slice());
		expect(await store.prepare('alice', 1, chain.id, MAX_SKIP + 1)).toBeNull();
	});

	test('an unknown chain asks for a grant; a grant never rewinds a chain', async () => {
		const chain = startChain(2);
		const store = new ChainStore();
		expect(await store.prepare('alice', 2, chain.id, 0)).toBeNull();
		const early = chain.key.slice();
		store.accept('alice', 2, chain.id, 0, early);
		await sendKey(chain);
		const k = await store.prepare('alice', 2, chain.id, 0);
		k!.commit();
		// A replayed old grant for the same chain cannot move it back.
		store.accept('alice', 2, chain.id, 0, early);
		await expect(store.prepare('alice', 2, chain.id, 0)).rejects.toThrow();
	});

	test('chains of generations no longer held are dropped', async () => {
		const store = new ChainStore();
		const old = startChain(1);
		const cur = startChain(2);
		store.accept('alice', 1, old.id, 0, old.key.slice());
		store.accept('alice', 2, cur.id, 0, cur.key.slice());
		store.prune((g) => g >= 2);
		expect(await store.prepare('alice', 1, old.id, 0)).toBeNull();
		expect(await store.prepare('alice', 2, cur.id, 0)).not.toBeNull();
	});
});

describe('chain store limits', () => {
	test("one sender's many chains cannot push out another sender's", async () => {
		const store = new ChainStore();
		const honest = startChain(1);
		store.accept('sam', 1, honest.id, 0, honest.key.slice());
		for (let n = 0; n < 300; n++) {
			const junk = startChain(1);
			store.accept('mallory', 1, junk.id, 0, junk.key);
		}
		expect(await store.prepare('sam', 1, honest.id, 0)).not.toBeNull();
	});
});
