<script lang="ts">
	import { draftsList } from '$lib/stores';
	import TypingIndicator from './TypingIndicator.svelte';
	import { fade } from 'svelte/transition';
	import { cn } from '$lib/utils';
</script>

{#if $draftsList.length > 0}
	<div
		class="flex flex-col gap-2 border-t border-border bg-muted/30 px-4 py-3"
		transition:fade={{ duration: 150 }}
	>
		{#each $draftsList as draft (draft.peerId)}
			<div
				class={cn(
					'flex items-start gap-2 transition-opacity duration-500',
					draft.isFading && 'opacity-30'
				)}
				transition:fade={{ duration: 150 }}
			>
				<!-- Sender name -->
				<span class="shrink-0 text-xs font-medium text-muted-foreground">
					{draft.senderName}
				</span>

				<!-- Draft content or typing indicator -->
				<div class="flex-1 text-sm text-muted-foreground">
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
