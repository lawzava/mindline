<script lang="ts">
	import * as Popover from '$lib/components/ui/popover';
	import { Badge } from '$lib/components/ui/badge';
	import { connectedPeers, peerNames, connectionStatus } from '$lib/stores';
	import { Users, User, Circle } from 'lucide-svelte';

	// Get name for a peer ID
	function getPeerDisplayName(peerId: string): string {
		const name = $peerNames.get(peerId);
		return name || `Peer ${peerId.slice(0, 8)}...`;
	}
</script>

{#if $connectionStatus === 'connected'}
	<Popover.Root>
		<Popover.Trigger>
			{#if $connectedPeers.length > 0}
				<Badge
					variant="secondary"
					class="flex h-11 cursor-pointer items-center gap-2 rounded-full px-3 transition-colors hover:bg-secondary/80 motion-reduce:transition-none"
					data-testid="peer-count"
				>
					<Users class="h-4 w-4" />
					<span>{$connectedPeers.length} peer{$connectedPeers.length !== 1 ? 's' : ''}</span>
				</Badge>
			{:else}
				<Badge
					variant="outline"
					class="flex h-11 cursor-pointer items-center gap-2 rounded-full border-dashed px-3 text-muted-foreground transition-colors hover:bg-muted/60 motion-reduce:transition-none"
					data-testid="peer-count"
				>
					<Users class="h-4 w-4" />
					<span>Waiting for peers</span>
				</Badge>
			{/if}
		</Popover.Trigger>
		<Popover.Content class="w-72 rounded-2xl p-3" side="bottom" align="start" data-testid="peer-list">
			<div class="space-y-3">
				<div class="flex items-center gap-2 border-b border-border pb-3">
					<div class="rounded-full bg-muted p-2">
						<Users class="h-4 w-4 text-muted-foreground" />
					</div>
					<div>
						<p class="text-sm font-medium">Connected peers</p>
						<p class="text-xs text-muted-foreground">People syncing with this room now.</p>
					</div>
				</div>

				{#if $connectedPeers.length > 0}
					<div class="max-h-48 space-y-1 overflow-y-auto">
						{#each $connectedPeers as peerId (peerId)}
							<div
								class="flex items-center gap-2 rounded-xl px-2 py-2 transition-colors hover:bg-muted/60 motion-reduce:transition-none"
							>
								<Circle class="h-2 w-2 fill-green-500 text-green-500" />
								<User class="h-3.5 w-3.5 text-muted-foreground" />
								<span class="truncate text-sm">{getPeerDisplayName(peerId)}</span>
							</div>
						{/each}
					</div>
				{:else}
					<div class="rounded-2xl bg-muted/40 px-4 py-5 text-center text-sm text-muted-foreground">
						<p class="font-medium text-foreground">No peers connected yet</p>
						<p class="mt-2 text-xs leading-relaxed">
							Share this room deliberately. Anyone with the link can join.
						</p>
					</div>
				{/if}

				<div class="border-t border-border pt-3 text-xs text-muted-foreground">
					{$connectedPeers.length} active connection{$connectedPeers.length !== 1 ? 's' : ''}
				</div>
			</div>
		</Popover.Content>
	</Popover.Root>
{/if}
