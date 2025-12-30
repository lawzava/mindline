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
import { wasm, isWasmReady } from '$lib/wasm';
import type { Message } from '$lib/wasm/types';
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
		console.log(`[P2P Handler] Received ${message.type} message from ${peerId}`);

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
	const { content, senderName, senderId, messageId, timestamp, roomId, encrypted } = message;

	console.log('[P2P Handler] Chat message:', {
		content: encrypted ? '[encrypted]' : content,
		senderName,
		senderId,
		messageId,
		timestamp
	});

	if (!content || (!senderName && !senderId)) {
		console.warn('[P2P Handler] Invalid chat message received');
		return;
	}

	// Update peer name mapping if we have a name
	if (senderName) {
		connection.setPeerName(peerId, senderName);
	}

	// Decrypt message if it's encrypted
	let decryptedContent = content;
	if (encrypted && isWasmReady()) {
		try {
			const result = wasm.decryptMessageContent(content);
			if (result) {
				decryptedContent = result;
			}
		} catch (error) {
			console.warn('[P2P Handler] Failed to decrypt message:', error);
			decryptedContent = '[Encrypted message - unable to decrypt]';
		}
	}

	// Create message object
	const messageObj: Message = {
		id: messageId || `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`,
		sender_id: senderId || peerId,
		sender_name: senderName || senderId || peerId,
		message_type: 'Text',
		content: decryptedContent,
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
		size_bytes: new TextEncoder().encode(decryptedContent).length
	};

	// Add to messages store
	const targetRoomId = roomId || get(currentRoomId);
	if (targetRoomId) {
		messages.addMessage(targetRoomId, messageObj);

		// Also save to WASM storage
		if (isWasmReady()) {
			try {
				wasm.saveRoomMessagesToStorage(targetRoomId);
			} catch (error) {
				console.warn('[P2P Handler] Failed to save to WASM storage:', error);
			}
		}

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
			console.log('[P2P Handler] Sent delivery ack for message:', messageObj.id);
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

	console.log('[P2P Handler] Typing message:', { content, senderName, senderId });

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
	console.log('[P2P Handler] Sync request from:', peerId, message);

	const roomId = message.roomId || get(currentRoomId);
	if (!roomId) {
		console.warn('[P2P Handler] No room ID for sync request');
		return;
	}

	try {
		// Get messages from store
		const roomMessages = messages.getRoomMessages(roomId);

		// Encrypt each message content before sending
		let encryptedMessages = roomMessages;
		if (isWasmReady()) {
			encryptedMessages = roomMessages.map((msg) => {
				// Skip already-deleted or system messages
				if (msg.message_type === 'Deleted' || msg.content.startsWith('[')) {
					return msg;
				}

				try {
					const encryptedContent = wasm.encryptMessageContent(roomId, msg.content);
					return {
						...msg,
						content: encryptedContent,
						encrypted: true
					};
				} catch (error) {
					console.warn(`[P2P Handler] Failed to encrypt message ${msg.id}:`, error);
					return msg; // Return unencrypted as fallback
				}
			});
		}

		// Create sync response with encrypted messages
		const syncResponse: SyncResponseMessage = {
			type: 'sync-response',
			roomId,
			messages: encryptedMessages,
			timestamp: Date.now(),
			encrypted: true
		};

		// Send response to requesting peer
		if (sendToPeerFn) {
			sendToPeerFn(peerId, syncResponse);
			console.log(
				`[P2P Handler] Encrypted sync response sent to ${peerId} with ${roomMessages.length} messages`
			);
		} else {
			console.warn('[P2P Handler] No sendToPeer function available');
		}
	} catch (error) {
		console.error('[P2P Handler] Error handling sync request:', error);
	}
}

/**
 * Handle sync response from peer
 */
