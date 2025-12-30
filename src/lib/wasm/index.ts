/**
 * WASM Module Manager
 * Handles WASM loading and safe proxy creation for Svelte
 */

import { browser } from '$app/environment';
import { writable, get } from 'svelte/store';
import { setupCryptoBridge } from './crypto';
import type { WasmModule } from './types';

// Store for WASM module state
export const wasmLoaded = writable(false);
export const wasmError = writable<Error | null>(null);

// Private module reference
let wasmModule: WasmModule | null = null;

/**
 * Get the raw WASM module (for advanced use cases)
 */
export function getWasmModule(): WasmModule | null {
	return wasmModule;
}

/**
 * Load the WebAssembly module
 */
export async function loadWasm(): Promise<boolean> {
	if (!browser) {
		console.warn('WASM can only be loaded in browser');
		return false;
	}

	if (wasmModule) {
		console.log('WASM already loaded');
		return true;
	}

	try {
		// Setup crypto bridge first
		setupCryptoBridge();

		// Dynamic import of the WASM module
		const wasm = await import('../../../pkg/mindline.js');
		await wasm.default(); // Initialize the WASM module

		wasmModule = wasm as unknown as WasmModule;
		wasmLoaded.set(true);
		wasmError.set(null);

		console.log('WASM module loaded successfully');
		return true;
	} catch (err) {
		const error = err instanceof Error ? err : new Error(String(err));
		console.error('Failed to load WASM module:', error);
		wasmError.set(error);
		wasmLoaded.set(false);
		return false;
	}
}

// Parameter transform types
type ParamTransform = typeof Boolean | typeof Number | ((v: unknown) => unknown);
type ParamTransforms = Record<string, ParamTransform>;

/**
 * Create a safe wrapper for WASM function calls with parameter validation
 */
function createSafeCall<T extends unknown[], R>(
	funcName: string,
	paramNames: string[] = [],
	paramTransforms: ParamTransforms = {}
): (...args: T) => R {
	return (...args: T): R => {
		// Validate parameter count
		if (args.length !== paramNames.length) {
			throw new Error(
				`${funcName}: expected ${paramNames.length} parameters (${paramNames.join(', ')}), got ${args.length}`
			);
		}

		// Transform parameters if needed
		const transformedArgs = args.map((arg, index) => {
			const paramName = paramNames[index];
			const transform = paramTransforms[paramName];

			if (arg === undefined || arg === null) {
				if (transform === Number) {
					console.warn(`${funcName}: parameter '${paramName}' is undefined, using 0`);
					return 0;
				}
				return arg;
			}

			if (transform) {
				if (transform === Boolean) {
					return Boolean(arg);
				} else if (transform === Number) {
					const num = Number(arg);
					if (isNaN(num)) {
						console.warn(`${funcName}: parameter '${paramName}' is NaN, using 0`);
						return 0;
					}
					return num;
				} else if (typeof transform === 'function') {
					return transform(arg);
				}
			}

			return arg;
		});

		// Check if WASM module is loaded
		if (!wasmModule) {
			throw new Error(`WASM module not loaded for function: ${funcName}`);
		}

		const wasmFunc = (wasmModule as unknown as Record<string, unknown>)[funcName];
		if (!wasmFunc || typeof wasmFunc !== 'function') {
			throw new Error(`WASM function '${funcName}' not found or not callable`);
		}

		try {
			return (wasmFunc as (...args: unknown[]) => R).apply(wasmModule, transformedArgs);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(`WASM call failed: ${funcName} - ${message}`);
		}
	};
}

/**
 * Safe WASM proxy object with type-safe function calls
 */
