import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { allocateEpoch, burnRoom } from '$lib/crypto/keystore';

beforeEach(() => {
	indexedDB = new IDBFactory();
});

afterEach(() => {
	vi.restoreAllMocks();
});

// Control Date.now without faking timers — fake-indexeddb needs real
// timers to resolve its transactions.
function setClock(iso: string): void {
	vi.spyOn(Date, 'now').mockReturnValue(new Date(iso).getTime());
}

describe('monotonic device epoch high-water (PROTOCOL.md §2)', () => {
	it('allocations are strictly increasing', async () => {
		const a = await allocateEpoch('dev-1');
		const b = await allocateEpoch('dev-1');
		const c = await allocateEpoch('dev-1');
		expect(b).toBeGreaterThan(a);
		expect(c).toBeGreaterThan(b);
	});

	it('never regresses across many allocations', async () => {
		let prev = await allocateEpoch('dev-1');
		for (let i = 0; i < 50; i++) {
			const next = await allocateEpoch('dev-1');
			expect(next).toBeGreaterThan(prev);
			prev = next;
		}
	});

	it('does not regress after a backward clock correction (heals self-censorship)', async () => {
		setClock('2099-01-01T00:00:00Z');
		const future = await allocateEpoch('dev-1');
		// Clock corrected far backwards; the high-water must still advance.
		setClock('2026-06-11T00:00:00Z');
		const afterCorrection = await allocateEpoch('dev-1');
		expect(afterCorrection).toBeGreaterThan(future);
	});

	it('survives a room burn — the high-water is device-scoped, not room-scoped', async () => {
		setClock('2099-01-01T00:00:00Z');
		const future = await allocateEpoch('dev-1');
		await burnRoom('room-1');
		// After burn the clock is "corrected"; without survival this would
		// reseed from the (lower) clock and regress.
		setClock('2026-06-11T00:00:00Z');
		const afterBurn = await allocateEpoch('dev-1');
		expect(afterBurn).toBeGreaterThan(future);
	});

	it('separate devices keep independent high-waters', async () => {
		const a1 = await allocateEpoch('dev-a');
		await allocateEpoch('dev-b');
		const a2 = await allocateEpoch('dev-a');
		expect(a2).toBeGreaterThan(a1);
	});
});
