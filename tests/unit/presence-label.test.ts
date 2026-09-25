import { describe, expect, test } from 'vitest';
import { peopleLabel } from '$lib/presence';

describe('peopleLabel', () => {
	test('names one, two, and a few people, then summarizes the rest', () => {
		expect(peopleLabel([])).toBe('just you');
		expect(peopleLabel(['Bob'])).toBe('Bob');
		expect(peopleLabel(['Bob', 'Carol'])).toBe('Bob and Carol');
		expect(peopleLabel(['Bob', 'Carol', 'Dan'])).toBe('Bob, Carol, and Dan');
		expect(peopleLabel(['Bob', 'Carol', 'Dan', 'Eve', 'Fay'])).toBe('Bob, Carol, and 3 others');
	});

	test('people who have not announced a name yet are counted, not invented', () => {
		expect(peopleLabel([undefined])).toBe('1 person');
		expect(peopleLabel(['Bob', undefined])).toBe('Bob and 1 other');
	});
});
