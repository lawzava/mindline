<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { onMount, onDestroy } from 'svelte';
	import { MessageList, MessageInput, ConnectionStatus } from '$lib/components/chat';
	import { currentRoomId, currentRoomMessages, messages, user, drafts, mediaConsent } from '$lib/stores';
	import { loadRoomMessages, saveRoomMessages } from '$lib/storage/messages';
	import { initializeP2P, disconnectP2P, broadcastChat, broadcastTyping, broadcastEdit, broadcastDelete, broadcastReaction, getP2PConfig, getSessionDeviceId, getTestConfig, isTestMode, isMobileDevice, setupVisibilityHandler, cleanupVisibilityHandler, setupNetworkHandler, cleanupNetworkHandler, setupPageLifecycleHandlers, cleanupPageLifecycleHandlers, NoRoomKeyError, sendMediaMessage, acceptMediaTransfer, declineMediaTransfer } from '$lib/p2p';
	import type { Message } from '$lib/types/message';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import { Copy, LogOut, Loader2 } from 'lucide-svelte';

	// Get room ID from URL params
	const roomId = $derived(page.params.roomId);
	let isLoading = $state(true);
	let isSending = $state(false);
	let showLeaveDialog = $state(false);
	let isKnocking = $state(false);

	// Debounced typing broadcast to reduce network traffic
	let typingDebounceTimer: ReturnType<typeof setTimeout> | null = null;
	const TYPING_DEBOUNCE_MS = 100; // Debounce typing broadcasts

	onMount(async () => {
		if (!roomId) {
			isLoading = false;
			return;
		}

		// Ensure user is initialized
		if (!$user.initialized) {
			user.initialize($user.name || 'Anonymous', crypto.randomUUID());
		}

		// Join the room
		try {
			currentRoomId.set(roomId);

			// Load existing messages from storage
			const stored = loadRoomMessages(roomId);
			if (stored.length > 0) {
				messages.setRoomMessages(roomId, stored);
			}

			// Initialize P2P connection with environment-aware config
			try {
				let p2pConfig = getP2PConfig();
				const isMobile = isMobileDevice();
				if (isMobile) {
					console.log('[Room] Mobile device detected - using optimized P2P config');
				}
				// Merge test config if fastConnect=true is in URL (for E2E tests)
				if (isTestMode()) {
					console.log('[Room] Test mode detected - using fast connect config');
					p2pConfig = { ...p2pConfig, ...getTestConfig() };
				}
				await initializeP2P(roomId, p2pConfig);

				// Setup mobile lifecycle handlers after successful P2P init
				if (isMobile) {
					setupVisibilityHandler(roomId, p2pConfig);
					setupNetworkHandler(roomId, p2pConfig);
				}
				// Setup page lifecycle handlers for all devices (graceful cleanup)
				setupPageLifecycleHandlers();
			} catch (error) {
				if (error instanceof NoRoomKeyError) {
					// No key in the URL and none stored: this device can't read
					// the room. Honest state, no silent empty-room creation.
					isKnocking = true;
					return;
				}
				// P2P failed but app still works in local mode
				console.warn('P2P initialization failed (running in local mode):', error);
				toast.warning("P2P connection failed. Running in local mode - messages won't sync with others.");
			}
		} catch (error) {
			console.error('Failed to join room:', error);
			toast.error('Failed to join room');
		} finally {
			isLoading = false;
		}
	});

	onDestroy(() => {
		// Cleanup typing debounce timer
		if (typingDebounceTimer) {
			clearTimeout(typingDebounceTimer);
			typingDebounceTimer = null;
		}
		// Cleanup lifecycle handlers
		cleanupVisibilityHandler();
		cleanupNetworkHandler();
		cleanupPageLifecycleHandlers();
		// Clear drafts when leaving room
		drafts.clearAll();
		// Disconnect P2P
		disconnectP2P();
	});

	async function handleSend(content: string) {
		if (!roomId || isSending) return;

		isSending = true;

		try {
			const messageId = crypto.randomUUID();

			const message: Message = {
				id: messageId,
				sender_id: $user.id,
				sender_name: $user.name,
				message_type: 'Text',
				content,
				timestamp: Date.now(),
				room_id: roomId,
				status: 'Sent',
				edited: false,
				edit_timestamp: null,
				original_content: null,
				reply_to: null,
				reactions: {},
				mentions: [],
				local_timestamp: Date.now(),
				delivery_attempts: 0,
				size_bytes: new TextEncoder().encode(content).length,
				sender_device: getSessionDeviceId() ?? undefined
			};

			messages.addMessage(roomId, message);
			saveRoomMessages(roomId, messages.getRoomMessages(roomId));

			// Broadcast via P2P
			broadcastChat(content, messageId);

			// Clear typing indicator
			broadcastTyping('');
		} finally {
			isSending = false;
		}
	}

	async function handleSendMedia(
		data: Uint8Array,
		meta: Parameters<typeof sendMediaMessage>[1]
	) {
		await sendMediaMessage(data, meta);
	}

	function handleTyping(content: string) {
		// Clear any pending debounce
		if (typingDebounceTimer) {
			clearTimeout(typingDebounceTimer);
		}

		// Debounce the typing broadcast to reduce P2P message volume
		typingDebounceTimer = setTimeout(() => {
			broadcastTyping(content);
			typingDebounceTimer = null;
		}, TYPING_DEBOUNCE_MS);
	}

	async function copyRoomId() {
		if (!roomId) return;
		// The invite is the full URL: room id in the path, key in the fragment.
		await navigator.clipboard.writeText(window.location.href);
		toast.success('Invite link copied! Anyone with this link can read the room.');
	}

	function confirmLeave() {
		showLeaveDialog = true;
	}

	function leaveRoom() {
		showLeaveDialog = false;
		currentRoomId.clear();
		goto('/');
	}

	function handleEdit(messageId: string, newContent: string) {
		if (!roomId) return;

		const originalContent = messages.getMessage(roomId, messageId)?.content || null;

		// Optimistic update for immediate UI feedback
		messages.updateMessage(roomId, messageId, {
			content: newContent,
			edited: true,
			edit_timestamp: Date.now(),
			original_content: originalContent
		});

		saveRoomMessages(roomId, messages.getRoomMessages(roomId));

		// Broadcast to peers
		broadcastEdit(messageId, newContent);

		toast.success('Message edited');
	}

	function handleDelete(messageId: string) {
		if (!roomId) return;

		// Soft delete - update content (optimistic update)
		messages.updateMessage(roomId, messageId, {
			content: '[Message deleted]',
			message_type: 'Deleted'
		});

		saveRoomMessages(roomId, messages.getRoomMessages(roomId));

		// Broadcast to peers
		broadcastDelete(messageId);

		toast.success('Message deleted');
	}

	function handleReaction(messageId: string, emoji: string) {
		if (!roomId) return;

		const message = messages.getMessage(roomId, messageId);
		if (!message) return;

		const reactions = { ...message.reactions };
		const reactionData = reactions[emoji] || { users: [], count: 0 };

		// Toggle reaction
		const userId = $user.id;
		const hasReacted = reactionData.users.includes(userId);
		let action: 'add' | 'remove';

		if (hasReacted) {
			// Remove reaction
			reactionData.users = reactionData.users.filter((u) => u !== userId);
			reactionData.count = reactionData.users.length;
			action = 'remove';
			if (reactionData.count === 0) {
				delete reactions[emoji];
			} else {
				reactions[emoji] = reactionData;
			}
		} else {
			// Add reaction
			reactionData.users.push(userId);
			reactionData.count = reactionData.users.length;
			reactions[emoji] = reactionData;
			action = 'add';
		}

		// Update local message
		messages.updateMessage(roomId, messageId, { reactions });
		saveRoomMessages(roomId, messages.getRoomMessages(roomId));

		// Broadcast to peers
		broadcastReaction(messageId, emoji, action);
	}
