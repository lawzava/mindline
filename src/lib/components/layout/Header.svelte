<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Sun, Moon } from 'lucide-svelte';
	import { toggleMode, mode } from 'mode-watcher';
</script>

<header class="elevate-bar border-b border-border bg-background">
	<div class="mx-auto flex h-14 max-w-4xl items-center justify-between px-4">
		<a
			href="/"
			class="flex items-center gap-2 rounded-md outline-ring/50"
			aria-label="Mindline home"
		>
			<!-- The wire: the brand mark is the one cobalt dot. -->
			<span class="h-2.5 w-2.5 rounded-full bg-primary"></span>
			<span class="text-base font-semibold tracking-tight">Mindline</span>
		</a>

		<Button
			variant="ghost"
			size="icon"
			onclick={toggleMode}
			class="h-10 w-10 text-muted-foreground"
		>
			{#if mode.current === 'dark'}
				<Sun class="h-4 w-4" />
			{:else}
				<Moon class="h-4 w-4" />
			{/if}
			<span class="sr-only">Toggle theme</span>
		</Button>
	</div>
</header>
