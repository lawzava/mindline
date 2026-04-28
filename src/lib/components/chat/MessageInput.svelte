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

<div class="shrink-0 border-t border-amber-200/60 bg-gradient-to-b from-orange-50/80 via-amber-50/95 to-stone-50 px-3 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-[0_-18px_48px_-32px_rgba(120,53,15,0.55)] dark:border-amber-300/15 dark:from-stone-950/70 dark:via-stone-950/95 dark:to-amber-950/30 motion-reduce:transition-none sm:px-4 sm:py-4 sm:pb-[calc(1rem+env(safe-area-inset-bottom))]">
	<div class="mx-auto flex max-w-3xl items-end gap-2 rounded-[1.25rem] border border-amber-200/75 bg-white/85 p-2 shadow-[0_16px_44px_-30px_rgba(120,53,15,0.7)] ring-1 ring-white/80 transition-[border-color,box-shadow] duration-200 motion-reduce:transition-none dark:border-amber-200/15 dark:bg-stone-950/70 dark:ring-white/5">
		<div class="min-w-0 flex-1">
			<div class="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 px-2 text-[0.72rem] font-medium tracking-wide text-amber-900/75 dark:text-amber-100/70">
				<span>Drafts are live while you type.</span>
				<span class="text-stone-500 dark:text-stone-400">Enter sends. Shift Enter adds a line.</span>
			</div>
			<textarea
				bind:this={inputRef}
				placeholder="Type a message"
				aria-label="Message input. Drafts are visible to connected peers while you type."
				enterkeyhint="send"
				rows={1}
				bind:value={message}
				onkeydown={handleKeydown}
				oninput={handleInput}
				{disabled}
				class="selection:bg-amber-300 selection:text-amber-950 placeholder:text-stone-400 flex min-h-12 max-h-32 w-full min-w-0 resize-none rounded-2xl border border-transparent bg-amber-50/80 px-3 py-3 text-base leading-5 text-stone-950 shadow-inner shadow-amber-900/5 outline-none transition-[background-color,border-color,box-shadow] duration-200 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none md:text-sm dark:bg-stone-900/80 dark:text-stone-50 dark:placeholder:text-stone-500 focus-visible:border-amber-400/80 focus-visible:bg-white focus-visible:ring-2 focus-visible:ring-amber-300/50 dark:focus-visible:border-amber-300/50 dark:focus-visible:bg-stone-900 dark:focus-visible:ring-amber-300/20"
				data-testid="message-input"
			></textarea>
		</div>
		<Button
			onclick={handleSubmit}
			disabled={disabled || isSending || !message.trim()}
			size="icon"
			class="h-12 w-12 shrink-0 rounded-2xl bg-amber-600 text-white shadow-lg shadow-amber-900/20 transition-[transform,box-shadow,background-color] duration-200 hover:bg-amber-700 hover:shadow-amber-900/30 disabled:shadow-none motion-reduce:transition-none motion-reduce:hover:transform-none dark:bg-amber-500 dark:text-stone-950 dark:hover:bg-amber-400"
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
</div>
