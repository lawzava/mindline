<script lang="ts">
	import { cn } from '$lib/utils';
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import type { Message } from '$lib/wasm/types';
	import ReactionPills from './ReactionPills.svelte';
	import EmojiPicker from './EmojiPicker.svelte';
	import MessageActions from './MessageActions.svelte';
	import LongPressMenu from './LongPressMenu.svelte';
	import { longPress } from '$lib/hooks';
	import { Check, CheckCheck, X } from 'lucide-svelte';
	import { delivery } from '$lib/stores';

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
	const isDeleted = $derived(message.message_type === 'Deleted' || message.content === '[Message deleted]');

	// Delivery status for own messages
	const deliveryStatus = $derived.by(() => {
		if (!isMe) return null;
		return delivery.getDeliveryStatus(message.id);
	});

	const isFullyDelivered = $derived(
		deliveryStatus && deliveryStatus.delivered >= deliveryStatus.total && deliveryStatus.total > 0
	);

	const isPartiallyDelivered = $derived(
		deliveryStatus && deliveryStatus.delivered > 0 && deliveryStatus.delivered < deliveryStatus.total
	);
</script>

<div
	class={cn(
		'group flex flex-col gap-1',
		isMe ? 'items-end' : 'items-start'
	)}
>
	<!-- Sender name (only for others) -->
	{#if !isMe}
		<span class="px-3 text-xs font-medium text-muted-foreground truncate max-w-[200px]">
			{message.sender_name}
		</span>
	{/if}

	<!-- Message bubble with actions -->
	<div class={cn('flex items-center gap-1', isMe ? 'flex-row-reverse' : 'flex-row')}>
		<!-- Message content -->
		<div
			use:longPress={{ duration: 400, onLongPress: handleLongPress }}
			class={cn(
				'max-w-[80%] max-h-[400px] overflow-y-auto rounded-2xl px-4 py-2.5 text-sm select-none',
				isMe
					? 'bg-primary text-primary-foreground'
					: 'bg-muted text-foreground',
				isDeleted && 'italic text-muted-foreground',
				'active:scale-[0.98] transition-transform'
			)}
		>
			{#if isEditing}
				<div class="flex items-center gap-2">
					<Input
						type="text"
						bind:value={editContent}
						onkeydown={handleKeydown}
						aria-label="Edit message content"
						class="h-7 min-w-[200px] text-sm bg-background text-foreground"
						autofocus
					/>
					<Button variant="ghost" size="icon" onclick={saveEdit} class="h-7 w-7" aria-label="Save edit">
						<Check class="h-4 w-4" />
					</Button>
					<Button variant="ghost" size="icon" onclick={cancelEdit} class="h-7 w-7" aria-label="Cancel edit">
						<X class="h-4 w-4" />
					</Button>
				</div>
			{:else}
				<p class="whitespace-pre-wrap break-words">{message.content}</p>
			{/if}
		</div>

		<!-- Desktop-only: Actions on hover (hidden on touch devices) -->
		{#if !isTouchDevice}
			{#if isMe && !isDeleted && !isEditing}
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
		<div class="px-3">
			<ReactionPills
				reactions={message.reactions}
				onToggleReaction={handleReaction}
				{isMe}
			/>
		</div>
	{/if}

	<!-- Timestamp and delivery status (always visible) -->
	<span
		class={cn(
			'px-3 text-[10px] text-muted-foreground/70 flex items-center gap-1',
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
						<span class="inline-flex items-center cursor-help">
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
							<p>Delivered to {deliveryStatus.delivered}/{deliveryStatus.total} peer{deliveryStatus.total !== 1 ? 's' : ''}</p>
						{/if}
					</Tooltip.Content>
				</Tooltip.Root>
			</Tooltip.Provider>
		{:else if isMe}
			<Check class="h-3 w-3 text-muted-foreground" />
		{/if}
	</span>
</div>
