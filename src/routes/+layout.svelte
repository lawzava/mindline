<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { AppShell } from '$lib/components/layout';
	import { ModeWatcher } from 'mode-watcher';
	import { migrateLegacyPlaintext } from '$lib/storage/messages';

	let { children } = $props();

	onMount(() => {
		// Encrypt any pre-v3 plaintext history at rest (PROTOCOL.md §4).
		void migrateLegacyPlaintext();
	});
</script>

<svelte:head>
	<title>Mindline</title>
	<meta name="description" content="Private P2P chat where you see each other type" />
</svelte:head>

<ModeWatcher />
<AppShell>
	{@render children()}
</AppShell>
