<script lang="ts">
	import { onDestroy } from 'svelte';
	import { draftsList } from '$lib/stores';
	import { fade } from 'svelte/transition';
	import { cn } from '$lib/utils';

	// The reason this product exists, staged as a first-class entry in the
	// message stream: the peer's words form exactly in the slot (and the
	// geometry) of the bubble they will become. The dot is cobalt, not
	// green: green means "online" everywhere; cobalt means the wire is hot.
	//
	// The caret is load-aware: solid and still while characters arrive,
	// breathing (in phase with the presence dot) only in silence.

	let active = $state<Record<string, boolean>>({});
	const timers: Record<string, ReturnType<typeof setTimeout>> = {};
	const lastContent: Record<string, string> = {};

	$effect(() => {
		for (const draft of $draftsList) {
			if (lastContent[draft.peerId] !== draft.content) {
				lastContent[draft.peerId] = draft.content;
				active[draft.peerId] = true;
				clearTimeout(timers[draft.peerId]);
				timers[draft.peerId] = setTimeout(() => {
					active[draft.peerId] = false;
				}, 1000);
			}
		}
	});

	onDestroy(() => {
		for (const timer of Object.values(timers)) clearTimeout(timer);
	});
</script>

{#each $draftsList as draft (draft.peerId)}
	{@const breathing = !active[draft.peerId] && !draft.isFading}
	<div
		class={cn(
			'mt-4 flex max-w-[min(78%,36rem)] flex-col items-start gap-1 transition-opacity duration-500',
			draft.isFading && 'opacity-55'
		)}
		transition:fade={{ duration: 150 }}
		data-testid="draft-indicator"
		aria-live="polite"
	>
		<span class="ml-1 flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
			{draft.senderName}
			<span class={cn('h-1.5 w-1.5 rounded-full bg-draft', breathing && 'breathe')}></span>
		</span>
		<div class="rounded-[1.125rem] bg-wash-draft px-3.5 py-2.5">
			{#if draft.content.trim()}
				<p class="whitespace-pre-wrap break-words text-base leading-[1.45] text-draft">
					{draft.content.slice(0, -1)}{#key draft.content}<span class="ink-in"
							>{draft.content.slice(-1)}</span
						>{/key}<span
						class={cn(
							'ml-0.5 inline-block h-[1.15em] w-0.5 translate-y-[0.2em] rounded-full bg-draft',
							breathing && 'breathe'
						)}
					></span>
				</p>
			{:else}
				<span
					class={cn(
						'inline-block h-[1.15em] w-0.5 translate-y-[0.2em] rounded-full bg-draft',
						breathing && 'breathe'
					)}
				></span>
			{/if}
		</div>
	</div>
{/each}
