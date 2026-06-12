<script lang="ts">
	import * as Popover from '$lib/components/ui/popover';
	import {
		connectionStatus,
		connectedPeers,
		peerNames,
		connectionError,
		isReconnecting as isReconnectingStore,
		reconnectionState,
		isSyncing,
		relayedPeers,
		rotationStranded
	} from '$lib/stores';
	import { reconnectP2P } from '$lib/p2p';
	import { Loader2, User } from 'lucide-svelte';
	import { toast } from 'svelte-sonner';
	import { cn } from '$lib/utils';

	// Presence-as-subtitle: a 6px dot plus one line of text replaces the old
	// pill cluster. Conventional status colors stay (green = connected,
	// amber = in flight); cobalt is reserved for "someone is writing".

	let isManualReconnecting = $state(false);

	function getPeerDisplayName(peerId: string): string {
		const name = $peerNames.get(peerId);
		return name || `Peer ${peerId.slice(0, 8)}...`;
	}

	const status = $derived.by(() => {
		if ($isReconnectingStore) {
			return {
				label: `Reconnecting (${$reconnectionState.attemptCount}/${$reconnectionState.maxAttempts})`,
				dot: 'bg-warning',
				pulse: true
			};
		}
		switch ($connectionStatus) {
			case 'connected': {
				const n = $connectedPeers.length;
				const relayed = $relayedPeers.length;
				// Relay honesty (§3.6): ciphertext transits the server; say so.
				if (relayed > 0) {
					return {
						label:
							relayed === n
								? 'Connected · relayed via server'
								: `Connected · ${relayed} of ${n} relayed via server`,
						dot: 'bg-warning',
						pulse: false
					};
				}
				return {
					label: n > 0 ? `Connected · ${n} peer${n !== 1 ? 's' : ''}` : 'Connected · just you',
					dot: 'bg-success',
					pulse: false
				};
			}
			case 'connecting':
				return { label: 'Connecting...', dot: 'bg-warning', pulse: true };
			case 'disconnected':
				return { label: 'Offline', dot: 'bg-muted-foreground', pulse: false };
			case 'failed':
				return { label: 'Connection failed', dot: 'bg-destructive', pulse: false };
			case 'local':
				return { label: 'Local · saved on this device', dot: 'bg-warning', pulse: false };
			default:
				return { label: 'Unknown', dot: 'bg-muted-foreground', pulse: false };
		}
	});

	const canReconnect = $derived(
		!$isReconnectingStore &&
			($connectionStatus === 'disconnected' ||
				$connectionStatus === 'failed' ||
				$connectionStatus === 'local')
	);

	async function handleReconnect() {
		isManualReconnecting = true;
		try {
			await reconnectP2P();
			toast.success('Reconnected successfully!');
		} catch (error) {
			console.error('Reconnection failed:', error);
			toast.error('Failed to reconnect');
		} finally {
			isManualReconnecting = false;
		}
	}
</script>

{#snippet subtitle()}
	<span class={cn('h-1.5 w-1.5 shrink-0 rounded-full', status.dot, status.pulse && 'breathe')}
	></span>
	<span class="truncate" data-testid="connection-status">{status.label}</span>
	{#if $isSyncing}
		<Loader2 class="h-3 w-3 shrink-0 animate-spin motion-reduce:animate-none" />
	{/if}
	{#if $connectionError}
		<span class="sr-only">{$connectionError}</span>
	{/if}
{/snippet}

<div class="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
	{#if $connectionStatus === 'connected'}
		<!-- The subtitle doubles as the peer list trigger -->
		<Popover.Root>
			<Popover.Trigger
				class="flex min-w-0 items-center gap-1.5 rounded-sm outline-ring/50 hover:text-foreground"
				data-testid="peer-count"
			>
				{@render subtitle()}
			</Popover.Trigger>
			<Popover.Content class="w-64 p-2" side="bottom" align="start" data-testid="peer-list">
				<div class="space-y-2">
					<span class="block border-b border-border pb-2 text-sm font-medium">In this room</span>
					{#if $connectedPeers.length > 0}
						<div class="max-h-48 space-y-1 overflow-y-auto">
							{#each $connectedPeers as peerId (peerId)}
								{@const isRelayed = $relayedPeers.includes(peerId)}
								<div class="flex items-center gap-2 rounded-md px-2 py-1.5">
									<span
										class={cn('h-1.5 w-1.5 rounded-full', isRelayed ? 'bg-warning' : 'bg-success')}
									></span>
									<User class="h-3.5 w-3.5 text-muted-foreground" />
									<span class="truncate text-sm">{getPeerDisplayName(peerId)}</span>
									{#if isRelayed}
										<span class="ml-auto shrink-0 text-xs text-muted-foreground">relay</span>
									{/if}
								</div>
							{/each}
						</div>
						{#if $relayedPeers.length > 0}
							<p class="border-t border-border pt-2 text-xs text-muted-foreground">
								Relayed peers get live messages only — history and files need a direct
								connection. Encrypted messages pass through the signaling server.
							</p>
							{#if $rotationStranded}
								<!-- §1.4/§3.6 honesty: room keys never transit the relay -->
								<p class="text-xs text-muted-foreground" data-testid="rotation-stranded">
									Key rotation pending direct connection — relayed peers can't receive the
									room's newer keys and won't see messages sent under them.
								</p>
							{/if}
						{/if}
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
	{:else}
		<span class="flex min-w-0 items-center gap-1.5">
			{@render subtitle()}
		</span>
		{#if canReconnect}
			<button
				onclick={handleReconnect}
				disabled={isManualReconnecting}
				class="shrink-0 font-medium text-primary hover:underline disabled:opacity-50"
			>
				{isManualReconnecting ? 'Reconnecting...' : 'Reconnect'}
			</button>
		{/if}
	{/if}
</div>
