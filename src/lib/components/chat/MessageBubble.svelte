<script lang="ts">
	import { cn } from '$lib/utils';
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
	import type { Message } from '$lib/wasm/types';
	import ReactionPills from './ReactionPills.svelte';
	import EmojiPicker from './EmojiPicker.svelte';
	import MessageActions from './MessageActions.svelte';
	import { Check, X } from 'lucide-svelte';

	interface Props {
		message: Message;
		isMe: boolean;
		onEdit?: (messageId: string, newContent: string) => void;
		onDelete?: (messageId: string) => void;
		onReaction?: (messageId: string, emoji: string) => void;
	}

	let { message, isMe, onEdit, onDelete, onReaction }: Props = $props();

	let isEditing = $state(false);
	let editContent = $state('');

	function formatTime(timestamp: number): string {
		const date = new Date(timestamp);
		return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
	}

	function startEdit() {
		editContent = message.content;
		isEditing = true;
	}

	function cancelEdit() {
		isEditing = false;
		editContent = message.content;
	}

	function saveEdit() {
		const trimmed = editContent.trim();
		if (trimmed && trimmed !== message.content) {
			onEdit?.(message.id, trimmed);
		}
		isEditing = false;
	}

	function handleDelete() {
		onDelete?.(message.id);
	}

	function handleReaction(emoji: string) {
		onReaction?.(message.id, emoji);
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			saveEdit();
		} else if (e.key === 'Escape') {
			cancelEdit();
		}
	}

	// Check if message is deleted
	const isDeleted = $derived(message.message_type === 'Deleted' || message.content === '[Message deleted]');
</script>

<div
	class={cn(
		'group flex flex-col gap-1',
		isMe ? 'items-end' : 'items-start'
	)}
>
	<!-- Sender name (only for others) -->
	{#if !isMe}
		<span class="px-3 text-xs font-medium text-muted-foreground">
			{message.sender_name}
		</span>
	{/if}

	<!-- Message bubble with actions -->
	<div class={cn('flex items-center gap-1', isMe ? 'flex-row-reverse' : 'flex-row')}>
		<!-- Message content -->
		<div
			class={cn(
				'max-w-[80%] rounded-2xl px-4 py-2.5 text-sm',
				isMe
					? 'bg-primary text-primary-foreground'
					: 'bg-muted text-foreground',
				isDeleted && 'italic text-muted-foreground'
			)}
		>
			{#if isEditing}
				<div class="flex items-center gap-2">
					<Input
						type="text"
						bind:value={editContent}
						onkeydown={handleKeydown}
						class="h-7 min-w-[200px] text-sm bg-background text-foreground"
						autofocus
					/>
					<Button variant="ghost" size="icon" onclick={saveEdit} class="h-7 w-7">
						<Check class="h-4 w-4" />
					</Button>
					<Button variant="ghost" size="icon" onclick={cancelEdit} class="h-7 w-7">
						<X class="h-4 w-4" />
					</Button>
				</div>
			{:else}
				<p class="whitespace-pre-wrap break-words">{message.content}</p>
			{/if}
		</div>

		<!-- Actions (only for own non-deleted messages) -->
		{#if isMe && !isDeleted && !isEditing}
			<MessageActions onEdit={startEdit} onDelete={handleDelete} />
		{/if}

		<!-- Emoji picker (for non-deleted messages) -->
		{#if !isDeleted && !isEditing}
			<EmojiPicker onSelectEmoji={handleReaction} />
		{/if}
	</div>

	<!-- Reactions -->
	{#if !isDeleted && message.reactions && Object.keys(message.reactions).length > 0}
		<div class="px-3">
			<ReactionPills
				reactions={message.reactions}
				onToggleReaction={handleReaction}
				{isMe}
			/>
		</div>
	{/if}

	<!-- Timestamp -->
	<span
		class={cn(
			'px-3 text-[10px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100',
			isMe ? 'text-right' : 'text-left'
		)}
	>
		{formatTime(message.timestamp)}
		{#if message.edited}
			<span class="ml-1 italic">(edited)</span>
		{/if}
		{#if message.status === 'Failed'}
			<span class="ml-1 text-destructive">(failed)</span>
		{/if}
	</span>
</div>
