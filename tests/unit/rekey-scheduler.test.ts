import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RekeyScheduler } from '$lib/p2p/rekey-scheduler';

describe('RekeyScheduler (§1.4 trigger debounce/fallback)', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	function room(overrides: Partial<{ g: number; gid: string; should: boolean }> = {}) {
		const state = { g: overrides.g ?? 1, gid: overrides.gid ?? 'gid-1' };
		const minted: number[] = [];
		return {
			state,
			minted,
			deps: {
				generation: () => ({ ...state }),
				shouldMint: () => overrides.should ?? true,
				mint: () => {
					minted.push(state.g);
				}
			}
		};
	}

	it('coalesces a burst of triggers into one decision after the debounce', () => {
		const r = room();
		const s = new RekeyScheduler(2000, 6000);
		s.schedule(r.deps);
		vi.advanceTimersByTime(1000);
		s.schedule(r.deps);
		s.schedule(r.deps);
		vi.advanceTimersByTime(1999);
		expect(r.minted.length).toBe(0);
		vi.advanceTimersByTime(1);
		expect(r.minted.length).toBe(1);
	});

	it('skips the mint when the generation already moved past the baseline', () => {
		const r = room();
		const s = new RekeyScheduler(2000, 6000);
		s.schedule(r.deps);
		r.state.g = 2; // someone else ratcheted while we debounced
		vi.advanceTimersByTime(2000);
		expect(r.minted.length).toBe(0);
	});

	it('non-minter arms the fallback; fallback mints iff the generation never moved', () => {
		const r = room({ should: false });
		const s = new RekeyScheduler(2000, 6000);
		s.schedule(r.deps);
		vi.advanceTimersByTime(2000);
		expect(r.minted.length).toBe(0); // not the designated minter
		vi.advanceTimersByTime(5999);
		expect(r.minted.length).toBe(0);
		vi.advanceTimersByTime(1);
		expect(r.minted.length).toBe(1); // designated minter never showed → liveness mint
	});

	it('fallback stands down when the designated minter delivered', () => {
		const r = room({ should: false });
		const s = new RekeyScheduler(2000, 6000);
		s.schedule(r.deps);
		vi.advanceTimersByTime(2000);
		r.state.g = 2;
		vi.advanceTimersByTime(6000);
		expect(r.minted.length).toBe(0);
	});

	it('clear() cancels pending debounce and fallback (room-switch regression)', () => {
		const r = room();
		const s = new RekeyScheduler(2000, 6000);
		s.schedule(r.deps);
		s.clear();
		vi.advanceTimersByTime(10_000);
		expect(r.minted.length).toBe(0);
	});

	it('after clear(), a fresh schedule gets a fresh baseline and a fresh fallback slot', () => {
		// Regressions from the leaked-state bug: a stale `baseline ??=` from
		// room A suppressing room B's mint, and a stale pending fallback
		// blocking room B's fallback from ever arming.
		const roomA = room({ should: false, g: 5, gid: 'gid-a' });
		const roomB = room({ should: false, g: 1, gid: 'gid-b' });
		const s = new RekeyScheduler(2000, 6000);
		s.schedule(roomA.deps);
		vi.advanceTimersByTime(2000); // room A fallback armed
		s.clear(); // room switch
		s.schedule(roomB.deps);
		vi.advanceTimersByTime(2000); // room B decision (non-minter → fallback)
		vi.advanceTimersByTime(6000); // room B fallback must fire
		expect(roomA.minted.length).toBe(0);
		expect(roomB.minted.length).toBe(1);
	});
});
