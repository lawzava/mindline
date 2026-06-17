<script lang="ts">
	import { cn, senderHue } from '$lib/utils';
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
		/** Previous message: same sender, within the grouping window. */
		groupedAbove?: boolean;
		/** Next message: same sender, within the grouping window. */
		groupedBelow?: boolean;
		/** Previous message is the same sender (any time gap). */
		sameSenderAbove?: boolean;
		/** This message latches in from a live draft (color cools in place). */
		settle?: boolean;
		/** Newly arrived: one-shot entry animation. */
		animate?: boolean;
		onEdit?: (messageId: string, newContent: string) => void;
		onDelete?: (messageId: string) => void;
		onReaction?: (messageId: string, emoji: string) => void;
	}

	let {
		message,
		isMe,
		groupedAbove = false,
		groupedBelow = false,
		sameSenderAbove = false,
		settle = false,
		animate = false,
		onEdit,
		onDelete,
		onReaction
	}: Props = $props();

	let isEditing = $state(false);
	let editContent = $state('');
	let showLongPressMenu = $state(false);
	let revealed = $state(false);
	let revealTimer: ReturnType<typeof setTimeout> | null = null;

	// Detect if device supports touch
	const isTouchDevice = $derived(
		typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0)
	);

	function formatTime(timestamp: number): string {
		const date = new Date(timestamp);
		return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
	}

	/** Per-message time is tap-to-reveal; phones have no hover. */
	function toggleReveal() {
		if (revealTimer) clearTimeout(revealTimer);
		revealed = true;
		revealTimer = setTimeout(() => (revealed = false), 3000);
	}

	function revealKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			toggleReveal();
		}
	}

	$effect(() => {
		return () => {
			if (revealTimer) clearTimeout(revealTimer);
		};
	});

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
		deliveryStatus &&
			deliveryStatus.delivered > 0 &&
			deliveryStatus.delivered < deliveryStatus.total
	);

	// Corner-radius arithmetic: within a group the corners facing an adjacent
	// same-group bubble tighten; the asymmetry carries direction without tails.
	const corners = $derived.by(() => {
		if (isMe) {
			return cn(
				groupedAbove ? 'rounded-tr-md' : 'rounded-tr-[1.125rem]',
				groupedBelow ? 'rounded-br-md' : 'rounded-br-[1.125rem]',
				'rounded-tl-[1.125rem] rounded-bl-[1.125rem]'
			);
		}
		return cn(
			groupedAbove ? 'rounded-tl-md' : 'rounded-tl-[1.125rem]',
			groupedBelow ? 'rounded-bl-md' : 'rounded-bl-[1.125rem]',
			'rounded-tr-[1.125rem] rounded-br-[1.125rem]'
		);
	});

	// The meta row always shows on the last message of a group; mid-group it
	// appears only when it carries information (edited/failed) or on tap.
	const showMeta = $derived(
		!groupedBelow || message.edited || message.status === 'Failed' || revealed
	);

	// Tap-to-reveal only applies to plain text bubbles: while editing or on
	// attachments the bubble must not swallow clicks from inner controls.
	const revealable = $derived(!isEditing && !message.attachment);

	// A stable per-sender hue tints a peer's bubble and byline so speakers are
	// distinguishable in group chats (see senderHue / .peer-shade). Only peers
	// are tinted; your own messages stay the cobalt "sent" wash.
	const hue = $derived(senderHue(message.sender_id));
</script>

<div
	class={cn(
		'group flex flex-col gap-1',
		isMe ? 'items-end' : 'items-start',
		groupedAbove ? 'mt-0.5' : sameSenderAbove ? 'mt-3' : 'mt-4'
	)}
	style={!isMe ? `--u-hue:${hue}` : undefined}
	data-testid="message-bubble"
>
	<!-- Byline (others only, first message of a group) -->
	{#if !isMe && !groupedAbove}
		<span
			class="peer-name ml-1 max-w-[60vw] truncate text-[0.8125rem] font-semibold sm:max-w-[260px]"
		>
			{message.sender_name}
		</span>
	{/if}

	<!-- Message block with actions. The width cap lives on this row (its
	     containing block is the full-width column) — a percentage max-width
	     on the bubble itself resolves against this shrink-to-fit row and
	     collapses to ~2ch on touch devices, where the row has no buttons. -->
	<div
		class={cn(
			'flex max-w-[min(78%,36rem)] items-center gap-1',
			isMe ? 'flex-row-reverse' : 'flex-row'
		)}
	>
		<!-- Bubble: fill alone defines it; no borders, no shadows. -->
		<!-- svelte-ignore a11y_no_noninteractive_tabindex -- role is 'button' exactly when tabindex is 0 (revealable) -->
		<div
			use:longPress={{ duration: 400, onLongPress: handleLongPress }}
			onclick={revealable ? toggleReveal : undefined}
			onkeydown={revealable ? revealKeydown : undefined}
			role={revealable ? 'button' : undefined}
			tabindex={revealable ? 0 : undefined}
			aria-label={revealable ? 'Show message time' : undefined}
			class={cn(
				'min-w-0 break-words px-3.5 py-2.5 text-foreground',
				corners,
				message.attachment ? 'max-w-full' : '',
				isMe ? 'bg-wash-sent' : 'peer-shade',
				settle ? 'settle' : animate ? 'msg-in' : '',
				isDeleted && 'text-muted-foreground'
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
					<Button
						variant="ghost"
						size="icon"
						onclick={saveEdit}
						class="h-7 w-7"
						aria-label="Save edit"
					>
						<Check class="h-4 w-4" />
					</Button>
					<Button
						variant="ghost"
						size="icon"
						onclick={cancelEdit}
						class="h-7 w-7"
						aria-label="Cancel edit"
					>
						<X class="h-4 w-4" />
					</Button>
				</div>
			{:else if message.attachment}
				<MediaAttachment attachment={message.attachment} roomId={message.room_id} />
			{:else}
				<p class="whitespace-pre-wrap break-words text-base leading-[1.45]">{message.content}</p>
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

	<!-- Timestamp and delivery: last-of-group, info-bearing, or tap-revealed -->
	{#if showMeta}
		<span
			class={cn(
				'flex items-center gap-1 px-1 text-xs tabular-nums text-muted-foreground',
				isMe ? 'justify-end' : 'justify-start'
			)}
		>
			{formatTime(message.timestamp)}
			{#if message.edited}
				<span>(edited)</span>
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
									Delivered to {deliveryStatus.delivered}/{deliveryStatus.total} peer{deliveryStatus.total !==
									1
										? 's'
										: ''}
								</p>
							{/if}
						</Tooltip.Content>
					</Tooltip.Root>
				</Tooltip.Provider>
			{:else if isMe}
				<Check class="h-3 w-3 text-muted-foreground" />
			{/if}
		</span>
	{/if}
</div>
