/* tslint:disable */
/* eslint-disable */
/**
 * Save room encryption key to localStorage
 */
export function save_room_key_to_storage(room_id: string): void;
/**
 * Encrypt message content using room key (async - returns Promise)
 * Uses real AES-256-GCM via Web Crypto API
 */
export function encrypt_message_content(room_id: string, content: string): Promise<any>;
/**
 * Check if room has a key in localStorage
 */
export function has_room_key_in_storage(room_id: string): boolean;
/**
 * Check if room has a key in memory
 */
export function has_room_key(room_id: string): boolean;
/**
 * Initialize room encryption - loads from storage or generates new key
 */
export function initialize_room_encryption(room_id: string): boolean;
/**
 * Decrypt message content using room key (async - returns Promise)
 * Uses real AES-256-GCM via Web Crypto API
 */
export function decrypt_message_content(encrypted_json: string): Promise<any>;
/**
 * Load room encryption key from localStorage
 * Returns true if key was loaded, false if no key exists
 */
export function load_room_key_from_storage(room_id: string): boolean;
export function start_log_group(label: string): void;
export function enable_debug_logging(): void;
export function initialize_logger(is_development: boolean, debug_enabled: boolean): void;
export function log_info(component: string, message: string): void;
export function end_log_group(): void;
export function log_debug(component: string, message: string): void;
export function search_logs(query: string, limit?: number | null): any;
export function set_log_context(user_id?: string | null, room_id?: string | null, component?: string | null): void;
export function get_error_summary(last_n_minutes: number): any;
export function disable_debug_logging(): void;
export function get_log_entries(filter_json?: string | null): any;
export function get_log_statistics(): any;
export function log_with_data(level: string, component: string, message: string, data: string): void;
export function configure_logger(max_entries: number, console_output: boolean, buffer_logs: boolean, auto_export_errors: boolean): void;
export function log_warn(component: string, message: string): void;
export function log_table(data: any): void;
export function export_logs_json(filter_json?: string | null): string;
export function log_error(component: string, message: string): void;
export function get_room_messages(room_id: string, limit?: number | null): any;
export function receive_message_from_peer(message_data: any): boolean;
export function send_message_enhanced(room_id: string, content: string, message_id: string): any;
export function set_message_manager_user(user_id: string): void;
export function create_sync_request(room_id: string, last_sync: number, message_count: number): any;
export function edit_message(room_id: string, message_id: string, new_content: string): void;
export function remove_reaction(room_id: string, message_id: string, emoji: string, user_id: string): void;
export function get_room_message_stats(room_id: string): any;
export function delete_message(room_id: string, message_id: string): void;
export function add_reaction(room_id: string, message_id: string, emoji: string, user_id: string): void;
export function save_room_messages_to_storage(room_id: string): void;
export function load_room_messages_from_storage(room_id: string): boolean;
export function handle_sync_request(request_data: any): any;
export function record_performance_metric(name: string, value: number, unit: string, category: string): void;
export function get_performance_counter(name: string): bigint;
export function delete_encryption_key(key_id: string): boolean;
export function cleanup_old_storage_data(days_old: number): number;
export function generate_room_encryption_key(room_id: string): string;
export function list_encryption_keys(): any;
export function get_performance_summary(): any;
export function initialize_storage(database_name: string, version: number): void;
export function start_performance_timer(label: string): void;
export function start_performance_monitoring(): void;
export function end_performance_timer(label: string): number | undefined;
export function increment_performance_counter(name: string): void;
export function list_stored_rooms(): any;
export function validate_message(message: string): string;
export function validate_username(username: string): string;
export function validate_room_id(room_id: string): string;
export function get_messages(room_id: any): any;
export function initialize(user_name: string, user_id: string): void;
export function create_room_with_id(room_id: any): void;
export function send_message(room_id: any, content: any, message_id: any): void;
export function join_room(room_id: any, signal_data: string): string;
export function generate_uuid(): string;
export function get_room_from_url(): string | undefined;
export function update_url_with_room(room_id: string): void;
export function set_current_room_id(room_id: string): void;
export function remove_connected_peer(peer_id: string): void;
export function update_user_session(name: string, user_id: string): void;
export function get_current_user_id(): string;
export function get_draft_messages(): any;
export function clear_all_connected_peers(): void;
export function get_current_room_id(): string;
export function clear_draft_message(peer_id: string): void;
export function add_connected_peer(peer_id: string): void;
export function set_draft_message(peer_id: string, content: string, sender_name: string): void;
export function get_connected_peers(): any;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly add_connected_peer: (a: number, b: number) => [number, number];
  readonly add_reaction: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number];
  readonly cleanup_old_storage_data: (a: number) => [number, number, number];
  readonly clear_all_connected_peers: () => [number, number];
  readonly clear_draft_message: (a: number, b: number) => [number, number];
  readonly configure_logger: (a: number, b: number, c: number, d: number) => [number, number];
  readonly create_room_with_id: (a: any) => [number, number];
  readonly create_sync_request: (a: number, b: number, c: number, d: number) => any;
  readonly decrypt_message_content: (a: number, b: number) => any;
  readonly delete_encryption_key: (a: number, b: number) => number;
  readonly delete_message: (a: number, b: number, c: number, d: number) => [number, number];
  readonly disable_debug_logging: () => [number, number];
  readonly edit_message: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
  readonly enable_debug_logging: () => [number, number];
  readonly encrypt_message_content: (a: number, b: number, c: number, d: number) => any;
  readonly end_log_group: () => [number, number];
  readonly end_performance_timer: (a: number, b: number) => [number, number];
  readonly export_logs_json: (a: number, b: number) => [number, number];
  readonly generate_room_encryption_key: (a: number, b: number) => [number, number, number, number];
  readonly generate_uuid: () => [number, number];
  readonly get_connected_peers: () => any;
  readonly get_current_room_id: () => [number, number];
  readonly get_current_user_id: () => [number, number];
  readonly get_draft_messages: () => any;
  readonly get_error_summary: (a: number) => any;
  readonly get_log_entries: (a: number, b: number) => any;
  readonly get_log_statistics: () => any;
  readonly get_messages: (a: any) => any;
  readonly get_performance_counter: (a: number, b: number) => bigint;
  readonly get_performance_summary: () => any;
  readonly get_room_from_url: () => [number, number];
  readonly get_room_message_stats: (a: number, b: number) => any;
  readonly get_room_messages: (a: number, b: number, c: number) => any;
  readonly handle_sync_request: (a: any) => any;
  readonly has_room_key: (a: number, b: number) => number;
  readonly has_room_key_in_storage: (a: number, b: number) => [number, number, number];
  readonly increment_performance_counter: (a: number, b: number) => [number, number];
  readonly initialize: (a: number, b: number, c: number, d: number) => [number, number];
  readonly initialize_logger: (a: number, b: number) => [number, number];
  readonly initialize_room_encryption: (a: number, b: number) => [number, number, number];
  readonly initialize_storage: (a: number, b: number, c: number) => [number, number];
  readonly join_room: (a: any, b: number, c: number) => [number, number, number, number];
  readonly list_encryption_keys: () => any;
  readonly list_stored_rooms: () => [number, number, number];
  readonly load_room_key_from_storage: (a: number, b: number) => [number, number, number];
  readonly load_room_messages_from_storage: (a: number, b: number) => [number, number, number];
  readonly log_debug: (a: number, b: number, c: number, d: number) => void;
  readonly log_error: (a: number, b: number, c: number, d: number) => void;
  readonly log_info: (a: number, b: number, c: number, d: number) => void;
  readonly log_table: (a: any) => [number, number];
  readonly log_warn: (a: number, b: number, c: number, d: number) => void;
  readonly log_with_data: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number];
  readonly receive_message_from_peer: (a: any) => [number, number, number];
  readonly record_performance_metric: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number];
  readonly remove_connected_peer: (a: number, b: number) => [number, number];
  readonly remove_reaction: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number];
  readonly save_room_key_to_storage: (a: number, b: number) => [number, number];
  readonly save_room_messages_to_storage: (a: number, b: number) => [number, number];
  readonly search_logs: (a: number, b: number, c: number) => any;
  readonly send_message: (a: any, b: any, c: any) => [number, number];
  readonly send_message_enhanced: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
  readonly set_current_room_id: (a: number, b: number) => [number, number];
  readonly set_draft_message: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
  readonly set_log_context: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
  readonly set_message_manager_user: (a: number, b: number) => [number, number];
  readonly start_log_group: (a: number, b: number) => [number, number];
  readonly start_performance_monitoring: () => [number, number];
  readonly start_performance_timer: (a: number, b: number) => [number, number];
  readonly update_url_with_room: (a: number, b: number) => [number, number];
  readonly update_user_session: (a: number, b: number, c: number, d: number) => [number, number];
  readonly validate_message: (a: number, b: number) => [number, number];
  readonly validate_room_id: (a: number, b: number) => [number, number];
  readonly validate_username: (a: number, b: number) => [number, number];
  readonly memory: WebAssembly.Memory;
  readonly __wbindgen_malloc: (a: number, b: number) => number;
  readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
  readonly __wbindgen_exn_store: (a: number) => void;
  readonly __externref_table_alloc: () => number;
  readonly __wbindgen_export_5: WebAssembly.Table;
  readonly __wbindgen_free: (a: number, b: number, c: number) => void;
  readonly __wbindgen_export_7: WebAssembly.Table;
  readonly __externref_table_dealloc: (a: number) => void;
  readonly closure245_externref_shim: (a: number, b: number, c: any) => void;
  readonly closure110_externref_shim: (a: number, b: number, c: any, d: any) => void;
  readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;
/**
* Instantiates the given `module`, which can either be bytes or
* a precompiled `WebAssembly.Module`.
*
* @param {{ module: SyncInitInput, memory?: WebAssembly.Memory }} module - Passing `SyncInitInput` directly is deprecated.
* @param {WebAssembly.Memory} memory - Deprecated.
*
* @returns {InitOutput}
*/
export function initSync(module: { module: SyncInitInput, memory?: WebAssembly.Memory } | SyncInitInput, memory?: WebAssembly.Memory): InitOutput;

/**
* If `module_or_path` is {RequestInfo} or {URL}, makes a request and
* for everything else, calls `WebAssembly.instantiate` directly.
*
* @param {{ module_or_path: InitInput | Promise<InitInput>, memory?: WebAssembly.Memory }} module_or_path - Passing `InitInput` directly is deprecated.
* @param {WebAssembly.Memory} memory - Deprecated.
*
* @returns {Promise<InitOutput>}
*/
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput>, memory?: WebAssembly.Memory } | InitInput | Promise<InitInput>, memory?: WebAssembly.Memory): Promise<InitOutput>;
