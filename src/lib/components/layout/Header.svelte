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

		const url = `${window.location.origin}/${roomId}`;

		// Try Web Share API first (mobile-friendly)
		if (navigator.share) {
			try {
				await navigator.share({
					title: 'Join my Mindline chat',
					text: 'Join my Mindline room. Anyone with this link can join.',
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
			toast.success('Invite link copied. Anyone with this link can join the room.');
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
				toast.success('Invite link copied. Anyone with this link can join the room.');
			} else {
				toast.error('Failed to copy link');
			}
		} catch {
			toast.error('Failed to copy link');
		}
	}
</script>

<header class="z-10 border-b border-border/80 bg-background/92">
	<div class="mx-auto flex h-16 min-w-0 max-w-6xl items-center justify-between gap-2 px-4 sm:px-6">
		<!-- Logo -->
		{#if $currentRoomId}
			<div class="flex min-w-0 items-center gap-2 rounded-full sm:gap-3" aria-label="Mindline">
				<span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border/80 bg-card text-sm font-semibold shadow-sm">
					M
				</span>
				<span class="hidden min-w-0 flex-col leading-none sm:flex">
					<span class="truncate text-base font-semibold tracking-tight">Mindline</span>
					<span class="mt-1 hidden truncate text-xs text-muted-foreground md:block">Live drafts. Private rooms.</span>
				</span>
			</div>
		{:else}
			<a href="/" class="flex min-w-0 items-center gap-2 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:gap-3">
				<span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border/80 bg-card text-sm font-semibold shadow-sm">
					M
				</span>
				<span class="hidden min-w-0 flex-col leading-none sm:flex">
					<span class="truncate text-base font-semibold tracking-tight">Mindline</span>
					<span class="mt-1 hidden truncate text-xs text-muted-foreground md:block">Live drafts. Private rooms.</span>
				</span>
			</a>
		{/if}

		<!-- Controls -->
		<div class="flex shrink-0 items-center gap-2 sm:gap-3">
			<!-- Username input -->
			<Input
				type="text"
				placeholder="Your name"
				aria-label="Your display name"
				bind:value={userName}
				onblur={handleNameChange}
				onkeydown={(e) => e.key === 'Enter' && handleNameChange()}
				class="w-24 sm:w-36"
			/>

			<!-- Share button (only when in a room) -->
			{#if $currentRoomId}
				<Button
					variant="outline"
					size="icon"
					onclick={shareRoom}
					class="h-11 w-11 shrink-0"
					data-testid="share-room-btn"
				>
					<Share2 class="h-4 w-4" />
					<span class="sr-only">Share room. Anyone with the link can join.</span>
				</Button>
			{/if}

			<!-- Theme toggle -->
			<Button variant="ghost" size="icon" onclick={toggleMode} class="h-11 w-11 shrink-0">
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
