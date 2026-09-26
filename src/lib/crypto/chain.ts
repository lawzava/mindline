/**
 * Sender-key chains (PROTOCOL.md §1.5): per-message keys within a key
 * generation. Each sender tab draws a random chain key per generation and
 * grants it to each member (X-Wing wrapped, direct paths only). Message i is
 * sealed under HKDF(ck_i, "msg"); then ck_{i+1} = HKDF(ck_i, "next") and
 * ck_i is overwritten. A device read later holds only the chain positions
 * still ahead, so it cannot open messages already sent.
 *
 * Chain state lives in memory only. A reload starts a new chain, and peers
 * send fresh grants on the next connection.
 */

import { toB64url } from './b64';
import { lp } from './lp';

/** Messages a receiver may skip in one step (lost or sent to other peers). */
export const MAX_SKIP = 2000;
/** Chains a receiver holds at once, and per sender (one member cannot crowd out another). */
const MAX_CHAINS = 256;
const MAX_CHAINS_PER_SENDER = 4;

export interface Chain {
	/** Random per chain: which chain an envelope's index belongs to. */
	id: string;
	/** The key generation this chain belongs to (§1.4). */
	g: number;
	/** The index the next message will use. */
	index: number;
	/** ck_index, 32 bytes. Overwritten with zeros once used. */
	key: Uint8Array;
}

async function hkdf(key: Uint8Array, info: string): Promise<Uint8Array> {
	const material = await crypto.subtle.importKey('raw', key as BufferSource, 'HKDF', false, [
		'deriveBits'
	]);
	const bits = await crypto.subtle.deriveBits(
		{ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: lp(info) },
		material,
		256
	);
	return new Uint8Array(bits);
}

async function messageKey(ck: Uint8Array): Promise<CryptoKey> {
	const raw = await hkdf(ck, 'mindline/v1/chain-msg');
	try {
		return await crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, [
			'encrypt',
			'decrypt'
		]);
	} finally {
		raw.fill(0);
	}
}

const nextKey = (ck: Uint8Array) => hkdf(ck, 'mindline/v1/chain-next');

export function startChain(g: number): Chain {
	return {
		id: toB64url(crypto.getRandomValues(new Uint8Array(12))),
		g,
		index: 0,
		key: crypto.getRandomValues(new Uint8Array(32))
	};
}

/** The key for the chain's next message; the chain moves on and forgets it. */
export async function sendKey(chain: Chain): Promise<{ index: number; key: CryptoKey }> {
	const index = chain.index;
	const key = await messageKey(chain.key);
	const next = await nextKey(chain.key);
	chain.key.fill(0);
	chain.key = next;
	chain.index = index + 1;
	return { index, key };
}

/** A prepared receive key; `commit` advances the chain past it. */
export interface Prepared {
	key: CryptoKey;
	commit(): void;
}

/** The chains this device has been granted, per sender, generation, and id. */
export class ChainStore {
	private chains = new Map<string, Chain>();

	private static slot(sender: string, g: number, id: string): string {
		return `${sender}|${g}|${id}`;
	}

	/**
	 * Take a granted position. A grant for a chain already held only moves it
	 * forward: an old grant replayed cannot reopen used keys.
	 */
	accept(sender: string, g: number, id: string, index: number, key: Uint8Array): void {
		const slot = ChainStore.slot(sender, g, id);
		const held = this.chains.get(slot);
		if (held && held.index >= index) {
			key.fill(0);
			return;
		}
		if (held) {
			held.key.fill(0);
		} else {
			const own = [...this.chains.keys()].filter((s) => s.startsWith(`${sender}|`));
			if (own.length >= MAX_CHAINS_PER_SENDER) this.drop(own[0]);
			else if (this.chains.size >= MAX_CHAINS) this.drop(this.chains.keys().next().value!);
		}
		this.chains.set(slot, { id, g, index, key });
	}

	private drop(slot: string): void {
		this.chains.get(slot)?.key.fill(0);
		this.chains.delete(slot);
	}

	/**
	 * The key for message `index`, or null when this chain was never granted
	 * or the index is too far ahead to derive (either way: ask the sender for
	 * a fresh grant). Throws for an index already used. Nothing changes until `commit`, so a message that fails to
	 * decrypt cannot move the chain.
	 */
	async prepare(sender: string, g: number, id: string, index: number): Promise<Prepared | null> {
		const chain = this.chains.get(ChainStore.slot(sender, g, id));
		if (!chain) return null;
		if (!Number.isSafeInteger(index) || index < chain.index) {
			throw new Error('chain index already used');
		}
		if (index - chain.index > MAX_SKIP) return null;
		let ck: Uint8Array = chain.key.slice();
		for (let i = chain.index; i < index; i++) {
			const next = await nextKey(ck);
			ck.fill(0);
			ck = next;
		}
		const key = await messageKey(ck);
		const after = await nextKey(ck);
		ck.fill(0);
		return {
			key,
			commit: () => {
				// Committed only if the chain has not moved meanwhile.
				if (chain.index > index) {
					after.fill(0);
					return;
				}
				chain.key.fill(0);
				chain.key = after;
				chain.index = index + 1;
			}
		};
	}

	/** Drop chains of generations this device no longer holds keys for. */
	prune(keep: (g: number) => boolean): void {
		for (const [slot, chain] of this.chains) {
			if (keep(chain.g)) continue;
			chain.key.fill(0);
			this.chains.delete(slot);
		}
	}
}
