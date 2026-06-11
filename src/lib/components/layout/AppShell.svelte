<script lang="ts">
	import { page } from '$app/state';
	import Header from './Header.svelte';
	import { Toaster } from '$lib/components/ui/sonner';

	interface Props {
		children: import('svelte').Snippet;
	}

	let { children }: Props = $props();

	// Rooms render their own single header row; one header, never two.
	const inRoom = $derived(page.route.id === '/[roomId]');
</script>

<div class="flex h-dvh flex-col overflow-hidden bg-background">
	{#if !inRoom}
		<Header />
	{/if}

	<main class="flex flex-1 flex-col overflow-hidden">
		{@render children()}
	</main>

	<Toaster />
</div>
