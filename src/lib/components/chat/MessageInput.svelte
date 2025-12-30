<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Send, Loader2 } from 'lucide-svelte';

	interface Props {
		onSend: (message: string) => void;
		onTyping?: (content: string) => void;
		disabled?: boolean;
		isSending?: boolean;
	}

	let { onSend, onTyping, disabled = false, isSending = false }: Props = $props();
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

<div class="flex shrink-0 items-center gap-2 border-t border-border bg-card p-4">
	<Input
		bind:ref={inputRef}
		type="text"
		placeholder="Type a message..."
		aria-label="Message input"
		bind:value={message}
		onkeydown={handleKeydown}
		oninput={handleInput}
		{disabled}
		class="flex-1"
	/>
	<Button
		onclick={handleSubmit}
		disabled={disabled || isSending || !message.trim()}
		size="icon"
		class="shrink-0"
	>
		{#if isSending}
			<Loader2 class="h-4 w-4 animate-spin" />
		{:else}
			<Send class="h-4 w-4" />
		{/if}
		<span class="sr-only">{isSending ? 'Sending...' : 'Send message'}</span>
	</Button>
</div>
