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
					class="flex h-11 cursor-pointer items-center gap-1.5 px-3 transition-colors hover:bg-secondary/80"
					data-testid="peer-count"
				>
					<Users class="h-4 w-4" />
					<span>{$connectedPeers.length} peer{$connectedPeers.length !== 1 ? 's' : ''}</span>
				</Badge>
			{:else}
				<Badge
					variant="outline"
					class="flex h-11 cursor-pointer items-center gap-1.5 px-3 text-muted-foreground"
					data-testid="peer-count"
				>
					<Users class="h-4 w-4" />
					<span>Waiting for peers...</span>
				</Badge>
			{/if}
		</Popover.Trigger>
		<Popover.Content class="w-64 p-2" side="bottom" align="start" data-testid="peer-list">
			<div class="space-y-2">
				<div class="flex items-center gap-2 border-b border-border pb-2">
					<Users class="h-4 w-4 text-muted-foreground" />
					<span class="text-sm font-medium">Connected Peers</span>
				</div>

				{#if $connectedPeers.length > 0}
					<div class="max-h-48 space-y-1 overflow-y-auto">
						{#each $connectedPeers as peerId (peerId)}
							<div
								class="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50"
							>
								<Circle class="h-2 w-2 fill-green-500 text-green-500" />
								<User class="h-3.5 w-3.5 text-muted-foreground" />
								<span class="truncate text-sm">{getPeerDisplayName(peerId)}</span>
							</div>
						{/each}
					</div>
				{:else}
					<div class="py-4 text-center text-sm text-muted-foreground">
						<p>No peers connected yet</p>
						<p class="mt-1 text-xs">Share this room to invite others</p>
					</div>
				{/if}

				<div class="border-t border-border pt-2 text-xs text-muted-foreground">
					{$connectedPeers.length} active connection{$connectedPeers.length !== 1 ? 's' : ''}
				</div>
			</div>
		</Popover.Content>
	</Popover.Root>
{/if}
