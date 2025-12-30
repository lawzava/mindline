<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Send } from 'lucide-svelte';

	interface Props {
		onSend: (message: string) => void;
		onTyping?: (content: string) => void;
		disabled?: boolean;
	}

	let { onSend, onTyping, disabled = false }: Props = $props();
	let message = $state('');
	let inputRef = $state<HTMLInputElement | null>(null);

	function handleSubmit() {
		const trimmed = message.trim();
		if (trimmed) {
			onSend(trimmed);
			message = '';
			// Clear the typing indicator
			onTyping?.('');
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			handleSubmit();
		}
	}

	function handleInput() {
		onTyping?.(message);
	}

	// Focus input on mount
	$effect(() => {
		if (inputRef && !disabled) {
			inputRef.focus();
		}
	});
</script>

<div class="flex items-center gap-2 border-t border-border bg-card p-4">
	<Input
		bind:ref={inputRef}
		type="text"
		placeholder="Type a message..."
		bind:value={message}
		onkeydown={handleKeydown}
		oninput={handleInput}
		{disabled}
		class="flex-1"
	/>
	<Button
		onclick={handleSubmit}
		disabled={disabled || !message.trim()}
		size="icon"
		class="shrink-0"
	>
		<Send class="h-4 w-4" />
		<span class="sr-only">Send message</span>
	</Button>
</div>
