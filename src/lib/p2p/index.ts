/**
 * P2P Module Exports
 */

// Types
export type {
	P2PConfig,
	P2PMessage,
	SignalingMessage,
	SignalingMessageType,
	P2PMessageType,
	TypedP2PMessage,
	ChatMessage,
	TypingMessage,
	SyncRequestMessage,
	SyncResponseMessage,
	UserConnectedMessage,
	EditMessage,
	DeleteMessage,
	ReactionMessage,
	MessageCallback,
	PeerCallback,
	ConnectionLostCallback,
	PeerConnectionState,
	PeerState
} from './types';

// Type guards
export {
	isChatMessage,
	isTypingMessage,
	isSyncRequestMessage,
	isSyncResponseMessage,
	isUserConnectedMessage,
	isEditMessage,
	isDeleteMessage,
	isReactionMessage,
	DEFAULT_CONFIG
} from './types';

// Connection class (for advanced use)
export { P2PConnection } from './connection';

// Manager functions (primary API)
export {
	initializeP2P,
	disconnectP2P,
	reconnectP2P,
	broadcastMessage,
	broadcastChat,
	broadcastTyping,
	broadcastEdit,
	broadcastDelete,
	broadcastReaction,
	getP2PConnection,
	getSessionDeviceId,
	isP2PConnected,
	getConnectedPeerCount,
	// Lifecycle handlers for mobile
	setupVisibilityHandler,
	cleanupVisibilityHandler,
	setupNetworkHandler,
	cleanupNetworkHandler,
	setupPageLifecycleHandlers,
	cleanupPageLifecycleHandlers,
	NoRoomKeyError
} from './manager';

// Crypto session
export { CryptoSession } from './crypto-session';

// Handler utilities
export { emitToast } from './handlers';

// Configuration utilities
export { getP2PConfig, getSignalingConfig, isMobileDevice, isMobileNetwork, getDevConfig, getTestConfig, isTestMode, isStrictDirectMode } from './config';
