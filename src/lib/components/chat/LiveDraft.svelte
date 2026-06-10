<script lang="ts">
	import { draftsList } from '$lib/stores';
	import { fade } from 'svelte/transition';
	import { cn } from '$lib/utils';

	// The reason this product exists, staged as a first-class entry in the
	// message stream: the peer's words form in wet ink exactly where the
	// sent message will land, with a breathing presence dot. The block
	// never vanishes while their composer holds text; after a pause it
	// settles to 55% opacity (breath held, not gone).
</script>

{#each $draftsList as draft (draft.peerId)}
	<div
		class={cn(
			'mt-3 flex max-w-[min(80%,42rem)] flex-col gap-0.5 transition-opacity duration-500',
			draft.isFading && 'opacity-55'
		)}
		transition:fade={{ duration: 150 }}
		data-testid="draft-indicator"
		aria-live="polite"
	>
		<span class="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
			{draft.senderName}
			<span class={cn('h-1.5 w-1.5 rounded-full bg-success', !draft.isFading && 'breathe')}
			></span>
		</span>
		<div class="rounded-lg bg-wash-draft px-3 py-1.5">
			{#if draft.content.trim()}
				<p class="prose-ink whitespace-pre-wrap break-words italic text-draft">
					{draft.content.slice(0, -1)}{#key draft.content}<span class="ink-in"
							>{draft.content.slice(-1)}</span
						>{/key}<span class={cn('ml-0.5 inline-block h-[1.1em] w-px translate-y-[0.2em] bg-draft', !draft.isFading && 'breathe')}></span>
				</p>
			{:else}
				<span class="inline-block h-[1.1em] w-px translate-y-[0.2em] bg-draft breathe"></span>
			{/if}
		</div>
	</div>
{/each}
