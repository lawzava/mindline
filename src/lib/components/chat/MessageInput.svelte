<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Send, Loader2 } from 'lucide-svelte';

	interface Props {
		onSend: (message: string) => void;
		onTyping?: (content: string) => void;
		disabled?: boolean;
		isSending?: boolean;
	}

	let { onSend, onTyping, disabled = false, isSending = false }: Props = $props();
	let message = $state('');
	let inputRef = $state<HTMLTextAreaElement | null>(null);

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

	function shouldAutofocus() {
		// Avoid popping the mobile keyboard on room entry; desktop gets autofocused for speed.
		if (typeof window === 'undefined') return true;
		return window.matchMedia?.('(pointer: fine)').matches ?? true;
	}

	// Focus input on mount (desktop-first)
	$effect(() => {
		if (inputRef && !disabled && shouldAutofocus()) {
			inputRef.focus();
		}
	});
</script>

<div class="flex shrink-0 items-end gap-2 border-t border-border bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
	<textarea
		bind:this={inputRef}
		placeholder="Type a message..."
		aria-label="Message input"
		enterkeyhint="send"
		rows={1}
		bind:value={message}
		onkeydown={handleKeydown}
		oninput={handleInput}
		{disabled}
		class="border-input bg-background selection:bg-primary dark:bg-input/30 selection:text-primary-foreground ring-offset-background placeholder:text-muted-foreground flex min-h-11 max-h-32 w-full min-w-0 flex-1 resize-none rounded-md border px-3 py-2 text-base leading-5 shadow-xs transition-[color,box-shadow] outline-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive"
		data-testid="message-input"
	></textarea>
	<Button
		onclick={handleSubmit}
		disabled={disabled || isSending || !message.trim()}
		size="icon"
		class="h-11 w-11 shrink-0"
		data-testid="send-btn"
	>
		{#if isSending}
			<Loader2 class="h-4 w-4 animate-spin motion-reduce:animate-none" />
		{:else}
			<Send class="h-4 w-4" />
		{/if}
		<span class="sr-only">{isSending ? 'Sending...' : 'Send message'}</span>
	</Button>
</div>
