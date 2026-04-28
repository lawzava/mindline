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
				wasm.setMessageManagerUser($user.id);
			} catch (e) {
				console.error('Failed to initialize user:', e);
			}
		}

		isInitializing = false;
	});
</script>

<div class="flex h-screen flex-col overflow-hidden bg-background text-foreground">
	<Header />

	<main class="flex flex-1 flex-col overflow-hidden">
		{#if isInitializing}
			<div class="flex flex-1 items-center justify-center p-6">
				<div class="flex w-full max-w-sm flex-col items-center gap-4 rounded-3xl border border-border/80 bg-card/90 p-8 text-center shadow-lg shadow-black/5">
					<Loader2 class="h-8 w-8 animate-spin text-muted-foreground motion-reduce:animate-none" />
					<div class="space-y-1">
						<p class="text-lg font-semibold text-foreground">Opening Mindline</p>
						<p class="text-sm text-muted-foreground">Loading the local encryption runtime.</p>
					</div>
				</div>
			</div>
		{:else if $wasmError}
			<div class="flex flex-1 items-center justify-center p-6">
				<div class="flex w-full max-w-sm flex-col items-center gap-4 rounded-3xl border border-destructive/30 bg-destructive/10 p-8 text-center shadow-lg shadow-destructive/10">
					<p class="text-lg font-semibold text-destructive">Mindline could not start</p>
					<p class="text-sm text-muted-foreground">{$wasmError.message}</p>
					<button
						onclick={() => window.location.reload()}
						class="text-sm font-medium text-destructive underline underline-offset-4 hover:text-foreground"
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