export const wasm = {
	// Core initialization
	initialize: (userName: string, userId: string) =>
		createSafeCall<[string, string], void>('initialize', ['userName', 'userId'])(
			userName,
			userId
		),

	joinRoom: (roomId: string, signalData: string) =>
		createSafeCall<[string, string], void>('join_room', ['roomId', 'signalData'])(
			roomId,
			signalData
		),

	createRoom: (roomId: string) =>
		createSafeCall<[string], void>('create_room_with_id', ['roomId'])(roomId),

	sendMessage: (roomId: string, content: string, messageId: string) =>
		createSafeCall<[string, string, string], void>('send_message', [
			'roomId',
			'content',
			'messageId'
		])(roomId, content, messageId),

	getMessages: (roomId: string) =>
		createSafeCall<[string], string>('get_messages', ['roomId'])(roomId),

	// State management
	getCurrentUserId: () => createSafeCall<[], string>('get_current_user_id', [])(),

	getCurrentRoomId: () => createSafeCall<[], string>('get_current_room_id', [])(),

	setCurrentRoomId: (roomId: string) =>
		createSafeCall<[string], void>('set_current_room_id', ['roomId'])(roomId),

	updateUserSession: (name: string, userId: string) =>
		createSafeCall<[string, string], void>('update_user_session', ['name', 'userId'])(
			name,
			userId
		),

	// Draft messages
	getDraftMessages: () => createSafeCall<[], string>('get_draft_messages', [])(),

	setDraftMessage: (peerId: string, content: string, senderName: string) =>
		createSafeCall<[string, string, string], void>('set_draft_message', [
			'peerId',
			'content',
			'senderName'
		])(peerId, content, senderName),

	clearDraftMessage: (peerId: string) =>
		createSafeCall<[string], void>('clear_draft_message', ['peerId'])(peerId),

	// P2P state
	getConnectedPeers: () => createSafeCall<[], string>('get_connected_peers', [])(),

	addConnectedPeer: (peerId: string) =>
		createSafeCall<[string], void>('add_connected_peer', ['peerId'])(peerId),

	removeConnectedPeer: (peerId: string) =>
		createSafeCall<[string], void>('remove_connected_peer', ['peerId'])(peerId),

	clearAllConnectedPeers: () => createSafeCall<[], void>('clear_all_connected_peers', [])(),

	// Utilities
	generateUuid: () => createSafeCall<[], string>('generate_uuid', [])(),

	getRoomFromUrl: () => createSafeCall<[], string | null>('get_room_from_url', [])(),

	updateUrlWithRoom: (roomId: string) =>
		createSafeCall<[string], void>('update_url_with_room', ['roomId'])(roomId),

	// Validation
	validateRoomId: (roomId: string) =>
		createSafeCall<[string], boolean>('validate_room_id', ['roomId'])(roomId),

	validateUsername: (username: string) =>
		createSafeCall<[string], boolean>('validate_username', ['username'])(username),

	validateMessage: (message: string) =>
		createSafeCall<[string], boolean>('validate_message', ['message'])(message),

	// Enhanced message processing
	setMessageManagerUser: (userId: string) =>
		createSafeCall<[string], void>('set_message_manager_user', ['userId'])(userId),

	sendMessageEnhanced: (roomId: string, content: string, messageId: string) =>
		createSafeCall<[string, string, string], void>('send_message_enhanced', [
			'roomId',
			'content',
			'messageId'
		])(roomId, content, messageId),

	receiveMessageFromPeer: (messageData: unknown) =>
		createSafeCall<[unknown], void>('receive_message_from_peer', ['messageData'], {
			messageData: (v: unknown) => v
		})(messageData),

	getRoomMessages: (roomId: string, limit: number) =>
		createSafeCall<[string, number], string>('get_room_messages', ['roomId', 'limit'], {
			limit: Number
		})(roomId, limit),

	getRoomMessageStats: (roomId: string) =>
		createSafeCall<[string], string>('get_room_message_stats', ['roomId'])(roomId),

	createSyncRequest: (roomId: string, lastSync: number, messageCount: number) =>
		createSafeCall<[string, number, number], string>('create_sync_request', [
			'roomId',
			'lastSync',
			'messageCount'
		])(roomId, lastSync, messageCount),

	handleSyncRequest: (requestData: unknown) =>
		createSafeCall<[unknown], string>('handle_sync_request', ['requestData'], {
			requestData: (v: unknown) => v
		})(requestData),

	saveRoomMessagesToStorage: (roomId: string) =>
		createSafeCall<[string], void>('save_room_messages_to_storage', ['roomId'])(roomId),

	loadRoomMessagesFromStorage: (roomId: string) =>
		createSafeCall<[string], void>('load_room_messages_from_storage', ['roomId'])(roomId),

	// Encryption
	decryptMessageContent: (content: string) =>
		createSafeCall<[string], string>('decrypt_message_content', ['content'])(content),

	encryptMessageContent: (roomId: string, content: string) =>
		createSafeCall<[string, string], string>('encrypt_message_content', ['roomId', 'content'])(
			roomId,
			content
		),

	// Encryption key management
	initializeRoomEncryption: (roomId: string) =>
		createSafeCall<[string], boolean>('initialize_room_encryption', ['roomId'])(roomId),

	generateRoomKey: (roomId: string) =>
		createSafeCall<[string], string>('generate_room_encryption_key', ['roomId'])(roomId),

	saveRoomKeyToStorage: (roomId: string) =>
		createSafeCall<[string], void>('save_room_key_to_storage', ['roomId'])(roomId),

	loadRoomKeyFromStorage: (roomId: string) =>
		createSafeCall<[string], boolean>('load_room_key_from_storage', ['roomId'])(roomId),

	hasRoomKeyInStorage: (roomId: string) =>
		createSafeCall<[string], boolean>('has_room_key_in_storage', ['roomId'])(roomId),

	hasRoomKey: (roomId: string) =>
		createSafeCall<[string], boolean>('has_room_key', ['roomId'])(roomId),

	listEncryptionKeys: () => createSafeCall<[], unknown[]>('list_encryption_keys', [])(),

	// Logging
	initializeLogger: (developmentMode: boolean, debugEnabled: boolean) =>
		createSafeCall<[boolean, boolean], void>('initialize_logger', [
			'developmentMode',
			'debugEnabled'
		])(developmentMode, debugEnabled),

	logInfo: (component: string, message: string) =>
		createSafeCall<[string, string], void>('log_info', ['component', 'message'])(
			component,
			message
		),

	logWarn: (component: string, message: string) =>
		createSafeCall<[string, string], void>('log_warn', ['component', 'message'])(
			component,
			message
		),

	logError: (component: string, message: string) =>
		createSafeCall<[string, string], void>('log_error', ['component', 'message'])(
			component,
			message
		),

	logDebug: (component: string, message: string) =>
		createSafeCall<[string, string], void>('log_debug', ['component', 'message'])(
			component,
			message
		),

	enableDebugLogging: () => createSafeCall<[], void>('enable_debug_logging', [])(),

	disableDebugLogging: () => createSafeCall<[], void>('disable_debug_logging', [])()
};

/**
 * Check if WASM is ready to use
 */
export function isWasmReady(): boolean {
	return get(wasmLoaded) && wasmModule !== null;
}
