<script lang="ts">
	import { goto } from '$app/navigation';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { user } from '$lib/stores';
	import { wasm, isWasmReady } from '$lib/wasm';
	import { Plus, ArrowRight } from 'lucide-svelte';

	let joinRoomId = $state('');

	function extractRoomId(input: string): string {
		const trimmed = input.trim();
		if (!trimmed) return '';

		// Handle full URLs (e.g. https://mindline.chat/<roomId>)
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

		return trimmed;
	}

	async function createRoom() {
		if (!isWasmReady()) return;

		// Ensure user is initialized
		if (!$user.initialized) {
			const userId = wasm.generateUuid();
			const name = $user.name || 'Anonymous';
			wasm.initialize(name, userId);
			wasm.setMessageManagerUser(userId);
			user.initialize(name, userId);
		}

		// Generate room ID and create room
		const roomId = wasm.generateUuid();
		wasm.createRoom(roomId);

		// Navigate to room
		await goto(`/${roomId}`);
	}

	async function joinRoom() {
		const room = extractRoomId(joinRoomId);
		if (!isWasmReady() || !room) return;

		// Ensure user is initialized
		if (!$user.initialized) {
			const userId = wasm.generateUuid();
			const name = $user.name || 'Anonymous';
			wasm.initialize(name, userId);
			wasm.setMessageManagerUser(userId);
			user.initialize(name, userId);
		}

		// Navigate to room
		await goto(`/${room}`);
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

<div class="flex flex-1 bg-background">
	<section class="mx-auto grid w-full max-w-6xl gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:px-8 lg:py-16">
		<div class="space-y-8">
			<div class="max-w-3xl space-y-5">
				<p class="text-sm font-semibold uppercase tracking-[0.22em] text-live">Private rooms</p>
				<h1 class="text-5xl font-bold tracking-[-0.06em] text-foreground sm:text-6xl lg:text-7xl">
					Mindline
				</h1>
				<div class="space-y-4">
					<h2 class="text-2xl font-semibold tracking-[-0.03em] text-foreground sm:text-3xl">
						Private rooms for live thoughts.
					</h2>
					<p class="max-w-2xl text-lg leading-8 text-muted-foreground">
						P2P chat for privacy-first teams where drafts are visible while they are being
						written, and connection state tells you what is actually syncing.
					</p>
				</div>
			</div>

			<div class="max-w-2xl space-y-3">
				<div class="rounded-[2rem] border border-live/35 bg-surface-warm p-6 shadow-xs">
					<p class="text-xs font-semibold uppercase tracking-[0.2em] text-live">Live draft rule</p>
					<p class="mt-4 text-2xl font-semibold tracking-[-0.03em] text-foreground">
						Drafts are live while you type.
					</p>
				</div>
				<div class="ml-0 grid gap-3 sm:ml-10">
					<div class="flex items-center gap-3 rounded-2xl border border-border bg-surface-quiet px-4 py-3 text-sm leading-6 text-foreground shadow-xs">
						<span class="h-2 w-2 shrink-0 rounded-full bg-local"></span>
						<span>Anyone with a room link can join.</span>
					</div>
					<div class="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-sm leading-6 text-foreground shadow-xs">
						<span class="h-2 w-2 shrink-0 rounded-full bg-success"></span>
						<span>Messages sync with peers when connected.</span>
					</div>
				</div>
			</div>
		</div>

		<Card class="border-border bg-card shadow-sm">
			<CardHeader class="space-y-2">
				<CardTitle class="text-2xl tracking-[-0.03em]">Open a room</CardTitle>
				<CardDescription class="text-base leading-7">
					Create a private room or paste an invite. No account needed.
				</CardDescription>
			</CardHeader>
			<CardContent class="space-y-5">
				<Button onclick={createRoom} class="h-12 w-full" size="lg" data-testid="create-room-btn">
					<Plus class="mr-2 h-5 w-5" />
					Create room
				</Button>

				<div class="flex gap-2">
					<Input
						type="text"
						aria-label="Invite link or room ID"
						placeholder="Paste invite link or room ID"
						bind:value={joinRoomId}
						onkeydown={handleKeydown}
						class="h-12 flex-1 bg-surface-quiet"
						data-testid="join-room-input"
					/>
					<Button
						onclick={joinRoom}
						disabled={!extractRoomId(joinRoomId)}
						size="icon"
						class="h-12 w-12 shrink-0"
						data-testid="join-room-btn"
					>
						<ArrowRight class="h-4 w-4" />
						<span class="sr-only">Join room</span>
					</Button>
				</div>
			</CardContent>
		</Card>
	</section>
</div>
