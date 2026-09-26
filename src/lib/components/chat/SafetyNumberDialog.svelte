<script lang="ts">
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import type { VerifyStatus } from '$lib/stores/verified';

	interface Props {
		open: boolean;
		name: string;
		number: string | null;
		status: VerifyStatus;
		onVerify: () => void;
		onUnverify: () => void;
	}

	let { open = $bindable(false), name, number, status, onVerify, onUnverify }: Props = $props();

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
