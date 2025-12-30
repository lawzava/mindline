<script lang="ts">
	import * as Popover from '$lib/components/ui/popover';
	import { Button } from '$lib/components/ui/button';
	import { Smile } from 'lucide-svelte';
	import { cn } from '$lib/utils';

	interface Props {
		onSelectEmoji: (emoji: string) => void;
	}

	let { onSelectEmoji }: Props = $props();
	let open = $state(false);
	let focusedIndex = $state(0);

	const emojis = ['👍', '❤️', '😂', '😮', '😢', '👏', '🔥', '🎉'];

	function handleSelect(emoji: string) {
		onSelectEmoji(emoji);
		open = false;
	}

	function handleKeydown(e: KeyboardEvent) {
		switch (e.key) {
			case 'ArrowRight':
				e.preventDefault();
				focusedIndex = Math.min(focusedIndex + 1, emojis.length - 1);
				break;
			case 'ArrowLeft':
				e.preventDefault();
				focusedIndex = Math.max(focusedIndex - 1, 0);
				break;
			case 'Enter':
			case ' ':
				e.preventDefault();
				handleSelect(emojis[focusedIndex]);
				break;
			case 'Escape':
				e.preventDefault();
				open = false;
				break;
		}
	}

	// Reset focus when popover opens
	$effect(() => {
		if (open) {
			focusedIndex = 0;
		}
	});
</script>

<Popover.Root bind:open>
	<Popover.Trigger>
		<Button variant="ghost" size="icon" class="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity">
			<Smile class="h-4 w-4" />
			<span class="sr-only">Add reaction</span>
		</Button>
	</Popover.Trigger>
	<Popover.Content class="w-auto p-2">
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<!-- svelte-ignore a11y_interactive_supports_focus -->
		<div class="flex gap-1" role="listbox" aria-label="Emoji reactions" onkeydown={handleKeydown}>
			{#each emojis as emoji, index}
				<button
					onclick={() => handleSelect(emoji)}
					role="option"
					aria-selected={focusedIndex === index}
					tabindex={focusedIndex === index ? 0 : -1}
					class={cn(
						'h-8 w-8 flex items-center justify-center rounded text-lg transition-colors',
						focusedIndex === index ? 'bg-muted ring-2 ring-ring' : 'hover:bg-muted'
					)}
				>
					{emoji}
				</button>
			{/each}
		</div>
	</Popover.Content>
</Popover.Root>
