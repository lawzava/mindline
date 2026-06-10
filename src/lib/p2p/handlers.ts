/**
 * P2P Message Handlers
 * Routes and processes incoming P2P messages with store integration
 */

import type {
	TypedP2PMessage,
	ChatMessage,
	TypingMessage,
	SyncRequestMessage,
	SyncResponseMessage,
	UserConnectedMessage,
	EditMessage,
	DeleteMessage,
	ReactionMessage,
	DeliveryAckMessage
} from './types';
import { messages } from '$lib/stores/messages';
import { drafts } from '$lib/stores/drafts';
import { currentRoomId } from '$lib/stores/room';
import { connection } from '$lib/stores/connection';
import { delivery } from '$lib/stores/delivery';
import { user } from '$lib/stores/user';
import { saveRoomMessages } from '$lib/storage/messages';
import type { Message } from '$lib/types/message';
import { get } from 'svelte/store';
import { toast } from 'svelte-sonner';

/**
 * Get P2P manager reference for sending responses
 * This is set by the manager module to avoid circular dependencies
 */
let sendToPeerFn: ((peerId: string, message: TypedP2PMessage) => void) | null = null;

export function setSendToPeerFn(fn: (peerId: string, message: TypedP2PMessage) => void): void {
	sendToPeerFn = fn;
}

/**
 * Route P2P message to appropriate handler
 */
export function routeP2PMessage(message: TypedP2PMessage, peerId: string): void {
	try {
		switch (message.type) {
			case 'chat':
				handleChatMessage(message, peerId);
				break;
			case 'typing':
				handleTypingMessage(message, peerId);
				break;
			case 'sync-request':
				handleSyncRequest(message, peerId);
				break;
			case 'sync-response':
				handleSyncResponse(message, peerId);
				break;
			case 'user-connected':
				handleUserConnected(message, peerId);
				break;
			case 'edit':
				handleEditMessage(message, peerId);
				break;
			case 'delete':
				handleDeleteMessage(message, peerId);
				break;
			case 'reaction':
				handleReactionMessage(message, peerId);
				break;
			case 'delivery-ack':
				handleDeliveryAck(message, peerId);
				break;
			default:
				console.warn(`[P2P Handler] Unknown message type: ${(message as TypedP2PMessage).type}`);
		}
	} catch (error) {
		console.error('[P2P Handler] Error routing message:', error);
	}
}

/**
 * Handle chat messages from peers
 */
