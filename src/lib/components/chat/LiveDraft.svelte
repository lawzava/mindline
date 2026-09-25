<script lang="ts">
	import { onDestroy } from 'svelte';
	import { draftsList } from '$lib/stores';
	import { fade } from 'svelte/transition';
	import { cn } from '$lib/utils';

	// The reason this product exists, staged as a first-class entry in the
	// message stream: the peer's words form exactly in the slot (and the
	// geometry) of the bubble they will become. The dot is cobalt, not
	// green: green means "online" everywhere; cobalt means the wire is hot.
	//
	// The caret is load-aware: solid and still while characters arrive,
	// breathing (in phase with the presence dot) only in silence.
	//
	// Idle drafts hold at 85% opacity, not 55%: at 55% the draft text fell
	// to ~2.5:1 (light) and ~3.1:1 (dark) against its fill; 85% keeps it at
	// >= 4.5:1 in both themes while still reading as a held breath.

	let active = $state<Record<string, boolean>>({});
	const timers: Record<string, ReturnType<typeof setTimeout>> = {};
	const lastContent: Record<string, string> = {};

	$effect(() => {
		const present = new Set($draftsList.map((d) => d.peerId));
		for (const draft of $draftsList) {
			if (lastContent[draft.peerId] !== draft.content) {
				lastContent[draft.peerId] = draft.content;
				active[draft.peerId] = true;
				clearTimeout(timers[draft.peerId]);
				timers[draft.peerId] = setTimeout(() => {
					active[draft.peerId] = false;
				}, 1000);
			}
		}
		// Evict state for peers whose drafts are gone, so a fresh draft with
		// identical text still reads as activity.
		for (const peerId of Object.keys(lastContent)) {
			if (!present.has(peerId)) {
				clearTimeout(timers[peerId]);
				delete timers[peerId];
				delete lastContent[peerId];
				delete active[peerId];
			}
		}
	});

	const typingAnnouncement = $derived.by(() => {
		const names = $draftsList.map((d) => d.senderName);
		if (names.length === 0) return '';
		if (names.length === 1) return `${names[0]} is typing`;
		if (names.length === 2) return `${names[0]} and ${names[1]} are typing`;
		return 'Several people are typing';
	});

	onDestroy(() => {
		for (const timer of Object.values(timers)) clearTimeout(timer);
	});
</script>

<!-- Screen readers hear that someone is typing, once, not every keystroke.
     This region's text changes only when the set of typists does. -->
<p class="sr-only" aria-live="polite" aria-atomic="true">{typingAnnouncement}</p>

{#each $draftsList as draft (draft.peerId)}
	{@const breathing = !active[draft.peerId] && !draft.isFading}
	<!-- aria-live="off" opts the forming text out of the message list's live
	     region; it stays readable on demand, it just is not announced. -->
	<div
		class={cn(
			'mt-4 flex min-w-0 max-w-[min(78%,36rem)] flex-col items-start gap-1 transition-opacity duration-500',
			draft.isFading && 'opacity-85'
		)}
		transition:fade={{ duration: 150 }}
		data-testid="draft-indicator"
		aria-live="off"
	>
		<span class="ml-1 flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
			{draft.senderName}
			<span class={cn('h-1.5 w-1.5 rounded-full bg-draft', breathing && 'breathe')}></span>
		</span>
		<div class="min-w-0 max-w-full rounded-[1.125rem] bg-wash-draft px-3.5 py-2.5">
			{#if draft.content.trim()}
				<p class="whitespace-pre-wrap text-base leading-[1.45] text-draft [overflow-wrap:anywhere]">
					{draft.content.slice(0, -1)}{#key draft.content}<span class="ink-in"
							>{draft.content.slice(-1)}</span
						>{/key}<span
						class={cn(
							'ml-0.5 inline-block h-[1.15em] w-0.5 translate-y-[0.2em] rounded-full bg-draft',
							breathing && 'breathe'
						)}
					></span>
				</p>
			{:else}
				<span
					class={cn(
						'inline-block h-[1.15em] w-0.5 translate-y-[0.2em] rounded-full bg-draft',
						breathing && 'breathe'
					)}
				></span>
			{/if}
		</div>
	</div>
{/each}
