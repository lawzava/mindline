import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

// Type helper for element refs used by shadcn-svelte components
export type WithElementRef<T, E extends HTMLElement = HTMLElement> = T & {
	ref?: E | null;
};

// Type helpers for bits-ui/shadcn-svelte components
export type WithoutChild<T> = T extends { child?: unknown } ? Omit<T, 'child'> : T;
export type WithoutChildrenOrChild<T> = T extends { children?: unknown; child?: unknown }
	? Omit<T, 'children' | 'child'>
	: T extends { child?: unknown }
		? Omit<T, 'child'>
		: T;