function handleChatMessage(message: ChatMessage, peerId: string): void {
	const { content, senderName, senderId, messageId, timestamp, roomId } = message;

	if (!content || (!senderName && !senderId)) {
		console.warn('[P2P Handler] Invalid chat message received');
		return;
	}

	// Update peer name mapping if we have a name
	if (senderName) {
		connection.setPeerName(peerId, senderName);
	}

	// Create message object
	const messageObj: Message = {
		id: messageId || `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`,
		sender_id: senderId || peerId,
		sender_name: senderName || senderId || peerId,
		message_type: 'Text',
		content,
		timestamp: timestamp || Date.now(),
		room_id: roomId || get(currentRoomId) || '',
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

	// Add to messages store
	const targetRoomId = roomId || get(currentRoomId);
	if (targetRoomId) {
		messages.addMessage(targetRoomId, messageObj);
		saveRoomMessages(targetRoomId, messages.getRoomMessages(targetRoomId));

		// Send delivery acknowledgment back to sender
		if (sendToPeerFn) {
			const userState = get(user);
			const ack: DeliveryAckMessage = {
				type: 'delivery-ack',
				messageId: messageObj.id,
				roomId: targetRoomId,
				peerId: userState.id,
				timestamp: Date.now()
			};

			sendToPeerFn(peerId, ack);
		}
	}

	// Clear the typing indicator for this peer since they sent a message
	drafts.clearDraft(peerId);
}

/**
 * Handle typing indicator messages
 */
function handleTypingMessage(message: TypingMessage, peerId: string): void {
	const { content, senderName, senderId } = message;

	const displayName = senderName || senderId || peerId;

	// Also update peer name mapping if we have a name (ensures names are tracked
	// even if user-connected message was missed)
	if (senderName) {
		connection.setPeerName(peerId, senderName);
	}

	// Update drafts store
	if (content && content.trim() !== '') {
		drafts.setDraft(peerId, displayName, content);
	} else {
		drafts.clearDraft(peerId);
	}
}

/**
 * Handle sync request from peer
 */
function handleSyncRequest(message: SyncRequestMessage, peerId: string): void {
	const roomId = message.roomId || get(currentRoomId);
	if (!roomId) {
		console.warn('[P2P Handler] No room ID for sync request');
		return;
	}

	try {
		// Get messages from store
		const roomMessages = messages.getRoomMessages(roomId);

		// Paginate (PROTOCOL.md §3.5): pages of 40 keep each wire envelope
		// far below DataChannel message-size floors. Sync never relays.
		const PAGE_SIZE = 40;
		if (sendToPeerFn) {
			for (let start = 0; start < roomMessages.length || start === 0; start += PAGE_SIZE) {
				const page = roomMessages.slice(start, start + PAGE_SIZE);
				const syncResponse: SyncResponseMessage = {
					type: 'sync-response',
					roomId,
					messages: page,
					timestamp: Date.now()
				};
				sendToPeerFn(peerId, syncResponse);
				if (roomMessages.length === 0) break;
			}
		}
	} catch (error) {
		console.error('[P2P Handler] Error handling sync request:', error);
	}
}

/**
 * Handle sync response from peer
 */
function handleSyncResponse(message: SyncResponseMessage, peerId: string): void {
	const { roomId, messages: syncedMessages } = message;
	const targetRoomId = roomId || get(currentRoomId);

	if (!targetRoomId) {
		console.warn('[P2P Handler] No room ID for sync response');
		return;
	}

	if (!syncedMessages || !Array.isArray(syncedMessages) || syncedMessages.length === 0) {
		return;
	}

	const totalMessages = syncedMessages.length;

	// Start sync tracking
	connection.startSync(peerId);

	const processedMessages = syncedMessages;

	// Get existing messages to check for duplicates and state
	const existingMessages = messages.getRoomMessages(targetRoomId);
	const existingById = new Map(existingMessages.map((msg) => [msg.id, msg]));

	// Filter out duplicates and add/update messages with progress tracking
	let newCount = 0;
	let processedCount = 0;

	for (const msg of processedMessages) {
		processedCount++;

		const existingMsg = existingById.get(msg.id);
		if (!existingMsg) {
			// New message - add it
			messages.addMessage(targetRoomId, msg);
			newCount++;
		} else {
			// Message exists - check if synced version has important updates
			// Prefer deleted state: if synced message is deleted but local isn't, update local
			const syncedIsDeleted = msg.message_type === 'Deleted' || msg.content === '[Message deleted]';
			const localIsDeleted = existingMsg.message_type === 'Deleted' || existingMsg.content === '[Message deleted]';

			if (syncedIsDeleted && !localIsDeleted) {
				// Synced version is deleted but local isn't - apply deletion
				messages.updateMessage(targetRoomId, msg.id, {
					content: '[Message deleted]',
					message_type: 'Deleted'
				});
			}
			// Also sync reactions if synced has more/different reactions
			if (msg.reactions && Object.keys(msg.reactions).length > 0) {
				const mergedReactions = { ...existingMsg.reactions, ...msg.reactions };
				if (JSON.stringify(mergedReactions) !== JSON.stringify(existingMsg.reactions)) {
					messages.updateMessage(targetRoomId, msg.id, { reactions: mergedReactions });
				}
			}
		}

		// Update progress periodically (every 10 messages or at end)
		if (processedCount % 10 === 0 || processedCount === totalMessages) {
			connection.updateSyncProgress(newCount, totalMessages);
		}
	}

	if (newCount > 0) {
		saveRoomMessages(targetRoomId, messages.getRoomMessages(targetRoomId));
	}

	// End sync with short delay for UI visibility
	setTimeout(() => {
		connection.endSync();
	}, 1000);
}

/**
 * Handle user connected notifications
 */
function handleUserConnected(message: UserConnectedMessage, peerId: string): void {
	const { senderName, senderId } = message;

	// Store the peer's name using the WebRTC peerId (not senderId)
	// This ensures $peerNames matches $connectedPeers which uses WebRTC peer IDs
	if (senderName) {
		connection.setPeerName(peerId, senderName);
	}

	// Show toast notification
	if (senderName) {
		toast.success(`${senderName} joined the room`);
	}
}

/**
 * Handle message edit requests
 */
function handleEditMessage(message: EditMessage, peerId: string): void {
	const { messageId, roomId, newContent, senderId, timestamp } = message;

	const targetRoomId = roomId || get(currentRoomId);
	if (!targetRoomId || !messageId) {
		console.warn('[P2P Handler] Invalid edit message');
		return;
	}

	// Verify sender owns the message (optional security check)
	const existingMsg = messages.getMessage(targetRoomId, messageId);
	if (existingMsg && existingMsg.sender_id !== senderId) {
		console.warn('[P2P Handler] Edit rejected: sender does not own message');
		return;
	}

	// Update the message in TS store
	messages.updateMessage(targetRoomId, messageId, {
		content: newContent,
		edited: true,
		edit_timestamp: timestamp,
		original_content: existingMsg?.content || null
	});

	saveRoomMessages(targetRoomId, messages.getRoomMessages(targetRoomId));
}

/**
 * Handle message delete requests
 */
function handleDeleteMessage(message: DeleteMessage, peerId: string): void {
	const { messageId, roomId, senderId } = message;

	const targetRoomId = roomId || get(currentRoomId);
	if (!targetRoomId || !messageId) {
		console.warn('[P2P Handler] Invalid delete message');
		return;
	}

	// Verify sender owns the message (optional security check)
	const existingMsg = messages.getMessage(targetRoomId, messageId);
	if (existingMsg && existingMsg.sender_id !== senderId) {
		console.warn('[P2P Handler] Delete rejected: sender does not own message');
		return;
	}

	// Mark message as deleted (soft delete) in TS store
	messages.updateMessage(targetRoomId, messageId, {
		content: '[Message deleted]',
		message_type: 'Deleted'
	});

	saveRoomMessages(targetRoomId, messages.getRoomMessages(targetRoomId));
}

/**
 * Handle message reactions
 */
function handleReactionMessage(message: ReactionMessage, peerId: string): void {
	const { messageId, roomId, reaction, senderId, senderName, action } = message;

	const targetRoomId = roomId || get(currentRoomId);
	if (!targetRoomId || !messageId || !reaction) {
		console.warn('[P2P Handler] Invalid reaction message');
		return;
	}

	const existingMsg = messages.getMessage(targetRoomId, messageId);
	if (!existingMsg) {
		console.warn('[P2P Handler] Message not found for reaction');
		return;
	}

	// Update reactions in TS store
	const reactions = { ...existingMsg.reactions };
	const reactionData = reactions[reaction] || { users: [], count: 0 };

	if (action === 'add') {
		if (!reactionData.users.includes(senderId)) {
			reactionData.users.push(senderId);
			reactionData.count = reactionData.users.length;
		}
	} else {
		reactionData.users = reactionData.users.filter((u) => u !== senderId);
		reactionData.count = reactionData.users.length;
		if (reactionData.count === 0) {
			delete reactions[reaction];
		}
	}

	if (reactionData.count > 0) {
		reactions[reaction] = reactionData;
	}

	messages.updateMessage(targetRoomId, messageId, { reactions });

	saveRoomMessages(targetRoomId, messages.getRoomMessages(targetRoomId));
}

/**
 * Handle delivery acknowledgment messages
 */
function handleDeliveryAck(message: DeliveryAckMessage, peerId: string): void {
	const { messageId } = message;

	// Record the delivery in our tracking store
	delivery.recordDelivery(messageId, peerId);
}

/**
 * Emit a toast notification
 */
export function emitToast(type: 'peer-joined' | 'peer-left' | 'error' | 'success' | 'info', message: string): void {
	switch (type) {
		case 'peer-joined':
		case 'success':
			toast.success(message);
			break;
		case 'peer-left':
		case 'info':
			toast.info(message);
			break;
		case 'error':
			toast.error(message);
			break;
	}
}
