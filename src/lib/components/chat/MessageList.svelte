<script lang="ts">
	import MessageBubble from './MessageBubble.svelte';
	import LiveDraft from './LiveDraft.svelte';
	import { Button } from '$lib/components/ui/button';
	import { userId, draftsList, peerCount } from '$lib/stores';
	import { shareInvite } from '$lib/share';
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

	// Messages already present at mount render statically; only later
	// arrivals get the one-shot entry animation.
	const mountedAt = Date.now();

	const GROUP_WINDOW_MS = 60_000;

	function sameGroup(a: Message | undefined, b: Message | undefined): boolean {
		if (!a || !b) return false;
		return a.sender_id === b.sender_id && Math.abs(b.timestamp - a.timestamp) < GROUP_WINDOW_MS;
	}

	function dayChanged(a: Message | undefined, b: Message): boolean {
		if (!a) return true;
		return new Date(a.timestamp).toDateString() !== new Date(b.timestamp).toDateString();
	}

	function dayLabel(timestamp: number): string {
		const date = new Date(timestamp);
		const today = new Date();
		const yesterday = new Date(today);
		yesterday.setDate(today.getDate() - 1);
		if (date.toDateString() === today.toDateString()) return 'Today';
		if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
		return date.toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' });
	}

	// The latch: when a live draft from a peer becomes their sent message,
	// the bubble cools in place instead of popping in. Track which senders
	// had a draft moments ago (drafts are keyed by peerId; messages may
	// carry an app-level sender id, so names are tracked too).
	const recentDrafts = new Map<string, number>();
	$effect(() => {
		const now = Date.now();
		for (const d of $draftsList) {
			recentDrafts.set(d.peerId, now);
			recentDrafts.set(`name:${d.senderName}`, now);
		}
	});

	function latchesIn(message: Message): boolean {
		const seen =
			recentDrafts.get(message.sender_id) ?? recentDrafts.get(`name:${message.sender_name}`) ?? 0;
		return Date.now() - seen < 1500;
	}

	function handleScroll() {
		const el = scrollRef;
		if (!el) return;
		atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
	}

	// Follow the stream only when the reader is already at the bottom
	// (audit fix: no more force-scroll while reading history). Drafts
	// growing also keep the view pinned. Instant, not smooth: drafts
	// update per keystroke, and overlapping smooth scrolls animate
	// continuously — a main jank source on phones.
	$effect(() => {
		void messages.length;
		void $draftsList;
		if (scrollRef && atBottom) {
			requestAnimationFrame(() => {
				scrollRef?.scrollTo({ top: scrollRef.scrollHeight, behavior: 'instant' });
			});
		}
	});
</script>

<div class="min-h-0 flex-1 overflow-hidden" data-testid="message-list">
	<div
		bind:this={scrollRef}
		onscroll={handleScroll}
		class="mx-auto h-full max-w-3xl overflow-y-auto px-3 py-4 sm:px-4"
		aria-live="polite"
		aria-label="Messages"
	>
		{#if messages.length === 0 && $draftsList.length === 0}
			<div class="flex h-full items-center justify-center p-6">
				{#if $peerCount === 0}
					<!-- The one-time accent spend that creates the second person. -->
					<div class="flex max-w-xs flex-col items-center gap-4 text-center">
						<p class="text-sm text-muted-foreground">You're the only one here.</p>
						<Button onclick={shareInvite} class="h-11 px-6" data-testid="invite-btn">
							Invite someone
						</Button>
						<p class="text-xs text-muted-foreground">
							The link is the key. Anyone with it can join.
						</p>
					</div>
				{:else}
					<p class="text-center text-sm text-muted-foreground">Say hello.</p>
				{/if}
			</div>
		{:else}
			<div class="flex flex-col pb-1">
				{#each messages as message, i (message.id)}
					{#if dayChanged(messages[i - 1], message)}
						<div class="my-6 flex items-center gap-3" role="separator">
							<span class="h-px flex-1 bg-border"></span>
							<span class="text-xs font-medium text-muted-foreground">
								{dayLabel(message.timestamp)}
							</span>
							<span class="h-px flex-1 bg-border"></span>
						</div>
					{/if}
					<MessageBubble
						{message}
						isMe={message.sender_id === $userId}
						groupedAbove={sameGroup(messages[i - 1], message)}
						groupedBelow={sameGroup(message, messages[i + 1])}
						sameSenderAbove={i > 0 && messages[i - 1].sender_id === message.sender_id}
						animate={message.local_timestamp > mountedAt}
						settle={message.sender_id !== $userId &&
							message.local_timestamp > mountedAt &&
							latchesIn(message)}
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
