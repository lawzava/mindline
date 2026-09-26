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
	import { linkify } from '$lib/linkify';

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

	function revealClick(e: MouseEvent) {
		// A tap on a link opens the link; it is not a request for the time.
		if ((e.target as Element | null)?.closest('a')) return;
		toggleReveal();
	}

	function revealKeydown(e: KeyboardEvent) {
		// Keys pressed on an inner link belong to the link (Enter follows it).
		if (e.target !== e.currentTarget) return;
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
		if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
			e.preventDefault();
			saveEdit();
		} else if (e.key === 'Escape') {
			cancelEdit();
		}
	}

	function handleLongPress() {
		showLongPressMenu = true;
	}

	// Check if message is deleted. The stored '[Message deleted]' marker is
	// compared elsewhere, so it stays as is; only the rendering is humanized.
	const isDeleted = $derived(
		message.message_type === 'Deleted' || message.content === '[Message deleted]'
	);

	// Text and anchor segments, never {@html}: only http(s) becomes a link.
	const segments = $derived(linkify(message.content));

	// The time describes the bubble for assistive tech, whether or not the
	// meta row is visible, so screen readers hear the message then its time.
	const timeId = $derived(`msg-time-${message.id}`);

	// Delivery status for own messages, reactive to the live store
	const deliveryStatus = $derived.by(() => {
		if (!isMe) return null;
		const state = $delivery.get(message.id);
		if (!state) return null;
		return { delivered: state.deliveredTo.size, total: state.totalPeers };
	});

	// One tick state from the stored status (survives reloads) refined by
	// live acknowledgments while this session tracks the message.
	const tick = $derived.by((): 'local' | 'delivered' | 'partial' | 'sent' | null => {
		if (!isMe) return null;
		if (message.status === 'Delivered') return 'delivered';
		if (message.status === 'Local') return 'local';
		if (!deliveryStatus) return 'sent';
		if (deliveryStatus.total === 0) return 'local';
		if (deliveryStatus.delivered >= deliveryStatus.total) return 'delivered';
		return deliveryStatus.delivered > 0 ? 'partial' : 'sent';
	});
	const deliveryLabel = $derived(
		tick === 'local'
			? 'Not delivered yet: no one was here when you sent it. It arrives when someone opens the room.'
			: tick === 'delivered'
				? 'Delivered'
				: tick === 'partial' && deliveryStatus
					? `Delivered to ${deliveryStatus.delivered} of ${deliveryStatus.total}`
					: 'Sent'
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
		!groupedBelow || message.edited || message.unsigned || message.status === 'Failed' || revealed
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
		<!-- Bubble: fill alone defines it; no borders, no shadows.
		     No button role or aria-label: either would replace the message
		     text for screen readers. The bubble stays a focusable reading
		     stop (Enter/Space reveals the time) and is described by its time. -->
		<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_static_element_interactions -->
		<div
			use:longPress={{ duration: 400, onLongPress: handleLongPress }}
			onclick={revealable ? revealClick : undefined}
			onkeydown={revealable ? revealKeydown : undefined}
			tabindex={revealable ? 0 : undefined}
			aria-describedby={timeId}
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
				<div class="flex min-w-0 items-center gap-2">
					<Input
						type="text"
						bind:value={editContent}
						onkeydown={handleKeydown}
						aria-label="Edit message content"
						class="h-9 min-w-0 flex-1 bg-background text-base text-foreground"
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
			{:else if isDeleted}
				<!-- Deletion keeps the attachment record; the placeholder wins. -->
				<p class="text-base leading-[1.45]">This message was deleted</p>
			{:else if message.attachment}
				<MediaAttachment attachment={message.attachment} roomId={message.room_id} />
			{:else}
				<!-- Links are external http(s) URLs, never app routes: resolve() does not apply. -->
				<!-- eslint-disable svelte/no-navigation-without-resolve -->
				<p class="whitespace-pre-wrap break-words text-base leading-[1.45]">
					{#each segments as segment, i (i)}{#if segment.type === 'link'}<a
								href={segment.href}
								target="_blank"
								rel="noopener noreferrer nofollow"
								class="text-link underline underline-offset-2 [overflow-wrap:anywhere]"
								>{segment.text}</a
							>{:else}{segment.text}{/if}{/each}
				</p>
				<!-- eslint-enable svelte/no-navigation-without-resolve -->
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
		<LongPressMenu
			{isMe}
			{isDeleted}
			{isEditing}
			showTrigger={isTouchDevice && !isDeleted && !isEditing}
			bind:open={showLongPressMenu}
			onOpenChange={(open) => (showLongPressMenu = open)}
			onEdit={message.attachment ? undefined : startEdit}
			onDelete={handleDelete}
			copyText={message.attachment ? undefined : message.content}
			onReaction={handleReaction}
		/>
	</div>

	<!-- Reactions -->
	{#if !isDeleted && message.reactions && Object.keys(message.reactions).length > 0}
		<ReactionPills reactions={message.reactions} onToggleReaction={handleReaction} {isMe} />
	{/if}

	<!-- Timestamp and delivery: last-of-group, info-bearing, or tap-revealed -->
	{#if showMeta}
		<span
			id={timeId}
			class={cn(
				'flex items-center gap-1 px-1 text-xs tabular-nums text-muted-foreground',
				isMe ? 'justify-end' : 'justify-start'
			)}
		>
			{formatTime(message.timestamp)}
			{#if message.edited}
				<span>(edited)</span>
			{/if}
			{#if message.unsigned && !isMe}
				<!-- History served by another member without its author's signature. -->
				<span
					title="This copy came from another member's history without its author's signature, so it cannot be confirmed as theirs."
					data-testid="unverified-copy">unverified copy</span
				>
			{/if}
			{#if message.status === 'Failed'}
				<span class="text-destructive">(failed)</span>
			{:else if tick}
				<Tooltip.Provider>
					<Tooltip.Root>
						<Tooltip.Trigger
							aria-label={deliveryLabel}
							data-testid="delivery-tick"
							data-tick={tick}
						>
							<span class="inline-flex cursor-help items-center">
								{#if tick === 'local'}
									Not delivered yet
								{:else if tick === 'delivered'}
									<CheckCheck class="h-3 w-3 text-primary" aria-hidden="true" />
								{:else if tick === 'partial'}
									<CheckCheck class="h-3 w-3 text-muted-foreground" aria-hidden="true" />
								{:else}
									<Check class="h-3 w-3 text-muted-foreground" aria-hidden="true" />
								{/if}
							</span>
						</Tooltip.Trigger>
						<Tooltip.Content>
							<p>{deliveryLabel}</p>
						</Tooltip.Content>
					</Tooltip.Root>
				</Tooltip.Provider>
			{/if}
		</span>
	{:else}
		<!-- Mid-group the time is hidden visually but never from assistive tech. -->
		<span id={timeId} class="sr-only">{formatTime(message.timestamp)}</span>
	{/if}
</div>
