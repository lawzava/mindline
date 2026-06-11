<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Sun, Moon } from 'lucide-svelte';
	import { toggleMode, mode } from 'mode-watcher';
</script>

<header class="border-b border-border bg-background">
	<div class="mx-auto flex h-12 max-w-4xl items-center justify-between px-4">
		<span class="text-sm font-semibold tracking-tight">Mindline</span>

		<Button variant="ghost" size="icon" onclick={toggleMode} class="h-10 w-10 text-muted-foreground">
			{#if mode.current === 'dark'}
				<Sun class="h-4 w-4" />
			{:else}
				<Moon class="h-4 w-4" />
			{/if}
			<span class="sr-only">Toggle theme</span>
		</Button>
	</div>
</header>
