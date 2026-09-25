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
import { remotePeerOwnsMessage } from './ownership';
import { applyReaction } from './reactions';
import { paginateSyncMessages } from './sync';
import type { Message } from '$lib/types/message';
import type { MediaAbort, MediaAccept, MediaOffer } from '$lib/media/transfer';
import { get } from 'svelte/store';
import { toast } from 'svelte-sonner';

/**
 * Get P2P manager reference for sending responses
 * This is set by the manager module to avoid circular dependencies
 */
type SendToPeer = (peerId: string, message: TypedP2PMessage) => void | Promise<void>;
let sendToPeerFn: SendToPeer | null = null;

export function setSendToPeerFn(fn: SendToPeer): void {
	sendToPeerFn = fn;
}

/** This device's verified id, from the manager (avoids a circular import). */
let selfDeviceFn: () => string | null = () => null;

export function setSelfDeviceFn(fn: () => string | null): void {
	selfDeviceFn = fn;
}

/** Media engine hook, registered by the manager per room session. */
let mediaControlFn:
	| ((message: MediaOffer | MediaAccept | MediaAbort, peerId: string) => void)
	| null = null;

export function setMediaControlFn(
	fn: ((message: MediaOffer | MediaAccept | MediaAbort, peerId: string) => void) | null
): void {
	mediaControlFn = fn;
}

/**
 * The room this session is bound to, or null when the body names another.
 * The envelope is sealed under this room's keys, but body.roomId is
 * sender-chosen: trusting it would let a member of one room write into, or
 * pull history from, any other room held in this tab.
 */
function sessionRoom(bodyRoomId: string | undefined): string | null {
	const roomId = get(currentRoomId);
	if (!roomId) return null;
	if (bodyRoomId && bodyRoomId !== roomId) {
		console.warn('[P2P Handler] Message names another room; ignoring');
		return null;
	}
	return roomId;
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
				void handleSyncRequest(message, peerId);
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
			case 'media-offer':
				// Only let the transfer engine act if the offer passed the
				// session-room check; a mismatched-room offer is dropped entirely.
				if (handleMediaOffer(message, peerId)) {
					mediaControlFn?.(message, peerId);
				}
				break;
			case 'media-accept':
			case 'media-abort':
				mediaControlFn?.(message, peerId);
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
	const { content, senderName, messageId, timestamp } = message;

	if (!content) {
		console.warn('[P2P Handler] Invalid chat message received');
		return;
	}
	const targetRoomId = sessionRoom(message.roomId);
	if (!targetRoomId) return;

	// Update peer name mapping if we have a name
	if (senderName) {
		connection.setPeerName(peerId, senderName);
	}

	// Create message object
	const messageObj: Message = {
		id: messageId || `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`,
		// Identity is the envelope-verified device; body.senderId is
		// self-asserted and would let a member render as anyone, even "you".
		sender_id: peerId,
		sender_name: senderName || peerId,
		message_type: 'Text',
		content,
		timestamp: timestamp || Date.now(),
		room_id: targetRoomId,
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
		sender_device: peerId
	};

	messages.addMessage(targetRoomId, messageObj);
	void saveRoomMessages(targetRoomId, messages.getRoomMessages(targetRoomId));

	// Send delivery acknowledgment back to sender
	acknowledge(peerId, targetRoomId, messageObj.id);

	// Clear the typing indicator for this peer since they sent a message
	drafts.clearDraft(peerId);
}

/**
 * A media offer arrived: place a Media message in the stream so the
 * receiver sees the incoming item with progress; the engine moves the bytes.
 */
