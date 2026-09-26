/**
 * Burn tombstones: this device remembers which rooms it burned, so pressing
 * Back into an old invite URL does not silently re-create the room the
 * person just erased. Only a SHA-256 of the room id is kept, never the id
 * or key, and the list is bounded.
 */

const STORAGE_KEY = 'mindline_burned';
const MAX_ENTRIES = 200;

async function digest(roomId: string): Promise<string> {
	const bytes = new Uint8Array(
		await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`mindline/burned/${roomId}`))
	);
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function read(): string[] {
	try {
		const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
		return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
	} catch {
		return [];
	}
}

function write(list: string[]): void {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(-MAX_ENTRIES)));
	} catch {
		/* storage blocked: the tombstone is a courtesy, not a security boundary */
	}
}

export async function markBurned(roomId: string): Promise<void> {
	const h = await digest(roomId);
	write([...read().filter((x) => x !== h), h]);
}

export async function isBurned(roomId: string): Promise<boolean> {
	return read().includes(await digest(roomId));
}

export async function clearBurned(roomId: string): Promise<void> {
	const h = await digest(roomId);
	write(read().filter((x) => x !== h));
}
