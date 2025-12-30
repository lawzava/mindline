/**
 * TypeScript types for WASM module
 */

export interface WasmModule {
	// Core initialization
	initialize(userName: string, userId: string): void;
	join_room(roomId: string, signalData: string): void;
	create_room_with_id(roomId: string): void;
	send_message(roomId: string, content: string, messageId: string): void;
	get_messages(roomId: string): string;

	// State management
	get_current_user_id(): string;
	get_current_room_id(): string;
	set_current_room_id(roomId: string): void;
	update_user_session(name: string, userId: string): void;

	// Draft messages
	get_draft_messages(): string;
	set_draft_message(peerId: string, content: string, senderName: string): void;
	clear_draft_message(peerId: string): void;

	// P2P state
	get_connected_peers(): string;
	add_connected_peer(peerId: string): void;
	remove_connected_peer(peerId: string): void;
	clear_all_connected_peers(): void;

	// Utilities
	generate_uuid(): string;
	get_room_from_url(): string | null;
	update_url_with_room(roomId: string): void;

	// Validation
	validate_room_id(roomId: string): boolean;
	validate_username(username: string): boolean;
	validate_message(message: string): boolean;

	// Enhanced message processing
	set_message_manager_user(userId: string): void;
	send_message_enhanced(roomId: string, content: string, messageId: string): void;
	receive_message_from_peer(messageData: unknown): void;
	get_room_messages(roomId: string, limit: number): string;
	get_room_message_stats(roomId: string): string;
	create_sync_request(roomId: string, lastSync: number, messageCount: number): string;
	handle_sync_request(requestData: unknown): string;
	save_room_messages_to_storage(roomId: string): void;
	load_room_messages_from_storage(roomId: string): void;

	// Encryption
	decrypt_message_content(content: string): string;

	// Performance
	record_performance_metric(name: string, value: number, unit: string, category: string): void;
	start_performance_monitoring(): void;

	// Logging
	initialize_logger(developmentMode: boolean, debugEnabled: boolean): void;
	log_info(component: string, message: string): void;
	log_warn(component: string, message: string): void;
	log_error(component: string, message: string): void;
	log_debug(component: string, message: string): void;
	set_log_context(userId: string, roomId: string, component: string): void;
	enable_debug_logging(): void;
	disable_debug_logging(): void;
	start_performance_timer(label: string): void;
	end_performance_timer(label: string): void;
	start_log_group(label: string): void;
	end_log_group(): void;
	log_table(data: string): void;
	search_logs(query: string, limit: number): string;
	get_log_statistics(): string;
	export_logs_json(filter: string): string;
	get_error_summary(minutes: number): string;
	configure_logger(
		maxEntries: number,
		consoleOutput: boolean,
		bufferLogs: boolean,
		autoExportErrors: boolean
	): void;
}

export interface Message {
	id: string;
	sender_id: string;
	sender_name: string;
	message_type: string;
	content: string;
	timestamp: number;
	room_id: string;
	status: string;
	edited: boolean;
	edit_timestamp: number | null;
	original_content: string | null;
	reply_to: string | null;
	reactions: Record<string, { users: string[]; count: number }>;
	mentions: string[];
	local_timestamp: number;
	delivery_attempts: number;
	size_bytes: number;
}

export interface DraftMessage {
	peerId: string;
	content: string;
	senderName: string;
	timestamp: number;
}

export interface RoomStats {
	messageCount: number;
	lastMessageTimestamp: number;
	oldestMessageTimestamp: number;
}

export interface SyncRequest {
	roomId: string;
	lastSync: number;
	messageCount: number;
	requesterId: string;
}
