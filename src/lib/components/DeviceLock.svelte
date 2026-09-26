<script lang="ts">
	import { onMount } from 'svelte';
	import { Lock } from 'lucide-svelte';
	import { toast } from 'svelte-sonner';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import { passkeySupported } from '$lib/passkey';
	import {
		deviceLock,
		lockAgain,
		lockReady,
		roomsWithoutLink,
		turnOffLock,
		turnOnLock
	} from '$lib/stores/lock';

	// The start page's control for the passkey lock (PROTOCOL.md §4).
	let supported = $state(false);
	let busy = $state(false);
	let showConfirm = $state(false);
	let orphans = $state(0);

	onMount(() => {
		void passkeySupported().then((ok) => (supported = ok));
		void lockReady();
	});

	async function askToLock() {
		orphans = (await roomsWithoutLink()).length;
		showConfirm = true;
	}

	async function run(action: () => Promise<void>, failure: string) {
		busy = true;
		try {
			await action();
		} catch (e) {
			toast.error(e instanceof Error && e.name === 'PasskeyError' ? e.message : failure);
		} finally {
			busy = false;
		}
	}
</script>

{#if supported && ($deviceLock === 'off' || $deviceLock === 'unlocked')}
	<div class="flex items-center gap-2 px-1 text-xs text-muted-foreground" data-testid="device-lock">
		<Lock class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
		{#if $deviceLock === 'off'}
			<button
				onclick={askToLock}
				disabled={busy}
				class="underline underline-offset-2 hover:text-foreground"
				data-testid="lock-on-btn"
			>
				Lock Mindline with a passkey
			</button>
		{:else}
			<span data-testid="lock-status">Locked with a passkey</span> ·
			<button
				onclick={lockAgain}
				class="underline underline-offset-2 hover:text-foreground"
				data-testid="lock-now-btn">Lock now</button
			>
			·
			<button
				onclick={() => run(turnOffLock, 'The lock could not be turned off.')}
				disabled={busy}
				class="underline underline-offset-2 hover:text-foreground"
				data-testid="lock-off-btn">Turn off</button
			>
		{/if}
	</div>
{/if}

<AlertDialog.Root bind:open={showConfirm}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Lock Mindline with a passkey?</AlertDialog.Title>
			<AlertDialog.Description>
				Each time Mindline opens on this device, it will ask for the passkey (fingerprint, face, or
				PIN). Without it, nobody holding this device can open your rooms. If you lose the passkey,
				you can remove the rooms and rejoin them with their invite links. Links you opened before
				may still be in this browser's history: clear it to remove them.
				{#if orphans > 0}
					<strong class="mt-2 block text-foreground" data-testid="lock-orphans">
						{orphans === 1 ? '1 older room' : `${orphans} older rooms`} on this device
						{orphans === 1 ? 'has' : 'have'} no saved invite link and will be removed.
					</strong>
				{/if}
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action
				onclick={() => {
					// Closed first: the passkey prompt takes focus from the dialog.
					showConfirm = false;
					void run(turnOnLock, 'The lock could not be turned on.');
				}}
				data-testid="lock-confirm-btn"
			>
				Make a passkey
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
