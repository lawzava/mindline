import { toast } from 'svelte-sonner';
import { recentRooms } from '$lib/stores/recent-rooms';

function inviteUrl(): string {
	const url = new URL(window.location.href);
	if (!url.hash) {
		const room = recentRooms
			.get()
			.find((entry) => `/${encodeURIComponent(entry.id)}` === url.pathname);
		if (room?.key) url.hash = room.key;
	}
	return url.href;
}

/**
 * Share the current room invite. The full URL carries the key fragment;
 * a bare path is a broken invite. Web Share first (mobile), then clipboard,
 * then the execCommand fallback.
 */
export async function shareInvite(): Promise<void> {
	const url = inviteUrl();

	if (navigator.share) {
		try {
			await navigator.share({
				title: 'Join my Mindline chat',
				text: 'Join my real-time chat room',
				url
			});
			return;
		} catch (error) {
			// Cancellation must not copy a bearer capability without consent.
			if (error instanceof Error && error.name === 'AbortError') return;
		}
	}
	await copyInvite(url);
}

export async function copyInvite(url = inviteUrl()): Promise<void> {
	try {
		await navigator.clipboard.writeText(url);
		toast.success('Invite link copied! Anyone with this link can read the room.');
		return;
	} catch {
		// Modern clipboard API failed - try legacy fallback
	}

	const textArea = document.createElement('textarea');
	const focused = document.activeElement;
	try {
		textArea.value = url;
		textArea.style.position = 'fixed';
		textArea.style.left = '-9999px';
		textArea.style.top = '-9999px';
		document.body.appendChild(textArea);
		textArea.focus();
		textArea.select();
		const success = document.execCommand('copy');
		if (success) {
			toast.success('Invite link copied! Anyone with this link can read the room.');
		} else {
			toast.error('Failed to copy link');
		}
	} catch {
		toast.error('Failed to copy link');
	} finally {
		textArea.parentNode?.removeChild(textArea);
		if (focused instanceof HTMLElement) focused.focus({ preventScroll: true });
	}
}
