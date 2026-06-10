<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Send, Loader2, Paperclip, Camera, Mic, Square, X } from 'lucide-svelte';
	import { processImage } from '$lib/media/image';
	import { mediaKindFor } from '$lib/media/classify';
	import { Recorder, type Recording } from '$lib/media/recorder';
	import type { MediaKind } from '$lib/media/transfer';
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
	}

	let { onSend, onSendMedia, onTyping, disabled = false, isSending = false }: Props = $props();
	let message = $state('');
	let inputRef = $state<HTMLTextAreaElement | null>(null);
	let fileInput = $state<HTMLInputElement | null>(null);
	let photoInput = $state<HTMLInputElement | null>(null);
	let isPreparingMedia = $state(false);
	let recorder = $state<Recorder | null>(null);
	let recordSeconds = $state(0);
	let recordTimer: ReturnType<typeof setInterval> | null = null;

	function handleSubmit() {
		const trimmed = message.trim();
		if (trimmed) {
			onSend(trimmed);
			message = '';
			autogrow();
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
		autogrow();
	}

	/** Grow 1-6 rows with the content (audit fix: no more single-line cage). */
	function autogrow() {
		const el = inputRef;
		if (!el) return;
		el.style.height = 'auto';
		el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
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
						name: file.name.replace(/\.[a-z0-9]+$/i, '') + (processed.mime === 'image/webp' ? '.webp' : '.jpg'),
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
		if (!onSendMedia) return;
		if (recorder?.isRecording) {
			const recording = await recorder.stop();
			stopRecordTimer();
			recorder = null;
			if (recording) await sendRecording(recording);
			return;
		}
		try {
			const r = new Recorder('voice');
			await r.start();
			recorder = r;
			recordSeconds = 0;
			recordTimer = setInterval(() => {
				recordSeconds = Math.floor(r.elapsedSeconds);
				if (!r.isRecording) stopRecordTimer();
			}, 500);
		} catch {
			toast.error('Microphone unavailable');
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
	class="flex shrink-0 items-end gap-1.5 border-t border-border bg-background p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:gap-2 sm:p-4"
>
	{#if recorder?.isRecording}
		<div class="flex h-11 flex-1 items-center gap-3 rounded-md border border-destructive/40 bg-destructive/5 px-3">
			<span class="h-2.5 w-2.5 animate-pulse rounded-full bg-destructive motion-reduce:animate-none"></span>
			<span class="text-sm tabular-nums" data-testid="record-elapsed">{formatSeconds(recordSeconds)}</span>
			<span class="flex-1 text-sm text-muted-foreground">Recording voice note...</span>
			<Button variant="ghost" size="icon" class="h-9 w-9" onclick={cancelVoice} aria-label="Cancel recording">
				<X class="h-4 w-4" />
			</Button>
		</div>
		<Button onclick={toggleVoice} size="icon" class="h-11 w-11 shrink-0" data-testid="voice-stop-btn">
			<Square class="h-4 w-4" />
			<span class="sr-only">Stop and send</span>
		</Button>
	{:else}
		{#if onSendMedia}
			<Button
				variant="ghost"
				size="icon"
				class="h-11 w-11 shrink-0 text-muted-foreground"
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
				class="h-11 w-11 shrink-0 text-muted-foreground"
				disabled={disabled || isPreparingMedia}
				onclick={() => photoInput?.click()}
				aria-label="Send a photo or video"
				data-testid="photo-btn"
			>
				<Camera class="h-4 w-4" />
			</Button>
		{/if}
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
			class="border-input bg-background selection:bg-primary dark:bg-input/30 selection:text-primary-foreground ring-offset-background placeholder:font-sans placeholder:text-sm placeholder:not-italic placeholder:text-muted-foreground prose-ink flex min-h-11 max-h-40 w-full min-w-0 flex-1 resize-none rounded-md border px-3 py-2 italic text-draft shadow-xs transition-[color,box-shadow] outline-none disabled:cursor-not-allowed disabled:opacity-50 focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
			data-testid="message-input"
		></textarea>
		{#if onSendMedia && !message.trim()}
			<Button
				variant="ghost"
				size="icon"
				class="h-11 w-11 shrink-0 text-muted-foreground"
				disabled={disabled || isPreparingMedia}
				onclick={toggleVoice}
				aria-label="Record a voice note"
				data-testid="voice-btn"
			>
				<Mic class="h-4 w-4" />
			</Button>
		{/if}
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
	{/if}
</div>
