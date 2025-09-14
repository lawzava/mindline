/* tslint:disable */
/* eslint-disable */
export function initialize(user_name: string, user_id: string): void;
export function send_message(room_id: any, content: any, message_id: any): void;
export function send_typing_indicator(room_id: any, is_typing: any): void;
export function get_messages(room_id: any): any;
export function join_room(room_id: any, signal_data: string): string;
export function create_room_with_id(room_id: any): void;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly initialize: (a: number, b: number, c: number, d: number) => [number, number];
  readonly send_message: (a: any, b: any, c: any) => [number, number];
  readonly send_typing_indicator: (a: any, b: any) => [number, number];
  readonly get_messages: (a: any) => any;
  readonly join_room: (a: any, b: number, c: number) => [number, number, number, number];
  readonly create_room_with_id: (a: any) => [number, number];
  readonly __wbindgen_exn_store: (a: number) => void;
  readonly __externref_table_alloc: () => number;
  readonly __wbindgen_export_2: WebAssembly.Table;
  readonly __wbindgen_free: (a: number, b: number, c: number) => void;
  readonly memory: WebAssembly.Memory;
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
