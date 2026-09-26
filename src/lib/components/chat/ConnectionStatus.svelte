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
	import { admission, getPeerSafety, makeHost, reconnectP2P, removeMember } from '$lib/p2p';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import { verified, verifyStatus, type VerifyStatus } from '$lib/stores/verified';
	import SafetyNumberDialog from './SafetyNumberDialog.svelte';
	import { Loader2, User } from 'lucide-svelte';
	import { toast } from 'svelte-sonner';
	import { cn } from '$lib/utils';
	import { peopleLabel } from '$lib/presence';

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
					label: `Connected · ${peopleLabel($connectedPeers.map((id) => $peerNames.get(id)))}`,
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

	// Safety numbers (PROTOCOL.md §1.3) for connected peers, computed once
	// per device; the cache is per page, so a reload recomputes from the
	// keys the peer presents now.
	let safety = $state<Record<string, { number: string; fingerprint: string }>>({});
	const pendingSafety = new Set<string>();
	$effect(() => {
		for (const id of $connectedPeers) {
			if (safety[id] || pendingSafety.has(id)) continue;
			pendingSafety.add(id);
			void getPeerSafety(id).then((s) => {
				pendingSafety.delete(id);
				if (s) safety = { ...safety, [id]: s };
			});
		}
	});

	function statusOf(id: string): VerifyStatus {
		const s = safety[id];
		if (!s) return 'unverified';
		return verifyStatus($verified, id, s.fingerprint, $peerNames.get(id));
	}

	// Warn once per device: changed keys, or a stranger using a verified name.
	const warned = new Set<string>();
	$effect(() => {
		for (const id of $connectedPeers) {
			const st = statusOf(id);
			if ((st !== 'changed' && st !== 'impostor') || warned.has(id)) continue;
			warned.add(id);
			const name = getPeerDisplayName(id);
			toast.warning(
				st === 'changed'
					? `${name}'s safety number changed. Compare it again before trusting them.`
					: `${name} is not the device you verified under that name.`,
				{ duration: 10000 }
			);
		}
	});

	let dialogPeer = $state<string | null>(null);
	// Removal (§3.8) asks first: it is immediate and rotates the room key.
	let removePeerId = $state<string | null>(null);
	let removeOpen = $state(false);
	// Handing the host role on is irreversible from this device: ask first.
	let hostPeerId = $state<string | null>(null);
	let hostOpen = $state(false);
	// The dialog replaces the peer list: a popover left open behind it keeps
	// focus trapped, and Enter in the composer would not send.
	let peerListOpen = $state(false);
	let dialogOpen = $state(false);

	function markVerified() {
		const s = dialogPeer ? safety[dialogPeer] : null;
		if (dialogPeer && s) verified.mark(dialogPeer, s.fingerprint, getPeerDisplayName(dialogPeer));
	}

	const statusText: Record<VerifyStatus, string> = {
		verified: 'Verified',
		changed: 'Keys changed',
		impostor: 'Not verified',
		unverified: 'Verify'
	};

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
		<Popover.Root bind:open={peerListOpen}>
			<Popover.Trigger
				class="flex min-w-0 items-center gap-1.5 rounded-sm outline-ring/50 hover:text-foreground"
				data-testid="peer-count"
				data-peer-count={$connectedPeers.length}
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
								{@const vs = statusOf(peerId)}
								<div class="flex items-center gap-2 rounded-md px-2 py-1.5">
									<span
										class={cn('h-1.5 w-1.5 rounded-full', isRelayed ? 'bg-warning' : 'bg-success')}
									></span>
									<User class="h-3.5 w-3.5 text-muted-foreground" />
									<span class="truncate text-sm">{getPeerDisplayName(peerId)}</span>
									<span class="ml-auto flex shrink-0 items-center gap-2">
										{#if isRelayed}
											<span class="text-xs text-muted-foreground">relay</span>
										{/if}
										<button
											onclick={() => {
												dialogPeer = peerId;
												peerListOpen = false;
												dialogOpen = true;
											}}
											class={cn(
												'rounded-sm text-xs font-medium outline-ring/50 hover:underline',
												vs === 'verified' && 'text-success',
												(vs === 'changed' || vs === 'impostor') && 'text-destructive',
												vs === 'unverified' && 'text-primary'
											)}
											data-testid="verify-status"
										>
											{statusText[vs]}
										</button>
										{#if $admission.host}
											<button
												onclick={() => {
													hostPeerId = peerId;
													peerListOpen = false;
													hostOpen = true;
												}}
												class="rounded-sm text-xs font-medium text-muted-foreground outline-ring/50 hover:underline"
											>
												Make host
											</button>
										{/if}
										{#if $admission.host && $admission.approving}
											<button
												onclick={() => {
													removePeerId = peerId;
													peerListOpen = false;
													removeOpen = true;
												}}
												class="rounded-sm text-xs font-medium text-muted-foreground outline-ring/50 hover:text-destructive hover:underline"
											>
												Remove
											</button>
										{/if}
									</span>
								</div>
							{/each}
						</div>
						{#if $relayedPeers.length > 0}
							<p class="border-t border-border pt-2 text-xs text-muted-foreground">
								Relayed peers get live messages only — history and files need a direct connection.
								Encrypted messages pass through the signaling server.
							</p>
							{#if $rotationStranded}
								<!-- §1.4/§3.6 honesty: room keys never transit the relay -->
								<p class="text-xs text-muted-foreground" data-testid="rotation-stranded">
									Key rotation pending direct connection — relayed peers can't receive the room's
									newer keys and won't see messages sent under them.
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

<AlertDialog.Root bind:open={removeOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>
				Remove {removePeerId ? getPeerDisplayName(removePeerId) : ''}?
			</AlertDialog.Title>
			<AlertDialog.Description>
				They stop receiving messages right away, and the room key changes so nothing sent from now
				on reaches them. They keep what they already received. Someone can let them in again if they
				open the link.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action
				onclick={() => {
					if (removePeerId)
						removeMember(removePeerId).catch((e) => toast.error(String(e?.message ?? e)));
					removeOpen = false;
				}}
				class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
			>
				Remove from room
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

<AlertDialog.Root bind:open={hostOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>
				Make {hostPeerId ? getPeerDisplayName(hostPeerId) : ''} the host?
			</AlertDialog.Title>
			<AlertDialog.Description>
				The host decides who is let in and who is removed. Only they can hand the role back.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action
				onclick={() => {
					if (hostPeerId) makeHost(hostPeerId).catch((e) => toast.error(String(e?.message ?? e)));
					hostOpen = false;
				}}
			>
				Make host
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

<SafetyNumberDialog
	bind:open={dialogOpen}
	name={dialogPeer ? getPeerDisplayName(dialogPeer) : ''}
	number={dialogPeer ? (safety[dialogPeer]?.number ?? null) : null}
	status={dialogPeer ? statusOf(dialogPeer) : 'unverified'}
	onVerify={markVerified}
	onUnverify={() => dialogPeer && verified.unmark(dialogPeer)}
/>
