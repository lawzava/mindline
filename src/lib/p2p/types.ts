/**
 * P2P Types
 */

import type { Message } from '$lib/wasm/types';

// ============================================
// Configuration Types
// ============================================

export interface P2PConfig {
	signalingServer: string;
	useSSL: boolean;
	websocketPath: string;
	turnServers?: RTCIceServer[];
}

export const DEFAULT_CONFIG: P2PConfig = {
	signalingServer: 'localhost:3000',
	useSSL: false,
	websocketPath: '/ws'
};

// ============================================
// Signaling Message Types
// ============================================

export type SignalingMessageType =
	| 'join'
	| 'room-joined'
	| 'peer-joined'
	| 'peer-left'
	| 'offer'
	| 'answer'
	| 'ice-candidate'
	| 'relay'
	| 'client-id'
	| 'error'
	| 'leave';

export interface SignalingMessage {
	type: SignalingMessageType;
	roomId?: string;
	clientId?: string;
	yourId?: string;
	peers?: string[];
	fromId?: string;
	targetId?: string;
	data?: RTCSessionDescriptionInit | RTCIceCandidateInit | TypedP2PMessage;
	error?: string;
}

// ============================================
// P2P Message Types (Discriminated Unions)
// ============================================

export type P2PMessageType =
	| 'chat'
	| 'typing'
	| 'sync-request'
	| 'sync-response'
	| 'user-connected'
	| 'edit'
	| 'delete'
	| 'reaction';

/** Chat message sent between peers */
export interface ChatMessage {
	type: 'chat';
	content: string;
	senderId: string;
	senderName: string;
	messageId: string;
	timestamp: number;
	roomId: string;
	encrypted?: boolean;
}

/** Typing indicator showing what a peer is currently typing */
export interface TypingMessage {
	type: 'typing';
	content: string;
	senderId: string;
	senderName: string;
	timestamp: number;
}

/** Request for message synchronization when reconnecting */
export interface SyncRequestMessage {
	type: 'sync-request';
	roomId: string;
	lastSync: number;
	messageCount: number;
	requesterId: string;
}

/** Response containing messages for synchronization */
export interface SyncResponseMessage {
	type: 'sync-response';
	roomId: string;
	messages: Message[];
	timestamp: number;
}

/** Notification when a user connects to the room */
export interface UserConnectedMessage {
	type: 'user-connected';
	senderId: string;
	senderName: string;
	timestamp: number;
}

/** Edit an existing message */
export interface EditMessage {
	type: 'edit';
	messageId: string;
	roomId: string;
	newContent: string;
	senderId: string;
	timestamp: number;
}

/** Delete an existing message */
export interface DeleteMessage {
	type: 'delete';
	messageId: string;
	roomId: string;
	senderId: string;
	timestamp: number;
}

/** Add or remove a reaction to a message */
export interface ReactionMessage {
	type: 'reaction';
	messageId: string;
	roomId: string;
	reaction: string;
	senderId: string;
	senderName: string;
	action: 'add' | 'remove';
	timestamp: number;
}

/** Union type for all P2P messages */
export type TypedP2PMessage =
	| ChatMessage
	| TypingMessage
	| SyncRequestMessage
	| SyncResponseMessage
	| UserConnectedMessage
	| EditMessage
	| DeleteMessage
	| ReactionMessage;

// Legacy P2PMessage type for backwards compatibility
export interface P2PMessage {
	type: string;
	[key: string]: unknown;
}

// ============================================
// Callback Types
// ============================================

export type MessageCallback = (message: TypedP2PMessage, peerId: string) => void;
export type PeerCallback = (peerId: string) => void;
export type ConnectionLostCallback = (reason: string) => void;

// ============================================
// Connection State Types
// ============================================

export type PeerConnectionState = 'new' | 'connecting' | 'connected' | 'disconnected' | 'failed' | 'closed';

export interface PeerState {
	id: string;
	connectionState: PeerConnectionState;
	dataChannelState: RTCDataChannelState | null;
	usingRelay: boolean;
}

// ============================================
// Type Guards
// ============================================

export function isChatMessage(msg: TypedP2PMessage): msg is ChatMessage {
	return msg.type === 'chat';
}

export function isTypingMessage(msg: TypedP2PMessage): msg is TypingMessage {
	return msg.type === 'typing';
}

export function isSyncRequestMessage(msg: TypedP2PMessage): msg is SyncRequestMessage {
	return msg.type === 'sync-request';
}

export function isSyncResponseMessage(msg: TypedP2PMessage): msg is SyncResponseMessage {
	return msg.type === 'sync-response';
}

export function isUserConnectedMessage(msg: TypedP2PMessage): msg is UserConnectedMessage {
	return msg.type === 'user-connected';
}

export function isEditMessage(msg: TypedP2PMessage): msg is EditMessage {
	return msg.type === 'edit';
}

export function isDeleteMessage(msg: TypedP2PMessage): msg is DeleteMessage {
	return msg.type === 'delete';
}

export function isReactionMessage(msg: TypedP2PMessage): msg is ReactionMessage {
	return msg.type === 'reaction';
}
