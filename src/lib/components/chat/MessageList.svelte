<script lang="ts">
	import MessageBubble from './MessageBubble.svelte';
	import LiveDraft from './LiveDraft.svelte';
	import { userId, draftsList } from '$lib/stores';
	import type { Message } from '$lib/types/message';

	interface Props {
		messages: Message[];
		onEdit?: (messageId: string, newContent: string) => void;
		onDelete?: (messageId: string) => void;
		onReaction?: (messageId: string, emoji: string) => void;
	}

	let { messages, onEdit, onDelete, onReaction }: Props = $props();
	let scrollRef = $state<HTMLDivElement | null>(null);
	let atBottom = $state(true);

	function handleScroll() {
		const el = scrollRef;
		if (!el) return;
		atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
	}

	// Follow the stream only when the reader is already at the bottom
	// (audit fix: no more force-scroll while reading history). Drafts
	// growing also keep the view pinned.
	$effect(() => {
		void messages.length;
		void $draftsList;
		if (scrollRef && atBottom) {
			requestAnimationFrame(() => {
				scrollRef?.scrollTo({ top: scrollRef.scrollHeight, behavior: 'smooth' });
			});
		}
	});
</script>

<div class="min-h-0 flex-1 overflow-hidden" data-testid="message-list">
	<div
		bind:this={scrollRef}
		onscroll={handleScroll}
		class="mx-auto h-full max-w-2xl overflow-y-auto px-4 py-4 sm:px-6"
		aria-live="polite"
		aria-label="Messages"
	>
		{#if messages.length === 0 && $draftsList.length === 0}
			<div class="flex h-full items-center justify-center">
				<p class="text-center text-sm text-muted-foreground">
					No messages yet. Start the conversation!
				</p>
			</div>
		{:else}
			<div class="flex flex-col">
				{#each messages as message, i (message.id)}
					<MessageBubble
						{message}
						isMe={message.sender_id === $userId}
						grouped={i > 0 && messages[i - 1].sender_id === message.sender_id}
						{onEdit}
						{onDelete}
						{onReaction}
					/>
				{/each}
				<!-- Live drafts land where the sent message will appear -->
				<LiveDraft />
			</div>
		{/if}
	</div>
</div>