</script>

<svelte:head>
	<title>Room {roomId?.slice(0, 8)}... | Mindline</title>
</svelte:head>

{#if isLoading}
	<div class="flex flex-1 items-center justify-center">
		<div class="flex flex-col items-center gap-4 text-muted-foreground">
			<Loader2 class="h-8 w-8 animate-spin motion-reduce:animate-none" />
			<p class="text-sm">Joining room...</p>
		</div>
	</div>
{:else if isKnocking}
	<div class="flex flex-1 items-center justify-center p-4" data-testid="knocking-state">
		<div class="flex max-w-sm flex-col items-center gap-3 text-center">
			<p class="text-lg font-medium">This room is locked</p>
			<p class="text-sm text-muted-foreground">
				Your link is missing the room key. Ask the person who invited you for the full
				invite link; it ends with <code>#k=...</code> and never reaches our servers.
			</p>
			<Button variant="outline" onclick={() => goto('/')}>Back to start</Button>
		</div>
	</div>
{:else}
	<div class="mx-auto flex w-full max-w-3xl flex-1 flex-col overflow-hidden min-h-0">
		<!-- Connection Status Bar -->
		<div class="flex flex-col gap-2 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60 px-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:px-4">
			<div class="flex items-center gap-2">
				<span class="text-sm text-muted-foreground">Room:</span>
				<button
					onclick={copyRoomId}
					aria-label="Copy room ID to clipboard"
					class="group inline-flex h-11 items-center gap-2 rounded-full bg-muted px-3 text-xs hover:bg-muted/80 transition-colors"
					title="Tap to copy room ID"
					data-testid="copy-room-btn"
				>
					<code>{roomId?.slice(0, 8)}...</code>
					<Copy class="h-4 w-4 opacity-70 transition-opacity group-hover:opacity-100 motion-reduce:transition-none" />
				</button>
			</div>
			<div class="flex w-full items-center justify-between gap-2 sm:w-auto sm:justify-end">
				<ConnectionStatus />
				<Button variant="ghost" size="sm" onclick={confirmLeave} class="h-11 px-3 gap-2 text-muted-foreground hover:text-foreground" data-testid="leave-room-btn">
					<LogOut class="h-4 w-4" />
					<span class="hidden sm:inline">Leave</span>
				</Button>
			</div>
		</div>

		<!-- Messages area -->
		<MessageList
			messages={$currentRoomMessages}
			onEdit={handleEdit}
			onDelete={handleDelete}
			onReaction={handleReaction}
		/>

		<!-- Large-transfer consent prompts -->
		{#each $mediaConsent as request (request.offer.transferId)}
			<div class="flex items-center gap-2 border-t border-border bg-muted/40 px-4 py-2 text-sm" data-testid="media-consent">
				<span class="min-w-0 flex-1 truncate">
					{request.offer.senderName} wants to send
					<strong>{request.offer.name}</strong>
					({request.offer.size < 1024 * 1024
						? `${Math.max(1, Math.round(request.offer.size / 1024))} KB`
						: `${Math.round(request.offer.size / 1024 / 1024)} MB`})
				</span>
				<Button size="sm" onclick={() => acceptMediaTransfer(request.offer, request.peerDeviceId)}>
					Accept
				</Button>
				<Button size="sm" variant="ghost" onclick={() => declineMediaTransfer(request.offer.transferId)}>
					Decline
				</Button>
			</div>
		{/each}

		<!-- Message input -->
		<MessageInput onSend={handleSend} onSendMedia={handleSendMedia} onTyping={handleTyping} {isSending} />
	</div>

	<!-- Leave confirmation dialog -->
	<AlertDialog.Root bind:open={showLeaveDialog}>
		<AlertDialog.Content>
			<AlertDialog.Header>
				<AlertDialog.Title>Leave Room?</AlertDialog.Title>
				<AlertDialog.Description>
					Are you sure you want to leave this room? Any unsent messages will be lost.
				</AlertDialog.Description>
			</AlertDialog.Header>
			<AlertDialog.Footer>
				<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
				<AlertDialog.Action onclick={leaveRoom}>Leave Room</AlertDialog.Action>
			</AlertDialog.Footer>
		</AlertDialog.Content>
	</AlertDialog.Root>
{/if}