function handleSyncResponse(message: SyncResponseMessage, peerId: string): void {
	console.log('[P2P Handler] Sync response from:', peerId);

	const { roomId, messages: syncedMessages, encrypted } = message;
	const targetRoomId = roomId || get(currentRoomId);

	if (!targetRoomId) {
		console.warn('[P2P Handler] No room ID for sync response');
		return;
	}

	if (!syncedMessages || !Array.isArray(syncedMessages) || syncedMessages.length === 0) {
		console.log('[P2P Handler] No messages in sync response');
		return;
	}

	const totalMessages = syncedMessages.length;
	console.log(`[P2P Handler] Received ${totalMessages} messages from ${peerId} for sync`);

	// Start sync tracking
	connection.startSync(peerId);

	// Decrypt messages if they are encrypted
	let processedMessages = syncedMessages;
	if (encrypted && isWasmReady()) {
		processedMessages = syncedMessages.map((msg) => {
			// Skip system messages or already-decrypted content
			if (msg.message_type === 'Deleted' || !(msg as Message & { encrypted?: boolean }).encrypted) {
				return msg;
			}

			try {
				const decryptedContent = wasm.decryptMessageContent(msg.content);
				return {
					...msg,
					content: decryptedContent || msg.content,
					encrypted: false
				};
			} catch (error) {
				console.warn(`[P2P Handler] Failed to decrypt synced message ${msg.id}:`, error);
				return {
					...msg,
					content: '[Encrypted message - unable to decrypt]'
				};
			}
		});
	}

	// Get existing messages to check for duplicates
	const existingMessages = messages.getRoomMessages(targetRoomId);
	const existingIds = new Set(existingMessages.map((msg) => msg.id));

	// Filter out duplicates and add new messages with progress tracking
	let newCount = 0;
	let processedCount = 0;

	for (const msg of processedMessages) {
		processedCount++;

		if (!existingIds.has(msg.id)) {
			messages.addMessage(targetRoomId, msg);
			newCount++;
		}

		// Update progress periodically (every 10 messages or at end)
		if (processedCount % 10 === 0 || processedCount === totalMessages) {
			connection.updateSyncProgress(newCount, totalMessages);
		}
	}

	if (newCount > 0) {
		console.log(`[P2P Handler] Added ${newCount} new messages from sync`);

		// Save to WASM storage
		if (isWasmReady()) {
			try {
				wasm.saveRoomMessagesToStorage(targetRoomId);
			} catch (error) {
				console.warn('[P2P Handler] Failed to save synced messages to storage:', error);
			}
		}
	} else {
		console.log('[P2P Handler] No new messages to sync (all duplicates)');
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
	console.log('[P2P Handler] User connected:', senderName || peerId);

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

	console.log('[P2P Handler] Edit message:', { messageId, roomId, newContent });

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

	// Update the message
	messages.updateMessage(targetRoomId, messageId, {
		content: newContent,
		edited: true,
		edit_timestamp: timestamp,
		original_content: existingMsg?.content || null
	});

	// Save to storage
	if (isWasmReady()) {
		try {
			wasm.saveRoomMessagesToStorage(targetRoomId);
		} catch (error) {
			console.warn('[P2P Handler] Failed to save edited message:', error);
		}
	}
}

/**
 * Handle message delete requests
 */
function handleDeleteMessage(message: DeleteMessage, peerId: string): void {
	const { messageId, roomId, senderId } = message;

	console.log('[P2P Handler] Delete message:', { messageId, roomId });

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

	// Mark message as deleted (soft delete)
	messages.updateMessage(targetRoomId, messageId, {
		content: '[Message deleted]',
		message_type: 'Deleted'
	});

	// Save to storage
	if (isWasmReady()) {
		try {
			wasm.saveRoomMessagesToStorage(targetRoomId);
		} catch (error) {
			console.warn('[P2P Handler] Failed to save deleted message:', error);
		}
	}
}

/**
 * Handle message reactions
 */
function handleReactionMessage(message: ReactionMessage, peerId: string): void {
	const { messageId, roomId, reaction, senderId, senderName, action } = message;

	console.log('[P2P Handler] Reaction message:', { messageId, roomId, reaction, action });

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

	// Update reactions
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

	// Save to storage
	if (isWasmReady()) {
		try {
			wasm.saveRoomMessagesToStorage(targetRoomId);
		} catch (error) {
			console.warn('[P2P Handler] Failed to save reaction:', error);
		}
	}
}

/**
 * Handle delivery acknowledgment messages
 */
function handleDeliveryAck(message: DeliveryAckMessage, peerId: string): void {
	const { messageId } = message;

	console.log('[P2P Handler] Delivery ack received:', { messageId, peerId });

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
