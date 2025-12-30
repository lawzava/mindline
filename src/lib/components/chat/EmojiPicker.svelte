<script lang="ts">
	import * as Popover from '$lib/components/ui/popover';
	import { Button } from '$lib/components/ui/button';
	import { Smile } from 'lucide-svelte';

	interface Props {
		onSelectEmoji: (emoji: string) => void;
	}

	let { onSelectEmoji }: Props = $props();
	let open = $state(false);

	const emojis = ['👍', '❤️', '😂', '😮', '😢', '👏', '🔥', '🎉'];

	function handleSelect(emoji: string) {
		onSelectEmoji(emoji);
		open = false;
	}
</script>

<Popover.Root bind:open>
	<Popover.Trigger>
		<Button variant="ghost" size="icon" class="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity">
			<Smile class="h-4 w-4" />
			<span class="sr-only">Add reaction</span>
		</Button>
	</Popover.Trigger>
	<Popover.Content class="w-auto p-2">
		<div class="flex gap-1">
			{#each emojis as emoji}
				<button
					onclick={() => handleSelect(emoji)}
					class="h-8 w-8 flex items-center justify-center rounded hover:bg-muted text-lg transition-colors"
				>
					{emoji}
				</button>
			{/each}
		</div>
	</Popover.Content>
</Popover.Root>
