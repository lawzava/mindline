<script lang="ts">
	import { goto } from '$app/navigation';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { user } from '$lib/stores';
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
</script>

<svelte:head>
	<title>Mindline</title>
</svelte:head>

<div class="flex flex-1 items-center justify-center p-4">
	<Card class="w-full max-w-md">
		<CardHeader class="text-center">
			<CardTitle class="text-3xl font-bold">Welcome to Mindline</CardTitle>
			<CardDescription>
				Real-time P2P chat with radical transparency.<br />
				See messages as they're typed.
			</CardDescription>
		</CardHeader>
		<CardContent class="space-y-6">
			<!-- Create Room -->
			<Button onclick={createRoom} class="w-full h-11" size="lg" data-testid="create-room-btn">
				<Plus class="mr-2 h-5 w-5" />
				Create New Room
			</Button>

			<!-- Divider -->
			<div class="relative">
				<div class="absolute inset-0 flex items-center">
					<span class="w-full border-t border-border"></span>
				</div>
				<div class="relative flex justify-center text-xs uppercase">
					<span class="bg-card px-2 text-muted-foreground">or join existing</span>
				</div>
			</div>

			<!-- Join Room -->
			<div class="flex gap-2">
				<Input
					type="text"
					placeholder="Paste invite link or room ID..."
					bind:value={joinRoomId}
					onkeydown={handleKeydown}
					class="flex-1"
					data-testid="join-room-input"
				/>
				<Button
					onclick={joinRoom}
					disabled={!extractRoomId(joinRoomId)}
					size="icon"
					class="h-11 w-11"
					data-testid="join-room-btn"
				>
					<ArrowRight class="h-4 w-4" />
					<span class="sr-only">Join room</span>
				</Button>
			</div>
		</CardContent>
	</Card>
</div>
