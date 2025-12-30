<script lang="ts">
	import Header from './Header.svelte';
	import { Toaster } from '$lib/components/ui/sonner';
	import { loadWasm, wasmLoaded, wasmError } from '$lib/wasm';
	import { user } from '$lib/stores';
	import { onMount } from 'svelte';
	import { Loader2 } from 'lucide-svelte';

	interface Props {
		children: import('svelte').Snippet;
	}

	let { children }: Props = $props();
	let isInitializing = $state(true);

	onMount(async () => {
		// Theme is now handled by ModeWatcher in +layout.svelte

		// Load WASM module
		await loadWasm();

		// Initialize user if we have stored credentials
		if ($wasmLoaded && $user.initialized) {
			// Re-initialize with stored user data
			try {
				const { wasm } = await import('$lib/wasm');
				wasm.initialize($user.name, $user.id);
			} catch (e) {
				console.error('Failed to initialize user:', e);
			}
		}

		isInitializing = false;
	});
</script>

<div class="flex h-screen flex-col overflow-hidden bg-background">
	<Header />

	<main class="flex flex-1 flex-col overflow-hidden">
		{#if isInitializing}
			<div class="flex flex-1 items-center justify-center">
				<div class="flex flex-col items-center gap-4 text-muted-foreground">
					<Loader2 class="h-8 w-8 animate-spin" />
					<p class="text-sm">Loading...</p>
				</div>
			</div>
		{:else if $wasmError}
			<div class="flex flex-1 items-center justify-center">
				<div class="flex flex-col items-center gap-4 text-destructive">
					<p class="text-lg font-medium">Failed to load application</p>
					<p class="text-sm text-muted-foreground">{$wasmError.message}</p>
					<button
						onclick={() => window.location.reload()}
						class="text-sm underline underline-offset-4 hover:text-foreground"
					>
						Try again
					</button>
				</div>
			</div>
		{:else}
			{@render children()}
		{/if}
	</main>

	<Toaster />
</div>
