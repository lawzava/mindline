<script lang="ts">
	import { cn } from '$lib/utils';
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import type { Message } from '$lib/types/message';
	import ReactionPills from './ReactionPills.svelte';
	import EmojiPicker from './EmojiPicker.svelte';
	import MessageActions from './MessageActions.svelte';
	import LongPressMenu from './LongPressMenu.svelte';
	import { longPress } from '$lib/hooks';
	import { Check, CheckCheck, X } from 'lucide-svelte';
	import { delivery } from '$lib/stores';
	import MediaAttachment from './MediaAttachment.svelte';

	interface Props {
		message: Message;
		isMe: boolean;
		/** Suppress the byline when the previous message has the same sender. */
		grouped?: boolean;
		onEdit?: (messageId: string, newContent: string) => void;
		onDelete?: (messageId: string) => void;
		onReaction?: (messageId: string, emoji: string) => void;
	}

	let { message, isMe, grouped = false, onEdit, onDelete, onReaction }: Props = $props();

	let isEditing = $state(false);
	let editContent = $state('');
	let showLongPressMenu = $state(false);

	// Detect if device supports touch
	const isTouchDevice = $derived(
		typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0)
	);

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

	function handleLongPress() {
		showLongPressMenu = true;
	}

	// Check if message is deleted
	const isDeleted = $derived(
		message.message_type === 'Deleted' || message.content === '[Message deleted]'
	);

	// Delivery status for own messages, reactive to the live store
	// (the previous get()-based read froze at mount; audit finding).
	const deliveryStatus = $derived.by(() => {
		if (!isMe) return null;
		const state = $delivery.get(message.id);
		if (!state) return null;
		return { delivered: state.deliveredTo.size, total: state.totalPeers };
	});

	const isFullyDelivered = $derived(
		deliveryStatus && deliveryStatus.delivered >= deliveryStatus.total && deliveryStatus.total > 0
	);

	const isPartiallyDelivered = $derived(
		deliveryStatus && deliveryStatus.delivered > 0 && deliveryStatus.delivered < deliveryStatus.total
	);
</script>

<div
	class={cn('group flex flex-col gap-0.5', isMe ? 'items-end' : 'items-start', grouped ? 'mt-0.5' : 'mt-3')}
	data-testid="message-bubble"
>
	<!-- Byline (others only, first message of a group) -->
	{#if !isMe && !grouped}
		<span class="max-w-[200px] truncate text-xs font-semibold text-muted-foreground">
			{message.sender_name}
		</span>
	{/if}

	<!-- Message block with actions. The width cap lives on this row (its
	     containing block is the full-width column) — a percentage max-width
	     on the bubble itself resolves against this shrink-to-fit row and
	     collapses to ~2ch on touch devices, where the row has no buttons. -->
	<div class={cn('flex max-w-[min(85%,42rem)] items-center gap-1', isMe ? 'flex-row-reverse' : 'flex-row')}>
		<!-- Message content: received is ink on paper, sent gets a faint wash -->
		<div
			use:longPress={{ duration: 400, onLongPress: handleLongPress }}
			class={cn(
				'min-w-0 break-words',
				isMe ? 'rounded-lg bg-wash-sent px-3 py-1.5' : 'py-0.5',
				isDeleted && 'italic text-muted-foreground'
			)}
		>
			{#if isEditing}
				<div class="flex items-center gap-2">
					<Input
						type="text"
						bind:value={editContent}
						onkeydown={handleKeydown}
						aria-label="Edit message content"
						class="h-7 min-w-[200px] bg-background text-sm text-foreground"
						autofocus
					/>
					<Button variant="ghost" size="icon" onclick={saveEdit} class="h-7 w-7" aria-label="Save edit">
						<Check class="h-4 w-4" />
					</Button>
					<Button variant="ghost" size="icon" onclick={cancelEdit} class="h-7 w-7" aria-label="Cancel edit">
						<X class="h-4 w-4" />
					</Button>
				</div>
			{:else if message.attachment}
				<MediaAttachment attachment={message.attachment} roomId={message.room_id} />
			{:else}
				<p class="prose-ink whitespace-pre-wrap break-words">{message.content}</p>
			{/if}
		</div>

		<!-- Desktop-only: Actions on hover (hidden on touch devices) -->
		{#if !isTouchDevice}
			{#if isMe && !isDeleted && !isEditing && !message.attachment}
				<MessageActions onEdit={startEdit} onDelete={handleDelete} />
			{/if}

			{#if !isDeleted && !isEditing}
				<EmojiPicker onSelectEmoji={handleReaction} />
			{/if}
		{/if}
	</div>

	<!-- Long press menu for mobile -->
	<LongPressMenu
		{isMe}
		{isDeleted}
		{isEditing}
		bind:open={showLongPressMenu}
		onOpenChange={(open) => (showLongPressMenu = open)}
		onEdit={startEdit}
		onDelete={handleDelete}
		onReaction={handleReaction}
	/>

	<!-- Reactions -->
	{#if !isDeleted && message.reactions && Object.keys(message.reactions).length > 0}
		<ReactionPills reactions={message.reactions} onToggleReaction={handleReaction} {isMe} />
	{/if}

	<!-- Timestamp and delivery status (always visible) -->
	<span
		class={cn(
			'flex items-center gap-1 text-xs tabular-nums text-muted-foreground',
			isMe ? 'justify-end' : 'justify-start'
		)}
	>
		{formatTime(message.timestamp)}
		{#if message.edited}
			<span class="italic">(edited)</span>
		{/if}
		{#if message.status === 'Failed'}
			<span class="text-destructive">(failed)</span>
		{:else if isMe && deliveryStatus}
			<Tooltip.Provider>
				<Tooltip.Root>
					<Tooltip.Trigger>
						<span class="inline-flex cursor-help items-center">
							{#if isFullyDelivered}
								<CheckCheck class="h-3 w-3 text-primary" />
							{:else if isPartiallyDelivered}
								<CheckCheck class="h-3 w-3 text-muted-foreground" />
							{:else}
								<Check class="h-3 w-3 text-muted-foreground" />
							{/if}
						</span>
					</Tooltip.Trigger>
					<Tooltip.Content>
						{#if deliveryStatus.total === 0}
							<p>Sent (no peers connected)</p>
						{:else}
							<p>
								Delivered to {deliveryStatus.delivered}/{deliveryStatus.total} peer{deliveryStatus.total !== 1 ? 's' : ''}
							</p>
						{/if}
					</Tooltip.Content>
				</Tooltip.Root>
			</Tooltip.Provider>
		{:else if isMe}
			<Check class="h-3 w-3 text-muted-foreground" />
		{/if}
	</span>
</div>
