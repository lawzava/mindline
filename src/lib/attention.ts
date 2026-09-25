/**
 * Background attention: what arrived while this tab was hidden. Presence
 * chat is only useful if you notice the other person came back, and there
 * is no push server, so the open tab itself has to say so.
 */

interface Countable {
	sender_id: string;
	sender_name: string;
	local_timestamp: number;
	message_type: string;
	synced?: boolean;
}

/**
 * Live peer messages received at or after `since`. Synced history is
 * excluded outright: its timestamps are whatever the serving peer claims.
 */
export function unseenSince(
	list: readonly Countable[],
	selfId: string,
	since: number
): { count: number; latestSender: string | null } {
	let count = 0;
	let latestSender: string | null = null;
	for (const m of list) {
		if (m.synced || m.sender_id === selfId || m.message_type === 'Deleted') continue;
		if (m.local_timestamp < since) continue;
		count++;
		latestSender = m.sender_name;
	}
	return { count, latestSender };
}

const NOTIFY_KEY = 'mindline_notify';

export function notificationsWanted(): boolean {
	return (
		typeof Notification !== 'undefined' &&
		Notification.permission === 'granted' &&
		localStorage.getItem(NOTIFY_KEY) === '1'
	);
}

/** Ask once, from a user gesture; returns whether notifications are on. */
export async function setNotificationsWanted(on: boolean): Promise<boolean> {
	if (!on || typeof Notification === 'undefined') {
		localStorage.removeItem(NOTIFY_KEY);
		return false;
	}
	const permission =
		Notification.permission === 'default'
			? await Notification.requestPermission()
			: Notification.permission;
	if (permission !== 'granted') {
		localStorage.removeItem(NOTIFY_KEY);
		return false;
	}
	localStorage.setItem(NOTIFY_KEY, '1');
	return true;
}

/**
 * The OS notification names the sender only. Message text would land in
 * the notification center and lock screen, outside the app's encryption.
 */
export function notifyArrival(roomId: string, roomLabel: string, sender: string): void {
	if (!notificationsWanted()) return;
	try {
		const n = new Notification(roomLabel, {
			body: `${sender} sent a message`,
			tag: `mindline:${roomId}`
		});
		n.onclick = () => {
			window.focus();
			n.close();
		};
	} catch {
		/* Some mobile browsers only allow service-worker notifications. */
	}
}
