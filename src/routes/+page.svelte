<script lang="ts">
	import { goto } from '$app/navigation';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { user } from '$lib/stores';
	import { wasm, isWasmReady } from '$lib/wasm';
	import { Plus, ArrowRight } from 'lucide-svelte';

	let joinRoomId = $state('');

	async function createRoom() {
		if (!isWasmReady()) return;

		// Ensure user is initialized
		if (!$user.initialized) {
			const userId = wasm.generateUuid();
			const name = $user.name || 'Anonymous';
			wasm.initialize(name, userId);
			user.initialize(name, userId);
		}

		// Generate room ID and create room
		const roomId = wasm.generateUuid();
		wasm.createRoom(roomId);

		// Navigate to room
		await goto(`/${roomId}`);
	}

	async function joinRoom() {
		if (!isWasmReady() || !joinRoomId.trim()) return;

		// Ensure user is initialized
		if (!$user.initialized) {
			const userId = wasm.generateUuid();
			const name = $user.name || 'Anonymous';
			wasm.initialize(name, userId);
			user.initialize(name, userId);
		}

		// Navigate to room
		await goto(`/${joinRoomId.trim()}`);
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			joinRoom();
		}
	}
</script>

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
			<Button onclick={createRoom} class="w-full" size="lg">
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
					placeholder="Enter room ID..."
					bind:value={joinRoomId}
					onkeydown={handleKeydown}
					class="flex-1"
				/>
				<Button onclick={joinRoom} disabled={!joinRoomId.trim()} size="icon">
					<ArrowRight class="h-4 w-4" />
					<span class="sr-only">Join room</span>
				</Button>
			</div>
		</CardContent>
	</Card>
</div>
