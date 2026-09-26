<script lang="ts">
	import { version } from '$app/environment';
	import { verifyThisBuild, type BuildCheck } from '$lib/verify-build';

	// Opt-in: checking asks GitHub for the published list (PRIVACY.md).
	let status = $state<'idle' | 'checking' | 'done' | 'error'>('idle');
	let result = $state<BuildCheck | null>(null);
	let error = $state('');

	async function check() {
		status = 'checking';
		try {
			result = await verifyThisBuild(version);
			status = 'done';
		} catch (e) {
			error = e instanceof Error ? e.message : 'The check could not run.';
			status = 'error';
		}
	}
</script>

<span data-testid="code-check">
	{#if status === 'idle'}
		<button
			onclick={check}
			title="Compares the files this site serves with the build published for this commit. Asks GitHub for the list."
			class="underline underline-offset-2 hover:text-foreground"
			data-testid="code-check-btn">check it now</button
		>
	{:else if status === 'checking'}
		checking…
	{:else if status === 'done' && result?.ok}
		<span class="text-foreground" role="status" data-testid="code-check-ok"
			>all {result.checked} bundle files match the published build (checked by this page)</span
		>
	{:else if status === 'done'}
		<span class="text-destructive" role="alert" data-testid="code-check-fail"
			>{result?.mismatches.length} file(s) differ from the published build</span
		>
	{:else}
		<span role="status" data-testid="code-check-error">{error}</span>
	{/if}
</span>
