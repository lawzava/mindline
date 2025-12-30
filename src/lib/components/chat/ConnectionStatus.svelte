<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import {
		connectionStatus,
		peerCount,
		connectionError,
		isReconnecting as isReconnectingStore,
		reconnectionState,
		isSyncing,
		syncState
	} from '$lib/stores';
	import { reconnectP2P } from '$lib/p2p';
	import { Wifi, WifiOff, Loader2, RefreshCw, AlertCircle } from 'lucide-svelte';
	import { toast } from 'svelte-sonner';
	import PeerList from './PeerList.svelte';

	let isManualReconnecting = $state(false);
	let countdownSeconds = $state(0);
	let countdownInterval: ReturnType<typeof setInterval> | null = null;

	// Update countdown timer when reconnecting
	$effect(() => {
		if ($isReconnectingStore && $reconnectionState.nextRetryAt) {
			// Clear existing interval
			if (countdownInterval) {
				clearInterval(countdownInterval);
			}

			// Start countdown
			countdownInterval = setInterval(() => {
				const remaining = Math.max(0, ($reconnectionState.nextRetryAt ?? 0) - Date.now());
				countdownSeconds = Math.ceil(remaining / 1000);

				if (remaining <= 0 && countdownInterval) {
					clearInterval(countdownInterval);
					countdownInterval = null;
				}
			}, 100);
		} else if (countdownInterval) {
			clearInterval(countdownInterval);
			countdownInterval = null;
			countdownSeconds = 0;
		}

		// Cleanup on destroy
		return () => {
			if (countdownInterval) {
				clearInterval(countdownInterval);
				countdownInterval = null;
			}
		};
	});

	const statusConfig = $derived.by(() => {
		// Handle auto-reconnecting state (takes priority)
		if ($isReconnectingStore) {
			return {
				label: `Reconnecting (${$reconnectionState.attemptCount}/${$reconnectionState.maxAttempts})`,
				variant: 'secondary' as const,
				icon: Loader2,
				iconClass: 'animate-spin',
				tooltip: `Attempting to reconnect... ${countdownSeconds > 0 ? `Next retry in ${countdownSeconds}s` : 'Connecting...'}`
			};
		}

		switch ($connectionStatus) {
			case 'connected':
				return {
					label: 'Connected',
					variant: 'default' as const,
					icon: Wifi,
					iconClass: 'text-green-500',
					tooltip: 'Connected to signaling server'
				};
			case 'connecting':
				return {
					label: 'Connecting',
					variant: 'secondary' as const,
					icon: Loader2,
					iconClass: 'animate-spin',
					tooltip: 'Connecting to signaling server...'
				};
			case 'disconnected':
				return {
					label: 'Offline',
					variant: 'outline' as const,
					icon: WifiOff,
					iconClass: 'text-muted-foreground',
					tooltip: 'Not connected. Click Reconnect to try again.'
				};
			case 'failed':
				return {
					label: 'Failed',
					variant: 'destructive' as const,
					icon: WifiOff,
					iconClass: '',
					tooltip: 'Connection failed. Click reconnect to try again.'
				};
			case 'local':
				return {
					label: 'Local Only',
					variant: 'outline' as const,
					icon: Wifi,
					iconClass: 'text-yellow-500',
					tooltip: "You're working offline. Messages are saved locally but won't sync with other users until you reconnect."
				};
			default:
				return {
					label: 'Unknown',
					variant: 'outline' as const,
					icon: WifiOff,
					iconClass: '',
					tooltip: 'Unknown connection status'
				};
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

<div class="flex items-center gap-2">
	<!-- Connection Status Badge with Tooltip -->
	<Tooltip.Provider>
		<Tooltip.Root>
			<Tooltip.Trigger>
				<Badge variant={statusConfig.variant} class="flex items-center gap-1.5 py-1 cursor-help">
					<statusConfig.icon class="h-3 w-3 {statusConfig.iconClass}" />
					<span>{statusConfig.label}</span>
				</Badge>
			</Tooltip.Trigger>
			<Tooltip.Content>
				<p>{statusConfig.tooltip}</p>
			</Tooltip.Content>
		</Tooltip.Root>
	</Tooltip.Provider>

	<!-- Peer List (clickable to show who's online) -->
	<PeerList />

	<!-- Error indicator with tooltip -->
	{#if $connectionError}
		<Tooltip.Provider>
			<Tooltip.Root>
				<Tooltip.Trigger>
					<span class="flex items-center text-destructive">
						<AlertCircle class="h-4 w-4" />
					</span>
				</Tooltip.Trigger>
				<Tooltip.Content>
					<p class="max-w-xs text-sm">{$connectionError}</p>
				</Tooltip.Content>
			</Tooltip.Root>
		</Tooltip.Provider>
	{/if}

	<!-- Sync Progress Indicator -->
	{#if $isSyncing}
		<Tooltip.Provider>
			<Tooltip.Root>
				<Tooltip.Trigger>
					<Badge variant="secondary" class="flex items-center gap-1.5 py-1 animate-pulse">
						<Loader2 class="h-3 w-3 animate-spin" />
						<span>Syncing...</span>
						{#if $syncState.messagesReceived > 0}
							<span class="text-xs opacity-70">
								({$syncState.messagesReceived}{$syncState.totalMessages
									? `/${$syncState.totalMessages}`
									: ''})
							</span>
						{/if}
					</Badge>
				</Tooltip.Trigger>
				<Tooltip.Content>
					<p>Synchronizing messages with peer</p>
					{#if $syncState.syncingWithPeer}
						<p class="text-xs opacity-70">From: {$syncState.syncingWithPeer.slice(0, 8)}...</p>
					{/if}
				</Tooltip.Content>
			</Tooltip.Root>
		</Tooltip.Provider>
	{/if}

	<!-- Reconnect button -->
	{#if canReconnect}
		<Button
			variant="ghost"
			size="sm"
			onclick={handleReconnect}
			disabled={isManualReconnecting}
			class="h-7 gap-1 px-2"
		>
			<RefreshCw class="h-3 w-3 {isManualReconnecting ? 'animate-spin' : ''}" />
			<span class="text-xs">Reconnect</span>
		</Button>
	{/if}
</div>
