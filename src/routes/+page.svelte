<script lang="ts">
	import { goto } from '$app/navigation';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { user } from '$lib/stores';
	import { onMount } from 'svelte';
	import { createRoomKey, toKeyFragment } from '$lib/crypto/keys';
	import { Plus, ArrowRight } from 'lucide-svelte';

	let joinRoomId = $state('');

	function extractRoomId(input: string): string {
		const trimmed = input.trim();
		if (!trimmed) return '';

		// Handle full URLs (e.g. https://mindline.chat/<roomId>#k=...)
		try {
			const url = new URL(trimmed);
			const last = url.pathname.split('/').filter(Boolean).pop();
			return (last ?? '').trim();
		} catch {
			// Not a full URL; fall through.
		}

		// Handle partial URLs without scheme (e.g. mindline.chat/<roomId>)
		if (trimmed.includes('/')) {
			const withoutQuery = trimmed.split(/[?#]/)[0];
			const last = withoutQuery.split('/').filter(Boolean).pop();
			return (last ?? '').trim();
		}

		// Bare room id, possibly with the key fragment pasted along
		return trimmed.split('#')[0];
	}

	/** Preserve a pasted '#k=...' so the join carries the room key. */
	function extractKeyFragment(input: string): string {
		const hashIndex = input.indexOf('#');
		if (hashIndex === -1) return '';
		const fragment = input.slice(hashIndex + 1).trim();
		return /^k=[A-Za-z0-9_-]+$/.test(fragment) ? `#${fragment}` : '';
	}

	function ensureUser() {
		if (!$user.initialized) {
			user.initialize($user.name || 'Anonymous', crypto.randomUUID());
		}
	}

	async function createRoom() {
		ensureUser();
		// The fragment carries the room key; it never reaches any server.
		await goto(`/${crypto.randomUUID()}#${toKeyFragment(createRoomKey())}`);
	}

	async function joinRoom() {
		const room = extractRoomId(joinRoomId);
		if (!room) return;

		ensureUser();
		const fragment = extractKeyFragment(joinRoomId);
		await goto(`/${room}${fragment}`);
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			joinRoom();
		}
	}

	// The promise, demonstrated instead of described: a sentence writes
	// itself in wet ink and dries to roman. Decoration only; it never
	// delays time-to-talking.
	const SPECIMEN = 'They see your words as you write them.';
	let typed = $state('');
	let dried = $state(false);
	// Buttons do nothing before hydration; rendering them disabled until
	// mount keeps tests and assistive tech honest about it.
	let ready = $state(false);

	onMount(() => {
		ready = true;
		if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
			typed = SPECIMEN;
			dried = true;
			return;
		}
		let i = 0;
		const tick = () => {
			i++;
			typed = SPECIMEN.slice(0, i);
			if (i < SPECIMEN.length) {
				timer = setTimeout(tick, 28 + Math.random() * 60);
			} else {
				timer = setTimeout(() => (dried = true), 700);
			}
		};
		let timer = setTimeout(tick, 600);
		return () => clearTimeout(timer);
	});
</script>

<svelte:head>
	<title>Mindline</title>
</svelte:head>

<div class="flex flex-1 items-start justify-center overflow-y-auto p-6 pt-[18vh] sm:items-center sm:pt-6">
	<div class="w-full max-w-md space-y-10">
		<!-- The promise as a live specimen -->
		<div class="space-y-3">
			<h2 class="text-3xl font-semibold tracking-tight sm:text-4xl">Talk on a live wire.</h2>
			<p class="prose-ink min-h-[1.6em] text-lg" aria-label="See messages as they are typed">
				{#if dried}
					<span class="ink-dry">{SPECIMEN}</span>
				{:else}
					<span class="italic text-draft">{typed}</span><span
						class="ml-0.5 inline-block h-[1.1em] w-px translate-y-[0.2em] bg-draft breathe"
					></span>
				{/if}
			</p>
			<p class="text-sm text-muted-foreground">
				Private rooms, end-to-end encrypted, nothing stored on servers. The invite link is the
				key.
			</p>
		</div>

		<!-- One action -->
		<div class="space-y-5">
			<Button
				onclick={createRoom}
				disabled={!ready}
				class="h-12 w-full text-base"
				size="lg"
				data-testid="create-room-btn"
			>
				<Plus class="mr-2 h-5 w-5" />
				Start a room
			</Button>

			<div class="flex items-center gap-3 text-xs uppercase tracking-[0.06em] text-muted-foreground">
				<span class="h-px flex-1 bg-border"></span>
				or join existing
				<span class="h-px flex-1 bg-border"></span>
			</div>

			<div class="flex gap-2">
				<Input
					type="text"
					placeholder="Paste an invite link..."
					bind:value={joinRoomId}
					onkeydown={handleKeydown}
					class="h-11 flex-1"
					data-testid="join-room-input"
				/>
				<Button
					onclick={joinRoom}
					disabled={!ready || !extractRoomId(joinRoomId)}
					size="icon"
					class="h-11 w-11"
					data-testid="join-room-btn"
				>
					<ArrowRight class="h-4 w-4" />
					<span class="sr-only">Join room</span>
				</Button>
			</div>
		</div>
	</div>
</div>
