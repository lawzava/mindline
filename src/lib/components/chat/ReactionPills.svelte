<script lang="ts">
	import { cn } from '$lib/utils';
	import { getSessionDeviceId } from '$lib/p2p';

	interface ReactionData {
		users: string[];
		count: number;
	}

	interface Props {
		reactions: Record<string, ReactionData>;
		onToggleReaction: (emoji: string) => void;
		isMe: boolean;
	}

	let { reactions, onToggleReaction, isMe }: Props = $props();

	// Reaction membership is keyed by deviceId (PROTOCOL.md §3.5); the id
	// is stable for the whole session, so a plain read is reactive enough.
	const reactionList = $derived(
		Object.entries(reactions)
			.filter(([_, data]) => data.count > 0)
			.map(([emoji, data]) => ({
				emoji,
				count: data.count,
				hasReacted: data.users.includes(getSessionDeviceId() ?? '')
			}))
	);
</script>

{#if reactionList.length > 0}
	<div class={cn('flex flex-wrap gap-1 mt-1', isMe ? 'justify-end' : 'justify-start')}>
		{#each reactionList as reaction}
			<button
				onclick={() => onToggleReaction(reaction.emoji)}
				aria-label={reaction.hasReacted
					? `Remove ${reaction.emoji} reaction (${reaction.count} total)`
					: `React with ${reaction.emoji} (${reaction.count} total)`}
				class={cn(
					'flex items-center gap-1 rounded-full px-2 py-0.5 text-xs transition-colors',
					reaction.hasReacted
						? 'bg-primary/20 text-primary hover:bg-primary/30'
						: 'bg-muted hover:bg-muted/80 text-muted-foreground'
				)}
			>
				<span>{reaction.emoji}</span>
				<span>{reaction.count}</span>
			</button>
		{/each}
	</div>
{/if}
