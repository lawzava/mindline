<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { onMount, onDestroy } from 'svelte';
	import { MessageList, MessageInput, DraftIndicator, ConnectionStatus } from '$lib/components/chat';
	import { currentRoomId, currentRoomMessages, messages, user, drafts } from '$lib/stores';
	import { wasm, isWasmReady } from '$lib/wasm';
	import { initializeP2P, disconnectP2P, broadcastChat, broadcastTyping, broadcastEdit, broadcastDelete, broadcastReaction, getP2PConfig, isMobileDevice } from '$lib/p2p';
	import type { Message } from '$lib/wasm/types';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import { Copy, LogOut, Loader2 } from 'lucide-svelte';

	// Get room ID from URL params
	const roomId = $derived(page.params.roomId);
	let isLoading = $state(true);
	let isSending = $state(false);
	let showLeaveDialog = $state(false);

	onMount(async () => {
		if (!roomId || !isWasmReady()) {
			isLoading = false;
			return;
		}

		// Ensure user is initialized
		if (!$user.initialized) {
			const userId = wasm.generateUuid();
			const name = $user.name || 'Anonymous';
			wasm.initialize(name, userId);
			user.initialize(name, userId);
		}

		// Join the room
		try {
			wasm.createRoom(roomId); // Create or join
			currentRoomId.set(roomId);

			// Load existing messages from storage
			wasm.loadRoomMessagesFromStorage(roomId);
			const messagesData = wasm.getRoomMessages(roomId, 100);
			// WASM returns a JS array directly via serde_wasm_bindgen, not a JSON string
			if (messagesData && Array.isArray(messagesData) && messagesData.length > 0) {
				messages.setRoomMessages(roomId, messagesData as Message[]);
			}

			// Initialize P2P connection with environment-aware config
			try {
				const p2pConfig = getP2PConfig();
				if (isMobileDevice()) {
					console.log('[Room] Mobile device detected - using optimized P2P config');
				}
				await initializeP2P(roomId, p2pConfig);
			} catch (error) {
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
		// Clear drafts when leaving room
		drafts.clearAll();
		// Disconnect P2P
		disconnectP2P();
	});

	async function handleSend(content: string) {
		if (!isWasmReady() || !roomId || isSending) return;

		isSending = true;

		try {
			const messageId = wasm.generateUuid();

			// Create message object
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
				size_bytes: new TextEncoder().encode(content).length
			};

			// Add to local messages
			messages.addMessage(roomId, message);

			// Send via WASM
			try {
				wasm.sendMessage(roomId, content, messageId);
				wasm.saveRoomMessagesToStorage(roomId);
			} catch (error) {
				console.error('Failed to send message:', error);
				toast.error('Failed to send message');
				// Update message status to failed
				messages.updateMessage(roomId, messageId, { status: 'Failed' });
			}

			// Broadcast via P2P
			broadcastChat(content, messageId);

			// Clear typing indicator
			broadcastTyping('');
		} finally {
			isSending = false;
		}
	}

	function handleTyping(content: string) {
		// Broadcast typing indicator via P2P
		broadcastTyping(content);
	}

	async function copyRoomId() {
		if (!roomId) return;
		await navigator.clipboard.writeText(roomId);
		toast.success('Room ID copied!');
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

		// Update local message
		messages.updateMessage(roomId, messageId, {
			content: newContent,
			edited: true,
			edit_timestamp: Date.now(),
			original_content: messages.getMessage(roomId, messageId)?.content || null
		});

		// Save to storage
		if (isWasmReady()) {
			try {
				wasm.saveRoomMessagesToStorage(roomId);
			} catch (error) {
				console.error('Failed to save edited message:', error);
			}
		}

		// Broadcast to peers
		broadcastEdit(messageId, newContent);
		toast.success('Message edited');
	}

	function handleDelete(messageId: string) {
		if (!roomId) return;

		// Soft delete - update content
		messages.updateMessage(roomId, messageId, {
			content: '[Message deleted]',
			message_type: 'Deleted'
		});

		// Save to storage
		if (isWasmReady()) {
			try {
				wasm.saveRoomMessagesToStorage(roomId);
			} catch (error) {
				console.error('Failed to save deleted message:', error);
			}
		}

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

		// Save to storage
		if (isWasmReady()) {
			try {
				wasm.saveRoomMessagesToStorage(roomId);
			} catch (error) {
				console.error('Failed to save reaction:', error);
			}
		}

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
			<Loader2 class="h-8 w-8 animate-spin" />
			<p class="text-sm">Joining room...</p>
		</div>
	</div>
{:else}
	<div class="flex flex-1 flex-col">
		<!-- Connection Status Bar -->
		<div class="flex items-center justify-between border-b px-4 py-2">
			<div class="flex items-center gap-2">
				<span class="text-sm text-muted-foreground">Room:</span>
				<button
					onclick={copyRoomId}
					class="group flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-xs hover:bg-muted/80 transition-colors"
					title="Click to copy full room ID"
				>
					<code>{roomId?.slice(0, 8)}...</code>
					<Copy class="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
				</button>
			</div>
			<div class="flex items-center gap-2">
				<ConnectionStatus />
				<Button variant="ghost" size="sm" onclick={confirmLeave} class="h-8 gap-1.5 text-muted-foreground hover:text-foreground">
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

		<!-- Draft indicators (what others are typing) -->
		<DraftIndicator />

		<!-- Message input -->
		<MessageInput onSend={handleSend} onTyping={handleTyping} {isSending} />
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
