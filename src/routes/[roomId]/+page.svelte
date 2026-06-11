<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { onMount, onDestroy } from 'svelte';
	import { MessageList, MessageInput, ConnectionStatus } from '$lib/components/chat';
	import { currentRoomId, currentRoomMessages, messages, user, drafts, mediaConsent } from '$lib/stores';
	import { clearRoomMessages, loadRoomMessages, saveRoomMessages } from '$lib/storage/messages';
	import { burnRoomData } from '$lib/storage/burn';
	import { initializeP2P, disconnectP2P, applyReaction, broadcastChat, broadcastTyping, broadcastEdit, broadcastDelete, broadcastReaction, getP2PConfig, getSessionDeviceId, getTestConfig, isTestMode, isMobileDevice, setupVisibilityHandler, cleanupVisibilityHandler, setupNetworkHandler, cleanupNetworkHandler, setupPageLifecycleHandlers, cleanupPageLifecycleHandlers, NoRoomKeyError, sendMediaMessage, acceptMediaTransfer, declineMediaTransfer } from '$lib/p2p';
	import type { Message } from '$lib/types/message';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import * as Popover from '$lib/components/ui/popover';
	import { ChevronLeft, Share2, EllipsisVertical, Loader2, Sun, Moon, Link } from 'lucide-svelte';
	import { shareInvite } from '$lib/share';
	import { toggleMode, mode } from 'mode-watcher';

	// Get room ID from URL params
	const roomId = $derived(page.params.roomId);
	let isLoading = $state(true);
	let isSending = $state(false);
	let showLeaveDialog = $state(false);
	let isKnocking = $state(false);

	// Debounced typing broadcast to reduce network traffic
	let typingDebounceTimer: ReturnType<typeof setTimeout> | null = null;
	const TYPING_DEBOUNCE_MS = 100; // Debounce typing broadcasts

	// A burn in another tab must evacuate this one too: its in-memory keys
	// would otherwise re-persist the history the burn just deleted.
	let burnChannel: BroadcastChannel | null = null;

	onMount(async () => {
		if (!roomId) {
			isLoading = false;
			return;
		}

		try {
			burnChannel = new BroadcastChannel('mindline_burn');
			burnChannel.onmessage = (event) => {
				if (!roomId || event.data?.roomId !== roomId) return;
				disconnectP2P();
				void clearRoomMessages(roomId); // drops this tab's cached keys + any rewrite
				messages.clearRoom(roomId);
				currentRoomId.clear();
				toast.info('This room was burned in another tab');
				goto('/');
			};
		} catch {
			/* BroadcastChannel unsupported: single-tab burn only */
		}

		// Ensure user is initialized
		if (!$user.initialized) {
			user.initialize($user.name || 'Anonymous', crypto.randomUUID());
		}

		// Join the room
		try {
			currentRoomId.set(roomId);

			// Load existing messages from storage (decrypted with stored keys)
			const stored = await loadRoomMessages(roomId);
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
		burnChannel?.close();
		burnChannel = null;
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
			void saveRoomMessages(roomId, messages.getRoomMessages(roomId));

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
		try {
			await sendMediaMessage(data, meta);
		} catch (error) {
			console.warn('[Room] media send refused:', error);
			toast.error(error instanceof Error ? error.message : 'Could not send media');
			throw error;
		}
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

	let menuName = $state($user.name);

	function saveMenuName() {
		const trimmed = menuName.trim();
		if (trimmed) {
			user.setName(trimmed);
			toast.success('Name updated!');
		} else {
			menuName = $user.name;
			toast.error('Name cannot be empty');
		}
	}

	function confirmLeave() {
		showLeaveDialog = true;
	}

	async function leaveRoom(burn: boolean) {
		showLeaveDialog = false;
		const id = roomId;
		const deviceId = getSessionDeviceId();
		if (burn && id) {
			// Disconnect first so no handler persists anything mid-burn.
			disconnectP2P();
			try {
				await burnRoomData(id, deviceId);
			} catch (error) {
				// Stay in the room: navigating away would hide the failure
				// while data remains on the device.
				console.error('[Room] burn failed:', error);
				toast.error('Burn incomplete: some data may remain on this device. Try again.');
				return;
			}
			messages.clearRoom(id);
		}
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

		void saveRoomMessages(roomId, messages.getRoomMessages(roomId));

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

		void saveRoomMessages(roomId, messages.getRoomMessages(roomId));

		// Broadcast to peers
		broadcastDelete(messageId);

		toast.success('Message deleted');
	}

	function handleReaction(messageId: string, emoji: string) {
		if (!roomId) return;

		const message = messages.getMessage(roomId, messageId);
		if (!message) return;

		// Reactions are keyed by deviceId, the same identity peers verify
		// on our envelopes (PROTOCOL.md §3.5) — never the local user UUID.
		const deviceId = getSessionDeviceId();
		if (!deviceId) return;

		const hasReacted = (message.reactions[emoji]?.users ?? []).includes(deviceId);
		const action: 'add' | 'remove' = hasReacted ? 'remove' : 'add';
		const reactions = applyReaction(message.reactions, emoji, deviceId, action);

		// Update local message
		messages.updateMessage(roomId, messageId, { reactions });
		void saveRoomMessages(roomId, messages.getRoomMessages(roomId));

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
		<!-- Room header: one row of chrome above the stream. -->
		<div class="border-b border-border bg-background">
			<div class="flex h-14 items-center gap-1 px-1 sm:px-2">
				<Button
					variant="ghost"
					size="icon"
					onclick={confirmLeave}
					class="h-11 w-11 shrink-0 text-muted-foreground"
					aria-label="Back to start"
					data-testid="leave-room-btn"
				>
					<ChevronLeft class="h-5 w-5" />
				</Button>
				<div class="flex min-w-0 flex-1 flex-col items-start">
					<button
						onclick={copyRoomId}
						aria-label="Copy invite link"
						title="Tap to copy the invite link"
						class="max-w-full truncate rounded-sm text-sm font-semibold tabular-nums outline-ring/50 hover:text-primary"
						data-testid="copy-room-btn"
					>
						{roomId?.slice(0, 8)}...
					</button>
					<ConnectionStatus />
				</div>
				<Button
					variant="ghost"
					size="icon"
					onclick={shareInvite}
					class="h-11 w-11 shrink-0 text-muted-foreground"
					aria-label="Share invite link"
					data-testid="share-room-btn"
				>
					<Share2 class="h-4 w-4" />
				</Button>
				<Popover.Root>
					<Popover.Trigger
						class="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-ring/50 hover:bg-accent hover:text-foreground"
						aria-label="Room menu"
						data-testid="room-menu-btn"
					>
						<EllipsisVertical class="h-4 w-4" />
					</Popover.Trigger>
					<Popover.Content class="w-64 p-3" side="bottom" align="end">
						<div class="space-y-3">
							<div class="space-y-1.5">
								<label for="display-name" class="text-xs font-medium text-muted-foreground">
									Your name
								</label>
								<Input
									id="display-name"
									type="text"
									placeholder="Your name"
									aria-label="Your display name"
									bind:value={menuName}
									onblur={saveMenuName}
									onkeydown={(e) => e.key === 'Enter' && saveMenuName()}
								/>
							</div>
							<div class="space-y-0.5 border-t border-border pt-2">
								<button
									onclick={copyRoomId}
									class="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-accent"
								>
									<Link class="h-4 w-4 text-muted-foreground" />
									Copy invite link
								</button>
								<button
									onclick={toggleMode}
									class="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-accent"
								>
									{#if mode.current === 'dark'}
										<Sun class="h-4 w-4 text-muted-foreground" />
										Light theme
									{:else}
										<Moon class="h-4 w-4 text-muted-foreground" />
										Dark theme
									{/if}
								</button>
							</div>
						</div>
					</Popover.Content>
				</Popover.Root>
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
					Leave keeps this room's history on this device. Burn also deletes the room's
					keys, history, and media from this device — other participants keep their
					copies.
				</AlertDialog.Description>
			</AlertDialog.Header>
			<AlertDialog.Footer>
				<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
				<AlertDialog.Action onclick={() => leaveRoom(false)} data-testid="leave-keep-btn">
					Leave Room
				</AlertDialog.Action>
				<AlertDialog.Action
					onclick={() => leaveRoom(true)}
					data-testid="leave-burn-btn"
					class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
				>
					Burn &amp; Leave
				</AlertDialog.Action>
			</AlertDialog.Footer>
		</AlertDialog.Content>
	</AlertDialog.Root>
{/if}
