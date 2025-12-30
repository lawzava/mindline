<script lang="ts">
	import '../app.css';
	import { AppShell } from '$lib/components/layout';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
		rel="stylesheet"
	/>
	<title>Mindline</title>
	<meta name="description" content="Real-time P2P chat with radical transparency" />
</svelte:head>

<AppShell>
	{@render children()}
</AppShell>
