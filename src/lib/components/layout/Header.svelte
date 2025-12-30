<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { user, connectionStatus, peerCount, currentRoomId } from '$lib/stores';
	import { Sun, Moon, Users, Share2, Wifi, WifiOff, Loader2 } from 'lucide-svelte';
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

		if (navigator.share) {
			try {
				await navigator.share({
					title: 'Join my Mindline chat',
					text: 'Join my real-time chat room',
					url
				});
			} catch {
				// User cancelled or error
			}
		} else {
			await navigator.clipboard.writeText(url);
			toast.success('Link copied to clipboard!');
		}
	}
</script>

<header class="border-b border-border bg-card">
	<div class="mx-auto flex h-14 sm:h-16 max-w-4xl items-center justify-between px-2 sm:px-4">
		<!-- Logo -->
		<div class="flex items-center gap-2 sm:gap-3">
			<h1 class="text-xl sm:text-2xl font-bold tracking-tight">MINDLINE</h1>
			{#if $currentRoomId}
				<div class="flex items-center gap-2 text-sm text-muted-foreground">
					{#if $connectionStatus === 'connected'}
						<Wifi class="h-4 w-4 text-green-500" />
					{:else if $connectionStatus === 'connecting'}
						<Loader2 class="h-4 w-4 text-yellow-500 animate-spin" />
					{:else}
						<WifiOff class="h-4 w-4 text-muted-foreground" />
					{/if}
					{#if $peerCount > 0}
						<span class="flex items-center gap-1">
							<Users class="h-3.5 w-3.5" />
							{$peerCount}
						</span>
					{/if}
				</div>
			{/if}
		</div>

		<!-- Controls -->
		<div class="flex items-center gap-2 sm:gap-3">
			<!-- Username input -->
			<Input
				type="text"
				placeholder="Your name"
				bind:value={userName}
				onblur={handleNameChange}
				onkeydown={(e) => e.key === 'Enter' && handleNameChange()}
				class="w-24 sm:w-32 text-sm"
			/>

			<!-- Share button (only when in a room) -->
			{#if $currentRoomId}
				<Button variant="outline" size="icon" onclick={shareRoom} class="h-9 w-9">
					<Share2 class="h-4 w-4" />
					<span class="sr-only">Share room</span>
				</Button>
			{/if}

			<!-- Theme toggle -->
			<Button variant="ghost" size="icon" onclick={toggleMode} class="h-9 w-9">
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
