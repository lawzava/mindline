/* tslint:disable */
/* eslint-disable */
export function initialize(user_name: string, user_id: string): void;
export function send_message(room_id: any, content: any, message_id: any): void;
export function send_typing_indicator(room_id: any, is_typing: any): void;
export function get_messages(room_id: any): any;
export function join_room(room_id: any, signal_data: string): string;
export function create_room_with_id(room_id: any): void;
export function get_app_state(): any;
export function get_app_config(): any;
export function get_current_user_id(): string;
export function get_current_room_id(): string;
export function set_current_room_id(room_id: string): void;
export function update_user_session(name: string, user_id: string): void;
export function set_typing_status(is_typing: boolean): void;
export function get_room_history_list(): any;
export function add_room_to_history(room_id: string, display_name?: string | null): void;
export function remove_room_from_history(room_id: string): void;
export function get_room_metadata(room_id: string): any;
export function get_draft_messages(): any;
export function set_draft_message(peer_id: string, content: string, sender_name: string): void;
export function clear_draft_message(peer_id: string): void;
export function clear_all_draft_messages(): void;
export function get_connected_peers(): any;
export function add_connected_peer(peer_id: string): void;
export function remove_connected_peer(peer_id: string): void;
export function clear_all_connected_peers(): void;
export function generate_uuid(): any;
export function get_room_from_url(): string;
export function update_url_with_room(room_id: string): void;
export function validate_room_id(room_id: any): string;
export function validate_username(username: any): string;
export function validate_message(message: any): string;
export function sanitize_html_content(html: string): string;
export function validate_url_param(param: string): any;
export function generate_secure_room_id(): string;
export function check_rate_limit(key: string, max_attempts: number, window_ms: number): boolean;
export function validate_file(file_name: string, file_size: number, mime_type: string): boolean;
export function detect_attack_patterns(input: string): any;
export function validate_json_input(json_str: string, max_size: number): any;
export function validate_input_batch(input_type: string, values: any): any;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly initialize: (a: number, b: number, c: number, d: number) => [number, number];
  readonly send_message: (a: any, b: any, c: any) => [number, number];
  readonly send_typing_indicator: (a: any, b: any) => [number, number];
  readonly get_messages: (a: any) => any;
  readonly join_room: (a: any, b: number, c: number) => [number, number, number, number];
  readonly create_room_with_id: (a: any) => [number, number];
  readonly get_app_state: () => any;
  readonly get_app_config: () => any;
  readonly get_current_user_id: () => [number, number];
  readonly get_current_room_id: () => [number, number];
  readonly set_current_room_id: (a: number, b: number) => [number, number];
  readonly update_user_session: (a: number, b: number, c: number, d: number) => [number, number];
  readonly set_typing_status: (a: number) => [number, number];
  readonly get_room_history_list: () => any;
  readonly add_room_to_history: (a: number, b: number, c: number, d: number) => [number, number];
  readonly remove_room_from_history: (a: number, b: number) => [number, number];
  readonly get_room_metadata: (a: number, b: number) => any;
  readonly get_draft_messages: () => any;
  readonly set_draft_message: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
  readonly clear_draft_message: (a: number, b: number) => [number, number];
  readonly clear_all_draft_messages: () => [number, number];
  readonly get_connected_peers: () => any;
  readonly add_connected_peer: (a: number, b: number) => [number, number];
  readonly remove_connected_peer: (a: number, b: number) => [number, number];
  readonly clear_all_connected_peers: () => [number, number];
  readonly generate_uuid: () => any;
  readonly get_room_from_url: () => [number, number];
  readonly update_url_with_room: (a: number, b: number) => [number, number];
  readonly validate_room_id: (a: any) => [number, number, number, number];
  readonly validate_username: (a: any) => [number, number, number, number];
  readonly validate_message: (a: any) => [number, number, number, number];
  readonly sanitize_html_content: (a: number, b: number) => [number, number];
  readonly validate_url_param: (a: number, b: number) => any;
  readonly generate_secure_room_id: () => [number, number, number, number];
  readonly check_rate_limit: (a: number, b: number, c: number, d: number) => number;
  readonly validate_file: (a: number, b: number, c: number, d: number, e: number) => number;
  readonly detect_attack_patterns: (a: number, b: number) => any;
  readonly validate_json_input: (a: number, b: number, c: number) => any;
  readonly validate_input_batch: (a: number, b: number, c: any) => any;
  readonly __wbindgen_exn_store: (a: number) => void;
  readonly __externref_table_alloc: () => number;
  readonly __wbindgen_export_2: WebAssembly.Table;
  readonly memory: WebAssembly.Memory;
  readonly __wbindgen_free: (a: number, b: number, c: number) => void;
  readonly __wbindgen_malloc: (a: number, b: number) => number;
  readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
  readonly __externref_table_dealloc: (a: number) => void;
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
