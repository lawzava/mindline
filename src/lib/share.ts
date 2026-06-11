import { toast } from 'svelte-sonner';

/**
 * Share the current room invite. The full URL carries the key fragment;
 * a bare path is a broken invite. Web Share first (mobile), then clipboard,
 * then the execCommand fallback.
 */
export async function shareInvite(): Promise<void> {
	const url = window.location.href;

	if (navigator.share) {
		try {
			await navigator.share({
				title: 'Join my Mindline chat',
				text: 'Join my real-time chat room',
				url
			});
			return;
		} catch {
			// User cancelled or share failed - fall through to clipboard
		}
	}

	try {
		await navigator.clipboard.writeText(url);
		toast.success('Invite link copied! Anyone with this link can read the room.');
		return;
	} catch {
		// Modern clipboard API failed - try legacy fallback
	}

	try {
		const textArea = document.createElement('textarea');
		textArea.value = url;
		textArea.style.position = 'fixed';
		textArea.style.left = '-9999px';
		textArea.style.top = '-9999px';
		document.body.appendChild(textArea);
		textArea.focus();
		textArea.select();
		const success = document.execCommand('copy');
		document.body.removeChild(textArea);
		if (success) {
			toast.success('Invite link copied! Anyone with this link can read the room.');
		} else {
			toast.error('Failed to copy link');
		}
	} catch {
		toast.error('Failed to copy link');
	}
}
