<script lang="ts">
	import { draftsList } from '$lib/stores';
	import TypingIndicator from './TypingIndicator.svelte';
	import { fade } from 'svelte/transition';
	import { cn } from '$lib/utils';
</script>

{#if $draftsList.length > 0}
	<div
		class="flex shrink-0 flex-col gap-2 border-t border-live/20 bg-live/8 px-3 py-3 sm:px-5"
		transition:fade={{ duration: 150 }}
		data-testid="draft-indicator"
	>
		{#each $draftsList as draft (draft.peerId)}
			<div
				class={cn(
					'rounded-2xl border border-live/20 bg-card px-4 py-3 shadow-sm shadow-live/10 transition-opacity duration-500',
					draft.isFading && 'opacity-30'
				)}
				transition:fade={{ duration: 150 }}
			>
				<div class="mb-1.5 flex flex-wrap items-center gap-2">
					<span class="text-xs font-bold text-foreground">
						{draft.senderName}
					</span>
					<span class="rounded-full bg-live/12 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-live">
						Live draft
					</span>
				</div>

				<!-- Draft content or typing indicator -->
				<div class="text-sm leading-6 text-muted-foreground">
					{#if draft.content.trim()}
						<span class="italic">{draft.content}</span>
					{:else}
						<TypingIndicator />
					{/if}
				</div>
			</div>
		{/each}
	</div>
{/if}
