<script lang="ts">
	import '../app.css';
	import { AppShell } from '$lib/components/layout';
	import { ModeWatcher } from 'mode-watcher';

	let { children } = $props();
</script>

<svelte:head>
	<title>Mindline</title>
	<meta name="description" content="Private P2P chat where you see each other type" />
</svelte:head>

<ModeWatcher />
<AppShell>
	{@render children()}
</AppShell>
