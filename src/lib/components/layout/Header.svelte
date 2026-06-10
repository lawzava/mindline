<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { user, currentRoomId } from '$lib/stores';
	import { Sun, Moon, Share2 } from 'lucide-svelte';
	import { toast } from 'svelte-sonner';
	import { toggleMode, mode } from 'mode-watcher';

	let userName = $state($user.name);

	function handleNameChange() {
		const trimmed = userName.trim();
		if (trimmed) {
			user.setName(trimmed);
			toast.success('Name updated!');
		} else {
			// Restore previous name if empty
			userName = $user.name;
			toast.error('Name cannot be empty');
		}
	}

	async function shareRoom() {
		const roomId = $currentRoomId;
		if (!roomId) return;

		// The full URL carries the key fragment; a bare path is a broken invite.
		const url = window.location.href;

		// Try Web Share API first (mobile-friendly)
		if (navigator.share) {
			try {
				await navigator.share({
					title: 'Join my Mindline chat',
					text: 'Join my real-time chat room',
					url
				});
				return; // Success, exit early
			} catch {
				// User cancelled or share failed - fall through to clipboard
			}
		}

		// Try modern clipboard API (don't verify - readText often fails due to permissions)
		try {
			await navigator.clipboard.writeText(url);
			toast.success('Link copied to clipboard!');
			return;
		} catch {
			// Modern clipboard API failed - try legacy fallback
		}

		// Legacy fallback using execCommand
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
				toast.success('Link copied to clipboard!');
			} else {
				toast.error('Failed to copy link');
			}
		} catch {
			toast.error('Failed to copy link');
		}
	}
</script>

<header class="border-b border-border bg-background">
	<div class="mx-auto flex h-12 max-w-4xl items-center justify-between px-3 sm:px-4">
		<!-- Logo -->
		<div class="flex items-center gap-2 sm:gap-3">
			<h1 class="text-lg font-bold tracking-tight">MINDLINE</h1>
		</div>

		<!-- Controls -->
		<div class="flex items-center gap-2 sm:gap-3">
			<!-- Username input -->
			<Input
				type="text"
				placeholder="Your name"
				aria-label="Your display name"
				bind:value={userName}
				onblur={handleNameChange}
				onkeydown={(e) => e.key === 'Enter' && handleNameChange()}
				class="w-28 sm:w-36"
			/>

			<!-- Share button (only when in a room) -->
			{#if $currentRoomId}
				<Button variant="outline" size="icon" onclick={shareRoom} class="h-11 w-11">
					<Share2 class="h-4 w-4" />
					<span class="sr-only">Share room</span>
				</Button>
			{/if}

			<!-- Theme toggle -->
			<Button variant="ghost" size="icon" onclick={toggleMode} class="h-11 w-11">
				{#if mode.current === 'dark'}
					<Sun class="h-4 w-4" />
				{:else}
					<Moon class="h-4 w-4" />
				{/if}
				<span class="sr-only">Toggle theme</span>
			</Button>
		</div>
	</div>
</header>
