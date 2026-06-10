<script lang="ts">
	import { onDestroy } from 'svelte';
	import { getBlob } from '$lib/media/blob-store';
	import { getRoomKeys } from '$lib/p2p';
	import { transfers } from '$lib/stores';
	import type { MessageAttachment } from '$lib/types/message';
	import { Download, FileIcon, Loader2, TriangleAlert } from 'lucide-svelte';

	interface Props {
		attachment: MessageAttachment;
		roomId: string;
	}

	let { attachment, roomId }: Props = $props();

	let objectUrl = $state<string | null>(null);
	let loadFailed = $state(false);

	const progress = $derived($transfers.get(attachment.transferId) ?? null);
	const percent = $derived(
		progress && progress.bytesTotal > 0
			? Math.round((progress.bytesDone / progress.bytesTotal) * 100)
			: 0
	);
	const isReady = $derived(attachment.state === 'ready' || attachment.state === 'local');
	const isFailed = $derived(attachment.state === 'failed');

	$effect(() => {
		if (!isReady || objectUrl) return;
		void (async () => {
			try {
				const keys = getRoomKeys();
				if (!keys) return;
				const blob = await getBlob(keys, roomId, attachment.transferId);
				if (!blob) return;
				objectUrl = URL.createObjectURL(new Blob([blob.data as BufferSource], { type: blob.mime }));
			} catch (error) {
				console.warn('attachment load failed:', error);
				loadFailed = true;
			}
		})();
	});

	onDestroy(() => {
		if (objectUrl) URL.revokeObjectURL(objectUrl);
	});

	function formatSize(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
		return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
	}

	function formatDuration(seconds = 0): string {
		const m = Math.floor(seconds / 60);
		const s = Math.round(seconds % 60);
		return `${m}:${String(s).padStart(2, '0')}`;
	}
</script>

<div class="max-w-xs" data-testid="media-attachment" data-state={attachment.state}>
	{#if isFailed}
		<div class="flex items-center gap-2 rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive">
			<TriangleAlert class="h-4 w-4 shrink-0" />
			<span>Transfer failed: {attachment.name}</span>
		</div>
	{:else if !isReady}
		<div class="space-y-1.5 rounded-md border border-border px-3 py-2">
			{#if attachment.kind === 'image' && attachment.thumb}
				<img
					src={`data:${attachment.thumbMime ?? 'image/jpeg'};base64,${attachment.thumb}`}
					alt={attachment.name}
					class="h-28 w-full rounded object-cover blur-[6px]"
				/>
			{/if}
			<div class="flex items-center gap-2 text-sm text-muted-foreground">
				<Loader2 class="h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none" />
				<span class="truncate">{attachment.name}</span>
				<span class="ml-auto tabular-nums">{percent}%</span>
			</div>
			<div class="h-1 overflow-hidden rounded-full bg-muted">
				<div class="h-full rounded-full bg-primary transition-[width]" style="width: {percent}%"></div>
			</div>
		</div>
	{:else if attachment.kind === 'image'}
		{#if objectUrl}
			<img
				src={objectUrl}
				alt={attachment.name}
				class="max-h-80 w-full rounded-md object-contain"
				data-testid="media-image"
			/>
		{:else if attachment.thumb}
			<img
				src={`data:${attachment.thumbMime ?? 'image/jpeg'};base64,${attachment.thumb}`}
				alt={attachment.name}
				class="h-28 w-full rounded-md object-cover blur-[6px]"
			/>
		{/if}
	{:else if attachment.kind === 'voice'}
		{#if objectUrl}
			<div class="flex items-center gap-2">
				<audio controls src={objectUrl} class="h-10 max-w-full" data-testid="media-audio"></audio>
				<span class="text-xs tabular-nums text-muted-foreground">{formatDuration(attachment.duration)}</span>
			</div>
		{/if}
	{:else if attachment.kind === 'video'}
		{#if objectUrl}
			<!-- svelte-ignore a11y_media_has_caption -->
			<video controls src={objectUrl} class="max-h-80 w-full rounded-md" data-testid="media-video"></video>
		{/if}
	{:else}
		<a
			href={objectUrl ?? '#'}
			download={attachment.name}
			class="flex items-center gap-3 rounded-md border border-border px-3 py-2 hover:bg-muted/60 transition-colors"
			class:pointer-events-none={!objectUrl}
			data-testid="media-file"
		>
			<FileIcon class="h-8 w-8 shrink-0 text-muted-foreground" />
			<span class="min-w-0">
				<span class="block truncate text-sm">{attachment.name}</span>
				<span class="block text-xs text-muted-foreground">{formatSize(attachment.size)}</span>
			</span>
			<Download class="ml-auto h-4 w-4 shrink-0 text-muted-foreground" />
		</a>
	{/if}
	{#if loadFailed}
		<p class="mt-1 text-xs text-destructive">Stored copy unavailable on this device.</p>
	{/if}
</div>