function handleMediaOffer(offer: MediaOffer, peerId: string): boolean {
	// Place the message in the cryptographically-bound session room, not the
	// attacker-settable offer.roomId. Drop offers that claim a different room;
	// returning false makes the caller skip the transfer engine too.
	const targetRoomId = sessionRoom(offer.roomId);
	if (!targetRoomId) return false;
	// Ids are sender-chosen: reusing one would swap the stored blob or the
	// message of an existing attachment, including someone else's.
	const existing = messages.getRoomMessages(targetRoomId);
	if (
		existing.some((m) => m.id === offer.messageId || m.attachment?.transferId === offer.transferId)
	) {
		console.warn('[P2P Handler] Media offer reuses an existing id; ignoring');
		return false;
	}
	if (offer.senderName) connection.setPeerName(peerId, offer.senderName);

	const messageObj: Message = {
		id: offer.messageId,
		// Bind identity to the envelope-verified peerId; offer.senderId is
		// self-asserted and not trusted. sender_name below is display-only.
		sender_id: peerId,
		sender_name: offer.senderName || peerId,
		message_type: 'Media',
		content: offer.name,
		timestamp: offer.timestamp || Date.now(),
		room_id: targetRoomId,
		status: 'Sent',
		edited: false,
		edit_timestamp: null,
		original_content: null,
		reply_to: null,
		reactions: {},
		mentions: [],
		local_timestamp: Date.now(),
		delivery_attempts: 0,
		size_bytes: offer.size,
		sender_device: peerId,
		attachment: {
			transferId: offer.transferId,
			kind: offer.kind,
			name: offer.name,
			mime: offer.mime,
			size: offer.size,
			thumb: offer.thumb,
			thumbMime: offer.thumbMime,
			duration: offer.duration,
			waveform: offer.waveform,
			state: 'transferring'
		}
	};
	messages.addMessage(targetRoomId, messageObj);
	void saveRoomMessages(targetRoomId, messages.getRoomMessages(targetRoomId));
	return true;
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
async function handleSyncRequest(message: SyncRequestMessage, peerId: string): Promise<void> {
	const roomId = sessionRoom(message.roomId);
	if (!roomId) return;

	try {
		const roomMessages = messages.getRoomMessages(roomId);
		// Keep this room's connection while awaiting pages; a room switch may
		// replace the global callback before the previous history finishes.
		const send = sendToPeerFn;
		if (send) {
			for (const page of paginateSyncMessages(roomMessages)) {
				const syncResponse: SyncResponseMessage = {
					type: 'sync-response',
					roomId,
					messages: page,
					timestamp: Date.now()
				};
				await send(peerId, syncResponse);
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
	const { messages: syncedMessages } = message;
	const targetRoomId = sessionRoom(message.roomId);
	if (!targetRoomId) return;

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
	const selfIds = new Set([get(user).id, selfDeviceFn()].filter(Boolean));

	for (const msg of processedMessages) {
		processedCount++;

		const existingMsg = existingById.get(msg.id);
		if (!existingMsg) {
			// Synced history is peer-asserted (unsigned per message), so it may
			// not put words in this user's mouth: a copy of our own message is
			// only ever accepted when we already hold it.
			if (selfIds.has(msg.sender_id) || (msg.sender_device && selfIds.has(msg.sender_device))) {
				continue;
			}
			messages.addMessage(targetRoomId, { ...msg, room_id: targetRoomId, synced: true });
			newCount++;
			// Only the author learns anything from this: a member's own message
			// that reached us through its history is now delivered to us.
			if (msg.sender_device === peerId) acknowledge(peerId, targetRoomId, msg.id);
		} else {
			// Message exists - check if synced version has important updates
			// Prefer deleted state: if synced message is deleted but local isn't, update local
			const syncedIsDeleted = msg.message_type === 'Deleted' || msg.content === '[Message deleted]';
			const localIsDeleted =
				existingMsg.message_type === 'Deleted' || existingMsg.content === '[Message deleted]';

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
					messages.updateMessage(targetRoomId, msg.id, {
						reactions: mergedReactions
					});
				}
			}
		}

		// Update progress periodically (every 10 messages or at end)
		if (processedCount % 10 === 0 || processedCount === totalMessages) {
			connection.updateSyncProgress(newCount, totalMessages);
		}
	}

	if (newCount > 0) {
		void saveRoomMessages(targetRoomId, messages.getRoomMessages(targetRoomId));
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
	const { senderName } = message;
	const alreadyAnnounced = connection.getPeerName(peerId) !== undefined;

	// Store the peer's name using the WebRTC peerId (not senderId)
	// This ensures $peerNames matches $connectedPeers which uses WebRTC peer IDs
	if (senderName) {
		connection.setPeerName(peerId, senderName);
	}

	// The peer repeats its announcement to cover channel startup races.
	// Its name is removed on departure, allowing a real rejoin notice.
	if (senderName && !alreadyAnnounced) {
		toast.success(`${senderName} is here`);
	}
}

/**
 * Handle message edit requests
 */
function handleEditMessage(message: EditMessage, peerId: string): void {
	const { messageId, newContent, timestamp } = message;

	const targetRoomId = sessionRoom(message.roomId);
	if (!targetRoomId || !messageId) {
		console.warn('[P2P Handler] Invalid edit message');
		return;
	}

	// Authorization: the envelope-verified device must own the message
	// (PROTOCOL.md §3.7). Fail closed — no body-asserted fallback.
	const existingMsg = messages.getMessage(targetRoomId, messageId);
	if (!existingMsg) return;
	if (!remotePeerOwnsMessage(existingMsg, peerId)) {
		console.warn('[P2P Handler] Edit rejected: device does not own message');
		return;
	}

	// Update the message in TS store
	messages.updateMessage(targetRoomId, messageId, {
		content: newContent,
		edited: true,
		edit_timestamp: timestamp,
		original_content: existingMsg.content || null
	});

	void saveRoomMessages(targetRoomId, messages.getRoomMessages(targetRoomId));
}

/**
 * Handle message delete requests
 */
function handleDeleteMessage(message: DeleteMessage, peerId: string): void {
	const { messageId } = message;

	const targetRoomId = sessionRoom(message.roomId);
	if (!targetRoomId || !messageId) {
		console.warn('[P2P Handler] Invalid delete message');
		return;
	}

	// Authorization: the envelope-verified device must own the message
	// (PROTOCOL.md §3.7). Fail closed — no body-asserted fallback.
	const existingMsg = messages.getMessage(targetRoomId, messageId);
	if (!existingMsg) return;
	if (!remotePeerOwnsMessage(existingMsg, peerId)) {
		console.warn('[P2P Handler] Delete rejected: device does not own message');
		return;
	}

	// Mark message as deleted (soft delete) in TS store
	messages.updateMessage(targetRoomId, messageId, {
		content: '[Message deleted]',
		message_type: 'Deleted'
	});

	void saveRoomMessages(targetRoomId, messages.getRoomMessages(targetRoomId));
}

/**
 * Handle message reactions
 */
function handleReactionMessage(message: ReactionMessage, peerId: string): void {
	const { messageId, reaction, action } = message;

	const targetRoomId = sessionRoom(message.roomId);
	if (!targetRoomId || !messageId || !reaction) {
		console.warn('[P2P Handler] Invalid reaction message');
		return;
	}

	const existingMsg = messages.getMessage(targetRoomId, messageId);
	if (!existingMsg) {
		console.warn('[P2P Handler] Message not found for reaction');
		return;
	}

	// Membership is keyed by the envelope-verified peerId; the body's
	// senderId is self-asserted and ignored (PROTOCOL.md §3.5).
	const reactions = applyReaction(existingMsg.reactions, reaction, peerId, action);
	messages.updateMessage(targetRoomId, messageId, { reactions });

	void saveRoomMessages(targetRoomId, messages.getRoomMessages(targetRoomId));
}

/**
 * Handle delivery acknowledgment messages
 */
function handleDeliveryAck(message: DeliveryAckMessage, peerId: string): void {
	const { messageId } = message;
	const roomId = sessionRoom(message.roomId);
	if (!roomId) return;

	// Record the delivery in our tracking store
	delivery.recordDelivery(messageId, peerId);

	// Persist the outcome on the message so the tick survives a reload. A
	// message sent while alone counts as delivered once any member confirms
	// it arrived (usually through history sync).
	const msg = messages.getMessage(roomId, messageId);
	if (!msg || msg.sender_id !== get(user).id || msg.status === 'Delivered') return;
	const tracked = delivery.getDeliveryStatus(messageId);
	const done =
		msg.status === 'Local' ||
		(!!tracked && tracked.total > 0 && tracked.delivered >= tracked.total);
	if (!done) return;
	messages.updateMessage(roomId, messageId, { status: 'Delivered' });
	void saveRoomMessages(roomId, messages.getRoomMessages(roomId));
}

/** Tell a member its own message reached this device. */
function acknowledge(peerId: string, roomId: string, messageId: string): void {
	sendToPeerFn?.(peerId, {
		type: 'delivery-ack',
		messageId,
		roomId,
		peerId: get(user).id,
		timestamp: Date.now()
	});
}

/**
 * Emit a toast notification
 */
export function emitToast(
	type: 'peer-joined' | 'peer-left' | 'error' | 'success' | 'info',
	message: string
): void {
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
