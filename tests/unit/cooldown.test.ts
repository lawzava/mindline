import { describe, expect, it } from 'vitest';

import { CooldownGate } from '$lib/p2p/cooldown';

describe('CooldownGate (§1.4 rekey rate limits)', () => {
	function gate(intervalMs = 5000) {
		let t = 1_000_000;
		const g = new CooldownGate(intervalMs, () => t);
		return { g, advance: (ms: number) => (t += ms) };
	}

	it('allows the first call, blocks within the window, allows after it', () => {
		const { g, advance } = gate();
		expect(g.allow('dev-a')).toBe(true);
		expect(g.allow('dev-a')).toBe(false);
		advance(4999);
		expect(g.allow('dev-a')).toBe(false);
		advance(1);
		expect(g.allow('dev-a')).toBe(true);
	});

	it("keys are independent — one device cannot consume another's budget", () => {
		const { g } = gate();
		expect(g.allow('dev-a')).toBe(true);
		expect(g.allow('dev-b')).toBe(true);
		expect(g.allow('dev-a')).toBe(false);
	});

	it('a blocked call does not extend the window (no sliding-window starvation)', () => {
		const { g, advance } = gate();
		expect(g.allow('dev-a')).toBe(true);
		advance(4000);
		expect(g.allow('dev-a')).toBe(false);
		advance(1000);
		expect(g.allow('dev-a')).toBe(true);
	});

	it('forget() releases exactly one key; clear() releases all', () => {
		const { g } = gate();
		g.allow('dev-a');
		g.allow('dev-b');
		g.forget('dev-a');
		expect(g.size).toBe(1);
		expect(g.allow('dev-a')).toBe(true);
		g.clear();
		expect(g.size).toBe(0);
		expect(g.allow('dev-b')).toBe(true);
	});
});
