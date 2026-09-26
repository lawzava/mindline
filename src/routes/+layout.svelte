<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { AppShell } from '$lib/components/layout';
	import { ModeWatcher } from 'mode-watcher';
	import { migrateLegacyPlaintext } from '$lib/storage/messages';
	import { recentRooms } from '$lib/stores/recent-rooms';
	import { reading, applyReading } from '$lib/stores/reading';
	import { saveInviteKey } from '$lib/crypto/keystore';
	import { parseKeyFragment } from '$lib/crypto/keys';
	import LockGate from '$lib/components/LockGate.svelte';
	import { deviceLock, lockReady } from '$lib/stores/lock';

	let { children } = $props();

	// Reading settings (text size, contrast) live as attributes on <html>.
	// Applied at hydration, before the app mounts, and on every change.
	// Returning readers with a non-default setting see one brief frame of
	// the defaults: the server cannot know a localStorage value, and an
	// inline pre-paint script would need its own CSP hash.
	$effect.pre(() => {
		applyReading($reading, document.documentElement);
	});

	onMount(() => {
		void lockReady();
		// Encrypt any pre-v3 plaintext history at rest (PROTOCOL.md §4).
		migrateLegacyPlaintext().catch((error) => {
			console.error('[storage] legacy history migration sweep failed:', error);
		});
		// Older versions kept plaintext link keys in Recent rooms. Move each
		// into its room's keystore record (wrapped) and drop the plaintext.
		// A key whose room is no longer on the device stays: it is the only
		// way back in.
		void (async () => {
			for (const { id, key } of recentRooms.legacyKeys()) {
				const raw = parseKeyFragment(key);
				try {
					if (raw && (await saveInviteKey(id, raw))) recentRooms.forgetKey(id);
				} catch (error) {
					console.warn('[storage] legacy invite key migration failed:', error);
				}
			}
		})();
	});
</script>

<svelte:head>
	<title>Mindline</title>
	<meta name="description" content="Private P2P chat where you see each other type" />
</svelte:head>

<ModeWatcher />
<AppShell>
	<!-- A locked device shows only the lock until the passkey opens it (§4). -->
	{#if $deviceLock === 'locked'}
		<LockGate />
	{:else}
		{@render children()}
	{/if}
</AppShell>
