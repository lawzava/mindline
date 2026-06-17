import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

/**
 * A stable hue (0–360) for a sender, used to give each participant a subtle
 * shade in group chats (see the `.peer-shade` / `.peer-name` utilities). The
 * palette is curated to read well at the low chroma a "shade" implies and kept
 * clear of the brand cobalt (hue 262) so a peer's tint never looks like the
 * live wire or your own messages. A given id always maps to the same hue.
 */
const SENDER_HUES = [20, 55, 150, 190, 222, 300, 338] as const;

export function senderHue(id: string): number {
	let h = 0;
	for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) >>> 0;
	return SENDER_HUES[h % SENDER_HUES.length];
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
