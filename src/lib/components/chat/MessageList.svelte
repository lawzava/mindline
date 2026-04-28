<script lang="ts">
	import MessageBubble from './MessageBubble.svelte';
	import { userId } from '$lib/stores';
	import type { Message } from '$lib/wasm/types';

	interface Props {
		messages: Message[];
		onEdit?: (messageId: string, newContent: string) => void;
		onDelete?: (messageId: string) => void;
		onReaction?: (messageId: string, emoji: string) => void;
	}

	let { messages, onEdit, onDelete, onReaction }: Props = $props();
	let scrollRef = $state<HTMLDivElement | null>(null);

	// Auto-scroll to bottom when new messages arrive
	$effect(() => {
		if (messages.length && scrollRef) {
			// Use a small delay to ensure the DOM has updated
			requestAnimationFrame(() => {
				scrollRef?.scrollTo({
					top: scrollRef.scrollHeight,
					behavior: 'smooth'
				});
			});
		}
	});
</script>

<div class="min-h-0 flex-1 overflow-hidden" data-testid="message-list">
	<div
		bind:this={scrollRef}
		class="h-full overflow-y-auto px-3 py-4 sm:px-5 sm:py-5"
	>
		{#if messages.length === 0}
			<div class="flex h-full items-center justify-center">
				<div class="max-w-sm rounded-3xl border border-live/20 bg-surface-warm px-6 py-5 text-center shadow-sm shadow-live/10">
					<p class="text-base font-bold text-foreground">This room is quiet.</p>
					<p class="mt-2 text-sm leading-6 text-muted-foreground">
						Type when you are ready. Your draft is visible to connected peers before you send.
					</p>
				</div>
			</div>
		{:else}
			<div class="flex flex-col gap-4">
				{#each messages as message (message.id)}
					<MessageBubble
						{message}
						isMe={message.sender_id === $userId}
						{onEdit}
						{onDelete}
						{onReaction}
					/>
				{/each}
			</div>
		{/if}
	</div>
</div>
