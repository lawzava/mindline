<script lang="ts">
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import type { VerifyStatus } from '$lib/stores/verified';
	import InviteQr from '$lib/components/InviteQr.svelte';
	import { compareScanned, safetyQrText } from '$lib/safety-qr';
	import { startScan, type Scan } from '$lib/qr-scan';

	interface Props {
		open: boolean;
		name: string;
		number: string | null;
		status: VerifyStatus;
		onVerify: () => void;
		onUnverify: () => void;
	}

	let { open = $bindable(false), name, number, status, onVerify, onUnverify }: Props = $props();

	// Show the number as a code, or read theirs with the camera (§1.3).
	let showQr = $state(false);
	let scanning = $state(false);
	let scanResult = $state<'match' | 'mismatch' | 'no-camera' | null>(null);
	let video = $state<HTMLVideoElement | null>(null);
	let scan: Scan | null = null;

	function stopScan() {
		scan?.stop();
		scan = null;
		scanning = false;
	}

	async function startScanning() {
		if (!number) return;
		const own = number;
		scanResult = null;
		showQr = false;
		scanning = true;
		await Promise.resolve(); // let the video element render
		if (!video) return;
		try {
			scan = await startScan(video, (text) => {
				const result = compareScanned(text, own);
				if (result === 'invalid') return false; // some other code: keep looking
				scanResult = result;
				scanning = false;
				if (result === 'match' && status !== 'verified') onVerify();
				return true;
			});
		} catch {
			scanning = false;
			scanResult = 'no-camera';
		}
	}

	// Closing the dialog always releases the camera.
	$effect(() => {
		if (!open) {
			stopScan();
			showQr = false;
			scanResult = null;
		}
	});

	// Three rows of four groups, the way people read numbers aloud.
	const rows = $derived.by(() => {
		const groups = number?.split(' ') ?? [];
		return [groups.slice(0, 4), groups.slice(4, 8), groups.slice(8, 12)];
	});
</script>

<AlertDialog.Root bind:open>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Safety number with {name}</AlertDialog.Title>
			<AlertDialog.Description>
				Compare this number with {name} in person or on a call. If it matches on both screens, you are
				talking to their device and nobody is in between. It changes if their device keys change.
			</AlertDialog.Description>
		</AlertDialog.Header>
		{#if number}
			<div
				class="rounded-lg bg-muted px-4 py-3 text-center font-mono text-lg tabular-nums leading-relaxed tracking-wider"
				data-testid="safety-number"
			>
				{#each rows as row, i (i)}
					<div>{row.join(' ')}</div>
				{/each}
			</div>
			<div class="flex flex-wrap justify-center gap-2">
				<button
					onclick={() => {
						stopScan();
						showQr = !showQr;
					}}
					aria-expanded={showQr}
					class="rounded-md px-3 py-2 text-sm underline underline-offset-2 hover:bg-accent"
					data-testid="safety-qr-toggle"
				>
					{showQr ? 'Hide QR code' : 'Show QR code'}
				</button>
				<button
					onclick={() => (scanning ? stopScan() : void startScanning())}
					class="rounded-md px-3 py-2 text-sm underline underline-offset-2 hover:bg-accent"
					data-testid="safety-scan-btn"
				>
					{scanning ? 'Stop scanning' : 'Scan their code'}
				</button>
			</div>
			{#if showQr}
				<div class="flex justify-center">
					<InviteQr
						value={safetyQrText(number)}
						label="QR code of the safety number"
						testid="safety-qr"
						class="w-52"
					/>
				</div>
			{/if}
			{#if scanning}
				<!-- svelte-ignore a11y_media_has_caption -->
				<video
					bind:this={video}
					playsinline
					class="mx-auto aspect-square w-52 rounded-md bg-muted object-cover"
					data-testid="safety-scan-video"
				></video>
				<p class="text-center text-xs text-muted-foreground">
					Point the camera at the code on {name}'s screen.
				</p>
			{/if}
			{#if scanResult === 'match'}
				<p
					class="text-sm font-medium text-foreground"
					role="status"
					data-testid="safety-scan-match"
				>
					The codes match. {name}'s device is verified.
				</p>
			{:else if scanResult === 'mismatch'}
				<p class="text-sm text-destructive" role="alert" data-testid="safety-scan-mismatch">
					These codes do not match. You may not be talking to {name}'s device, or someone is in
					between. Do not mark it as verified.
				</p>
			{:else if scanResult === 'no-camera'}
				<p class="text-sm text-muted-foreground" role="status">
					The camera is not available. Compare the numbers instead.
				</p>
			{/if}
		{:else}
			<p class="text-sm text-muted-foreground">
				The safety number appears once {name} is connected directly.
			</p>
		{/if}
		{#if status === 'changed'}
			<p class="text-sm text-destructive">
				{name}'s keys changed since you verified them. Compare the number again before trusting this
				device.
			</p>
		{/if}
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Close</AlertDialog.Cancel>
			{#if status === 'verified'}
				<AlertDialog.Action
					onclick={() => {
						onUnverify();
						open = false;
					}}>Clear verification</AlertDialog.Action
				>
			{:else if number}
				<AlertDialog.Action
					onclick={() => {
						onVerify();
						open = false;
					}}>Mark as verified</AlertDialog.Action
				>
			{/if}
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
