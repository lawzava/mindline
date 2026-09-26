<script lang="ts">
	import { Lock } from 'lucide-svelte';
	import { Button } from '$lib/components/ui/button';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import { removeAllRoomsAndLock, unlockWithPasskey } from '$lib/stores/lock';

	// Shown instead of the app while this device is locked (PROTOCOL.md §4).
	let busy = $state(false);
	let error = $state<string | null>(null);
	let showForget = $state(false);

	async function unlockNow() {
		busy = true;
		error = null;
		try {
			if (!(await unlockWithPasskey())) error = 'That passkey is not the one that locked Mindline.';
		} catch (e) {
			error = e instanceof Error ? e.message : 'The passkey was not used.';
		} finally {
			busy = false;
		}
	}

	async function forget() {
		busy = true;
		try {
			await removeAllRoomsAndLock();
		} catch {
			error = 'Some rooms could not be removed. Try again.';
		} finally {
			busy = false;
		}
	}
</script>

<div class="flex flex-1 items-center justify-center p-6" data-testid="lock-gate">
	<div class="flex max-w-xs flex-col items-center gap-4 text-center">
		<span class="grid h-12 w-12 place-items-center rounded-full bg-muted" aria-hidden="true">
			<Lock class="h-5 w-5 text-muted-foreground" />
		</span>
		<h1 class="text-lg font-semibold">Mindline is locked</h1>
		<p class="text-sm text-muted-foreground">Use your passkey to open your rooms on this device.</p>
		<Button onclick={unlockNow} disabled={busy} class="h-11 px-6" data-testid="unlock-btn">
			Unlock
		</Button>
		{#if error}
			<p class="text-sm text-destructive" role="alert" data-testid="unlock-error">{error}</p>
		{/if}
		<button
			onclick={() => (showForget = true)}
			class="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
		>
			Lost the passkey?
		</button>
	</div>
</div>

<AlertDialog.Root bind:open={showForget}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Remove every room from this device?</AlertDialog.Title>
			<AlertDialog.Description>
				Without the passkey, the rooms saved here cannot be opened. Removing them deletes their
				messages, media, and keys from this device and turns the lock off. Other people keep their
				copies, and you can rejoin any room with its invite link.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action
				onclick={forget}
				class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
				data-testid="forget-lock-btn"
			>
				Remove rooms
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
