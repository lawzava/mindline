<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { connectionStatus, peerCount, connectionError } from '$lib/stores';
	import { reconnectP2P } from '$lib/p2p';
	import { Wifi, WifiOff, Loader2, Users, RefreshCw, AlertCircle } from 'lucide-svelte';
	import { toast } from 'svelte-sonner';

	let isReconnecting = $state(false);

	const statusConfig = $derived.by(() => {
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
		$connectionStatus === 'disconnected' ||
			$connectionStatus === 'failed' ||
			$connectionStatus === 'local'
	);

	async function handleReconnect() {
		isReconnecting = true;
		try {
			await reconnectP2P();
			toast.success('Reconnected successfully!');
		} catch (error) {
			console.error('Reconnection failed:', error);
			toast.error('Failed to reconnect');
		} finally {
			isReconnecting = false;
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

	<!-- Peer Count -->
	{#if $connectionStatus === 'connected'}
		{#if $peerCount > 0}
			<Badge variant="secondary" class="flex items-center gap-1.5 py-1">
				<Users class="h-3 w-3" />
				<span>{$peerCount} peer{$peerCount !== 1 ? 's' : ''}</span>
			</Badge>
		{:else}
			<Badge variant="outline" class="flex items-center gap-1.5 py-1 text-muted-foreground">
				<Users class="h-3 w-3" />
				<span>Waiting for peers...</span>
			</Badge>
		{/if}
	{/if}

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

	<!-- Reconnect button -->
	{#if canReconnect}
		<Button
			variant="ghost"
			size="sm"
			onclick={handleReconnect}
			disabled={isReconnecting}
			class="h-7 gap-1 px-2"
		>
			<RefreshCw class="h-3 w-3 {isReconnecting ? 'animate-spin' : ''}" />
			<span class="text-xs">Reconnect</span>
		</Button>
	{/if}
</div>
