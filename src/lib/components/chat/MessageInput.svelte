<script lang="ts">
	import { onDestroy, onMount, tick } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import { Send, Loader2, Paperclip, Camera, Mic, Square, X, CornerUpLeft } from 'lucide-svelte';
	import { processImage } from '$lib/media/image';
	import { mediaKindFor } from '$lib/media/classify';
	import { Recorder, type Recording } from '$lib/media/recorder';
	import type { MediaKind } from '$lib/media/transfer';
	import { peerCount } from '$lib/stores';
	import { toast } from 'svelte-sonner';

	interface Props {
		onSend: (message: string) => void;
		onSendMedia?: (
			data: Uint8Array,
			meta: {
				kind: MediaKind;
				name: string;
				mime: string;
				thumb?: string;
				thumbMime?: string;
				duration?: number;
				waveform?: number[];
			}
		) => Promise<void>;
		onTyping?: (content: string) => void;
		disabled?: boolean;
		isSending?: boolean;
		/** The message being answered, shown above the field until sent. */
		replyTo?: { name: string; text: string } | null;
		onCancelReply?: () => void;
	}

	let {
		onSend,
		onSendMedia,
		onTyping,
		disabled = false,
		isSending = false,
		replyTo = null,
		onCancelReply
	}: Props = $props();

	// Choosing Reply puts the cursor where the answer goes.
	$effect(() => {
		if (replyTo) inputRef?.focus();
	});
	let message = $state('');
	let inputRef = $state<HTMLTextAreaElement | null>(null);
	let fileInput = $state<HTMLInputElement | null>(null);
	let photoInput = $state<HTMLInputElement | null>(null);
	let isPreparingMedia = $state(false);
	let recorder = $state<Recorder | null>(null);
	let isStartingRecording = $state(false);
	let isStoppingRecording = $state(false);
	let destroyed = false;
	let recordSeconds = $state(0);
	let recordTimer: ReturnType<typeof setInterval> | null = null;

	async function handleSubmit() {
		const trimmed = message.trim();
		if (trimmed) {
			onSend(trimmed);
			message = '';
			// Clear the typing indicator
			onTyping?.('');
			await tick();
			autogrow();
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && replyTo) {
			e.preventDefault();
			onCancelReply?.();
			return;
		}
		if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
			e.preventDefault();
			handleSubmit();
		}
	}

	function handleInput() {
		if (liveTyping) onTyping?.(message);
		autogrow();
	}

	// Live typing is the product's thesis, but not everyone wants to be seen
	// thinking: it is on by default and one tap holds drafts until send.
	const LIVE_TYPING_KEY = 'mindline_live_typing';
	let liveTyping = $state(true);

	onMount(() => {
		try {
			liveTyping = localStorage.getItem(LIVE_TYPING_KEY) !== 'off';
		} catch {
			// Storage blocked: keep the default.
		}
	});

	// Drafts ride a lossy, unordered channel, so one clear can be dropped or
	// overtaken by an earlier draft packet. Repeat it while drafts stay held.
	let holdClearTimers: ReturnType<typeof setTimeout>[] = [];
	function cancelHoldClears() {
		for (const t of holdClearTimers) clearTimeout(t);
		holdClearTimers = [];
	}

	function toggleLiveTyping() {
		liveTyping = !liveTyping;
		cancelHoldClears();
		try {
			localStorage.setItem(LIVE_TYPING_KEY, liveTyping ? 'on' : 'off');
		} catch {
			// Storage blocked: the choice lasts for this page only.
		}
		// Holding clears the draft peers already see. Going live shares the
		// field as it stands, so the wire dot never glows over a silent wire.
		if (!liveTyping) {
			onTyping?.('');
			holdClearTimers = [400, 1500].map((ms) =>
				setTimeout(() => {
					if (!liveTyping) onTyping?.('');
				}, ms)
			);
		} else if (message.trim()) onTyping?.(message);
	}

	/** Tallest the input grows before it scrolls internally (matches max-h-40). */
	const MAX_INPUT_PX = 160;

	/** Grow 1-6 rows with the content. */
	function autogrow() {
		const el = inputRef;
		if (!el) return;
		el.style.height = 'auto';
		// The textarea is border-box, so scrollHeight excludes the 1px top/bottom
		// border. Setting height = scrollHeight then leaves the content box ~2px
		// short, which overflows by a pixel and flickers a scrollbar in on a
		// single line (mobile). Add the border back, and only ever let it scroll
		// once we've actually hit the cap.
		const borderY = el.offsetHeight - el.clientHeight;
		const fit = el.scrollHeight + borderY;
		el.style.height = `${Math.min(fit, MAX_INPUT_PX)}px`;
		el.style.overflowY = fit > MAX_INPUT_PX ? 'auto' : 'hidden';
	}

	async function handleFiles(files: FileList | null, forcedKind?: MediaKind) {
		if (!files?.length || !onSendMedia) return;
		isPreparingMedia = true;
		try {
			for (const file of Array.from(files)) {
				const isImage = file.type.startsWith('image/');
				if (isImage) {
					// Re-encode strips EXIF/GPS by construction (PROTOCOL.md §5.3)
					const processed = await processImage(file);
					await onSendMedia(processed.data, {
						kind: 'image',
						name:
							file.name.replace(/\.[a-z0-9]+$/i, '') +
							(processed.mime === 'image/webp' ? '.webp' : '.jpg'),
						mime: processed.mime,
						thumb: processed.thumb,
						thumbMime: processed.thumbMime
					});
				} else {
					const data = new Uint8Array(await file.arrayBuffer());
					await onSendMedia(data, {
						kind: forcedKind ?? mediaKindFor(file.type),
						name: file.name,
						mime: file.type || 'application/octet-stream'
					});
				}
			}
		} catch (error) {
			console.error('media send failed:', error);
			toast.error(error instanceof Error ? error.message : 'Could not send the file');
		} finally {
			isPreparingMedia = false;
			if (fileInput) fileInput.value = '';
			if (photoInput) photoInput.value = '';
		}
	}

	async function toggleVoice() {
		if (!onSendMedia || disabled || isPreparingMedia || isStartingRecording || isStoppingRecording)
			return;
		if (recorder) {
			await finishVoice(recorder);
			return;
		}
		const r = new Recorder('voice');
		recorder = r;
		isStartingRecording = true;
		try {
			await r.start();
			if (destroyed || recorder !== r) {
				r.cancel();
				return;
			}
			recordSeconds = 0;
			recordTimer = setInterval(() => {
				recordSeconds = Math.floor(r.elapsedSeconds);
				if (!r.isRecording) void finishVoice(r);
			}, 500);
		} catch {
			if (recorder === r) cancelVoice();
			if (!destroyed) toast.error('Microphone unavailable');
		} finally {
			isStartingRecording = false;
		}
	}

	async function finishVoice(r: Recorder) {
		if (isStoppingRecording || recorder !== r || destroyed) return;
		isStoppingRecording = true;
		stopRecordTimer();
		try {
			const recording = await r.stop();
			if (destroyed || recorder !== r) return;
			recorder = null;
			if (recording) await sendRecording(recording);
		} catch {
			if (recorder === r) cancelVoice();
			if (!destroyed) toast.error('Could not finish the voice note');
		} finally {
			isStoppingRecording = false;
		}
	}

	function cancelVoice() {
		recorder?.cancel();
		recorder = null;
		stopRecordTimer();
	}

	function stopRecordTimer() {
		if (recordTimer) clearInterval(recordTimer);
		recordTimer = null;
		recordSeconds = 0;
	}

	onDestroy(() => {
		destroyed = true;
		cancelHoldClears();
		cancelVoice();
	});

	async function sendRecording(recording: Recording) {
		isPreparingMedia = true;
		try {
			await onSendMedia?.(recording.data, {
				kind: 'voice',
				name: `voice-note.${recording.mime.includes('mp4') ? 'm4a' : 'webm'}`,
				mime: recording.mime,
				duration: Math.round(recording.duration),
				waveform: recording.waveform
			});
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'Could not send the voice note');
		} finally {
			isPreparingMedia = false;
		}
	}

	function formatSeconds(s: number): string {
		return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
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

<input
	bind:this={fileInput}
	type="file"
	multiple
	class="hidden"
	onchange={(e) => handleFiles(e.currentTarget.files)}
	data-testid="file-input"
/>
<!-- No capture attribute: with a bare accept filter the OS offers the photo
     gallery (with camera as an option) instead of forcing the camera or, on
     some Androids, a generic file manager. -->
<input
	bind:this={photoInput}
	type="file"
	accept="image/*,video/*"
	multiple
	class="hidden"
	onchange={(e) => handleFiles(e.currentTarget.files)}
	data-testid="photo-input"
/>

<div
	class="flex shrink-0 flex-wrap items-end gap-1 border-t border-border bg-background px-2 py-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] sm:gap-1.5 sm:px-3"
>
	{#if recorder && !isStartingRecording}
		<div class="flex h-11 flex-1 items-center gap-3 rounded-[1.375rem] bg-destructive/5 px-4">
			<span class="h-2.5 w-2.5 animate-pulse rounded-full bg-destructive motion-reduce:animate-none"
			></span>
			<span class="text-xs tabular-nums" data-testid="record-elapsed"
				>{formatSeconds(recordSeconds)}</span
			>
			<span class="flex-1 text-sm text-muted-foreground">Recording voice note...</span>
			<Button
				variant="ghost"
				size="icon"
				class="h-9 w-9 text-destructive"
				onclick={cancelVoice}
				aria-label="Cancel recording"
			>
				<X class="h-4 w-4" />
			</Button>
		</div>
		<Button
			onclick={toggleVoice}
			disabled={isStoppingRecording}
			size="icon"
			class="h-10 w-10 shrink-0 rounded-full"
			data-testid="voice-stop-btn"
		>
			<Square class="h-4 w-4" />
			<span class="sr-only">Stop and send</span>
		</Button>
	{:else}
		{#if replyTo}
			<div
				class="flex w-full min-w-0 items-center gap-2 rounded-lg bg-muted/60 px-3 py-1.5"
				data-testid="reply-preview"
			>
				<CornerUpLeft class="h-4 w-4 shrink-0 text-muted-foreground" />
				<span class="min-w-0 flex-1">
					<span class="block truncate text-xs font-semibold">Replying to {replyTo.name}</span>
					<span class="block truncate text-sm text-muted-foreground">{replyTo.text}</span>
				</span>
				<Button
					variant="ghost"
					size="icon"
					class="h-8 w-8 shrink-0"
					onclick={() => onCancelReply?.()}
					aria-label="Cancel reply"
				>
					<X class="h-4 w-4" />
				</Button>
			</div>
		{/if}
		<div class="flex w-full items-center gap-1.5 px-1 text-xs text-muted-foreground">
			<span id="live-typing-note">
				{liveTyping
					? 'Others see your typing before you send.'
					: 'Drafts stay private until you send.'}
			</span>
			<!-- One stable name with aria-pressed; the visible verb is the action. -->
			<button
				type="button"
				onclick={toggleLiveTyping}
				aria-pressed={liveTyping}
				aria-label="Live typing"
				class="-my-1 shrink-0 rounded-md px-1.5 py-1 font-medium text-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50"
				data-testid="live-typing-toggle"
			>
				{liveTyping ? 'Hold drafts' : 'Go live'}
			</button>
		</div>
		{#if onSendMedia}
			<Button
				variant="ghost"
				size="icon"
				class="h-10 w-10 shrink-0 text-muted-foreground"
				disabled={disabled || isPreparingMedia}
				onclick={() => fileInput?.click()}
				aria-label="Attach a file"
				data-testid="attach-btn"
			>
				{#if isPreparingMedia}
					<Loader2 class="h-4 w-4 animate-spin motion-reduce:animate-none" />
				{:else}
					<Paperclip class="h-4 w-4" />
				{/if}
			</Button>
			<Button
				variant="ghost"
				size="icon"
				class="h-10 w-10 shrink-0 text-muted-foreground"
				disabled={disabled || isPreparingMedia}
				onclick={() => photoInput?.click()}
				aria-label="Send a photo or video"
				data-testid="photo-btn"
			>
				<Camera class="h-4 w-4" />
			</Button>
		{/if}
		<div class="relative min-w-0 flex-1">
			<textarea
				bind:this={inputRef}
				placeholder="Message"
				aria-label="Message input"
				aria-describedby="live-typing-note"
				enterkeyhint="send"
				rows={1}
				bind:value={message}
				onkeydown={handleKeydown}
				oninput={handleInput}
				{disabled}
				class={`flex max-h-40 min-h-10 w-full resize-none overflow-y-hidden rounded-[1.25rem] border border-input bg-input/60 px-4 py-2 text-base leading-[1.45] text-foreground outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[2px] focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 ${onSendMedia && !message.trim() ? 'pr-11' : 'pr-4'}`}
				data-testid="message-input"
			></textarea>
			<!-- The wire dot: glows only when your words are actually on a wire
			     (live typing on, text in the field AND at least one peer connected). -->
			{#if liveTyping && message.trim() && $peerCount > 0}
				<span
					class="breathe absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-draft"
					aria-hidden="true"
				></span>
			{/if}
			{#if onSendMedia && !message.trim()}
				<Button
					variant="ghost"
					size="icon"
					class="absolute bottom-0.5 right-1 h-9 w-9 text-muted-foreground"
					disabled={disabled || isPreparingMedia || isStartingRecording || isStoppingRecording}
					onclick={toggleVoice}
					aria-label="Record a voice note"
					data-testid="voice-btn"
				>
					<Mic class="h-4 w-4" />
				</Button>
			{/if}
		</div>
		<Button
			onclick={handleSubmit}
			disabled={disabled || isSending || !message.trim()}
			size="icon"
			class="h-10 w-10 shrink-0 rounded-full"
			data-testid="send-btn"
		>
			{#if isSending}
				<Loader2 class="h-4 w-4 animate-spin motion-reduce:animate-none" />
			{:else}
				<Send class="h-4 w-4" />
			{/if}
			<span class="sr-only">{isSending ? 'Sending...' : 'Send message'}</span>
		</Button>
	{/if}
</div>
