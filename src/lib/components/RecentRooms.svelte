<script lang="ts">
	import { goto } from '$app/navigation';
	import { recentRooms, user, type RecentRoom } from '$lib/stores';
	import { senderHue } from '$lib/utils';
	import { Input } from '$lib/components/ui/input';
	import { Pencil, X, Check, CornerUpLeft } from 'lucide-svelte';

	let editingId = $state<string | null>(null);
	let editValue = $state('');
	let editRef = $state<HTMLInputElement | null>(null);

	function ensureUser() {
		if (!$user.initialized) {
			user.initialize($user.name || 'Anonymous', crypto.randomUUID());
		}
	}

	function rejoin(room: RecentRoom) {
		if (editingId) return;
		ensureUser();
		// The key fragment is the room's read capability; carry it when we have
		// it. Without it we still try — the on-device keystore may hold the keys.
		const fragment = room.key ? `#${room.key}` : '';
		goto(`/${room.id}${fragment}`);
	}

	function startEdit(room: RecentRoom, event: Event) {
		event.stopPropagation();
		editingId = room.id;
		editValue = room.name;
		queueMicrotask(() => editRef?.focus());
	}

	function saveEdit(id: string) {
		recentRooms.rename(id, editValue);
		editingId = null;
	}

	function cancelEdit() {
		editingId = null;
		editValue = '';
	}

	function remove(id: string, event: Event) {
		event.stopPropagation();
		if (editingId === id) editingId = null;
		recentRooms.remove(id);
	}

	function label(room: RecentRoom): string {
		return room.name || `Room ${room.id.slice(0, 8)}`;
	}

	function initial(room: RecentRoom): string {
		return label(room).trim().charAt(0).toUpperCase() || '#';
	}

	function relativeTime(ts: number): string {
		const minutes = Math.floor((Date.now() - ts) / 60000);
		if (minutes < 1) return 'just now';
		if (minutes < 60) return `${minutes}m ago`;
		const hours = Math.floor(minutes / 60);
		if (hours < 24) return `${hours}h ago`;
		const days = Math.floor(hours / 24);
		if (days < 7) return `${days}d ago`;
		return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });
	}

	function rowKeydown(room: RecentRoom, event: KeyboardEvent) {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			rejoin(room);
		}
	}
</script>

<ul class="space-y-1.5" data-testid="recent-rooms">
	{#each $recentRooms as room (room.id)}
		<li>
			<div
				role="button"
				tabindex="0"
				onclick={() => rejoin(room)}
				onkeydown={(e) => rowKeydown(room, e)}
				class="group flex items-center gap-3 rounded-[0.875rem] border border-border/70 bg-card px-2.5 py-2 text-left outline-ring/50 transition-colors hover:border-border hover:bg-accent/60"
				data-testid="recent-room"
			>
				<!-- Per-room tinted monogram, same shade language as chat bylines -->
				<span
					class="peer-shade peer-name grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-semibold"
					style={`--u-hue:${senderHue(room.id)}`}
					aria-hidden="true"
				>
					{initial(room)}
				</span>

				{#if editingId === room.id}
					<Input
						bind:ref={editRef}
						bind:value={editValue}
						class="h-9 flex-1"
						placeholder="Name this room"
						aria-label="Room name"
						onclick={(e) => e.stopPropagation()}
						onkeydown={(e) => {
							e.stopPropagation();
							if (e.key === 'Enter') saveEdit(room.id);
							if (e.key === 'Escape') cancelEdit();
						}}
					/>
					<button
						onclick={(e) => {
							e.stopPropagation();
							saveEdit(room.id);
						}}
						class="grid h-8 w-8 shrink-0 place-items-center rounded-md text-primary hover:bg-accent"
						aria-label="Save room name"
					>
						<Check class="h-4 w-4" />
					</button>
					<button
						onclick={(e) => {
							e.stopPropagation();
							cancelEdit();
						}}
						class="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent"
						aria-label="Cancel rename"
					>
						<X class="h-4 w-4" />
					</button>
				{:else}
					<div class="min-w-0 flex-1">
						<div class="truncate text-sm font-medium">{label(room)}</div>
						<div class="truncate text-xs text-muted-foreground">
							{relativeTime(room.lastActive)}{room.key ? '' : ' · link needed'}
						</div>
					</div>
					<button
						onclick={(e) => startEdit(room, e)}
						class="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
						aria-label="Rename room"
					>
						<Pencil class="h-3.5 w-3.5" />
					</button>
					<button
						onclick={(e) => remove(room.id, e)}
						class="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
						aria-label="Remove room from this list"
					>
						<X class="h-4 w-4" />
					</button>
					<CornerUpLeft
						class="h-4 w-4 shrink-0 text-muted-foreground/70 transition-transform group-hover:-translate-x-0.5"
						aria-hidden="true"
					/>
				{/if}
			</div>
		</li>
	{/each}
</ul>
