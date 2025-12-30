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

<div class="flex-1 overflow-hidden">
	<div
		bind:this={scrollRef}
		class="h-full overflow-y-auto px-4 py-4 sm:px-6"
	>
		{#if messages.length === 0}
			<div class="flex h-full items-center justify-center">
				<p class="text-center text-sm text-muted-foreground">
					No messages yet. Start the conversation!
				</p>
			</div>
		{:else}
			<div class="flex flex-col gap-3">
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
