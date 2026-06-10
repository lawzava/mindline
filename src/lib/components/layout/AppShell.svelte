<script lang="ts">
	import Header from './Header.svelte';
	import { Toaster } from '$lib/components/ui/sonner';

	interface Props {
		children: import('svelte').Snippet;
	}

	let { children }: Props = $props();
</script>

<div class="flex h-screen flex-col overflow-hidden bg-background">
	<Header />

	<main class="flex flex-1 flex-col overflow-hidden">
		{@render children()}
	</main>

	<Toaster />
</div>
