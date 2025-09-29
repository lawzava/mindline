/**
 * WASM Module Manager
 * Handles WASM loading and safe proxy creation
 */

import logger from './logger.js';
import { IndexState } from './app-state.js';

/**
 * Load the WebAssembly module
 * @returns {Promise<boolean>} Whether the module loaded successfully
 */
export async function loadWasmModule() {
  try {
    // Dynamically import the module
    const wasm = await import('../pkg/mindline.js');
    await wasm.default(); // Initialize the WASM module
    IndexState.wasmModule = wasm; // Store the module itself, not the result

    logger.info('WASM module loaded successfully!');
    return true;
  } catch (err) {
    logger.error('Error loading WASM module:', err);
    throw err;
  }
}

/**
 * Create safe proxy functions to handle WebAssembly calls
 */
export function createSafeWasmProxies() {
  if (!IndexState.wasmModule) {
    logger.warn("WASM module not loaded, cannot create safe proxies");
    return;
  }

  window.safeWasm = {
    // Original functions
    initialize: safeWasmCall('initialize', ['userName', 'userId']),
    join_room: safeWasmCall('join_room', ['roomId', 'signalData']),
    create_room_with_id: safeWasmCall('create_room_with_id', ['roomId']),
    send_message: safeWasmCall('send_message', ['roomId', 'content', 'messageId']),
    get_messages: safeWasmCall('get_messages', ['roomId']),

    // Phase 1: Enhanced State Management Functions
    // Core state management
    get_current_user_id: safeWasmCall('get_current_user_id', []),
    get_current_room_id: safeWasmCall('get_current_room_id', []),
    set_current_room_id: safeWasmCall('set_current_room_id', ['roomId']),
    update_user_session: safeWasmCall('update_user_session', ['name', 'userId']),

    // Draft messages management
    get_draft_messages: safeWasmCall('get_draft_messages', []),
    set_draft_message: safeWasmCall('set_draft_message', ['peerId', 'content', 'senderName']),
    clear_draft_message: safeWasmCall('clear_draft_message', ['peerId']),

    // P2P state management
    get_connected_peers: safeWasmCall('get_connected_peers', []),
    add_connected_peer: safeWasmCall('add_connected_peer', ['peerId']),
    remove_connected_peer: safeWasmCall('remove_connected_peer', ['peerId']),
    clear_all_connected_peers: safeWasmCall('clear_all_connected_peers', []),

    // URL and utility functions
    generate_uuid: safeWasmCall('generate_uuid', []),
    get_room_from_url: safeWasmCall('get_room_from_url', []),
    update_url_with_room: safeWasmCall('update_url_with_room', ['roomId']),

    // Phase 2: Input Sanitization and Validation Functions
    validate_room_id: safeWasmCall('validate_room_id', ['roomId']),
    validate_username: safeWasmCall('validate_username', ['username']),
    validate_message: safeWasmCall('validate_message', ['message']),

    // Phase 3: Enhanced Message Processing Functions
    set_message_manager_user: safeWasmCall('set_message_manager_user', ['userId']),
    send_message_enhanced: safeWasmCall('send_message_enhanced', ['roomId', 'content', 'messageId']),
    receive_message_from_peer: safeWasmCall('receive_message_from_peer', ['messageData'], { messageData: (v) => v }),  // Pass object as-is
    get_room_messages: safeWasmCall('get_room_messages', ['roomId', 'limit']),
    get_room_message_stats: safeWasmCall('get_room_message_stats', ['roomId']),
    create_sync_request: safeWasmCall('create_sync_request', ['roomId', 'lastSync', 'messageCount']),
    handle_sync_request: safeWasmCall('handle_sync_request', ['requestData'], { requestData: (v) => v }),  // Pass object as-is
    save_room_messages_to_storage: safeWasmCall('save_room_messages_to_storage', ['roomId']),
    load_room_messages_from_storage: safeWasmCall('load_room_messages_from_storage', ['roomId']),

    // Phase 4: P2P Network Coordination Functions
    initialize_p2p_manager: safeWasmCall('initialize_p2p_manager', ['clientId', 'roomId']),
    add_known_peer: safeWasmCall('add_known_peer', ['peerId']),
    remove_peer_from_network: safeWasmCall('remove_peer_from_network', ['peerId']),
    update_peer_connection_state: safeWasmCall('update_peer_connection_state', ['peerId', 'state']),
    get_connection_decision: safeWasmCall('get_connection_decision', ['peerId']),
    record_peer_message_sent: safeWasmCall('record_peer_message_sent', ['peerId', 'sizeBytes'], { sizeBytes: Number }),
    record_peer_message_received: safeWasmCall('record_peer_message_received', ['peerId', 'sizeBytes'], { sizeBytes: Number }),
    update_peer_latency: safeWasmCall('update_peer_latency', ['peerId', 'latencyMs'], { latencyMs: Number }),
    needs_mesh_repair: safeWasmCall('needs_mesh_repair', []),
    get_mesh_repair_plan: safeWasmCall('get_mesh_repair_plan', []),
    get_p2p_network_stats: safeWasmCall('get_p2p_network_stats', []),
    handle_connection_failure: safeWasmCall('handle_connection_failure', ['peerId']),
    get_best_peers_for_broadcast: safeWasmCall('get_best_peers_for_broadcast', ['maxPeers'], { maxPeers: Number }),

    // Message queue functions
    queue_p2p_message: safeWasmCall('queue_p2p_message', ['targetPeer', 'content', 'messageType', 'priority'], {
      priority: Number,
      targetPeer: (v) => v === null || v === undefined ? undefined : v
    }),
    process_p2p_queue: safeWasmCall('process_p2p_queue', []),
    get_p2p_queue_status: safeWasmCall('get_p2p_queue_status', []),

    record_performance_metric: safeWasmCall('record_performance_metric', ['name', 'value', 'unit', 'category'], { value: Number }),
    start_performance_monitoring: safeWasmCall('start_performance_monitoring', []),
    // Aliases for functions called in webrtc.js
    add_peer: safeWasmCall('add_known_peer', ['peerId']),
    update_peer_metrics: function(peerId, latency, quality) {
      // Since we don't have a direct quality metric, just update latency
      return this.update_peer_latency(peerId, latency);
    },
    should_send_to_peer: safeWasmCall('should_send_to_peer', ['peerId', 'priority'], { priority: Number }),
    cleanup_stale_peers: safeWasmCall('cleanup_stale_peers', ['timeoutMinutes'], { timeoutMinutes: Number }),

    // Phase 5: Logging Functions
    initialize_logger: safeWasmCall('initialize_logger', ['developmentMode', 'debugEnabled'], { developmentMode: Boolean, debugEnabled: Boolean }),
    log_info: safeWasmCall('log_info', ['component', 'message']),
    log_warn: safeWasmCall('log_warn', ['component', 'message']),
    log_error: safeWasmCall('log_error', ['component', 'message']),
    log_debug: safeWasmCall('log_debug', ['component', 'message']),
    set_log_context: safeWasmCall('set_log_context', ['userId', 'roomId', 'component']),
    enable_debug_logging: safeWasmCall('enable_debug_logging', []),
    disable_debug_logging: safeWasmCall('disable_debug_logging', []),
    start_performance_timer: safeWasmCall('start_performance_timer', ['label']),
    end_performance_timer: safeWasmCall('end_performance_timer', ['label']),
    start_log_group: safeWasmCall('start_log_group', ['label']),
    end_log_group: safeWasmCall('end_log_group', []),
    log_table: safeWasmCall('log_table', ['data']),
    search_logs: safeWasmCall('search_logs', ['query', 'limit'], { limit: Number }),
    get_log_statistics: safeWasmCall('get_log_statistics', []),
    export_logs_json: safeWasmCall('export_logs_json', ['filter']),
    get_error_summary: safeWasmCall('get_error_summary', ['minutes'], { minutes: Number }),
    configure_logger: safeWasmCall('configure_logger', ['maxEntries', 'consoleOutput', 'bufferLogs', 'autoExportErrors'], {
      maxEntries: Number,
      consoleOutput: Boolean,
      bufferLogs: Boolean,
      autoExportErrors: Boolean
    }),

    // Phase 6: Advanced Features
    get_user_preferences: safeWasmCall('get_user_preferences', []),
    set_user_preference: safeWasmCall('set_user_preference', ['key', 'value']),
    export_user_data: safeWasmCall('export_user_data', ['format']),
    import_user_data: safeWasmCall('import_user_data', ['data', 'format']),
    clear_user_data: safeWasmCall('clear_user_data', []),
    get_room_analytics: safeWasmCall('get_room_analytics', ['roomId', 'timeRange']),
    create_room_backup: safeWasmCall('create_room_backup', ['roomId']),
    restore_room_backup: safeWasmCall('restore_room_backup', ['backupData']),
    get_system_diagnostics: safeWasmCall('get_system_diagnostics', []),
    run_system_self_test: safeWasmCall('run_system_self_test', []),
    get_feature_flags: safeWasmCall('get_feature_flags', []),
    enable_feature_flag: safeWasmCall('enable_feature_flag', ['flag']),
    disable_feature_flag: safeWasmCall('disable_feature_flag', ['flag']),
    schedule_task: safeWasmCall('schedule_task', ['taskType', 'delay', 'data']),
    cancel_scheduled_task: safeWasmCall('cancel_scheduled_task', ['taskId']),
    get_scheduled_tasks: safeWasmCall('get_scheduled_tasks', []),
    trigger_maintenance_mode: safeWasmCall('trigger_maintenance_mode', ['enabled'], { enabled: Boolean }),
    get_maintenance_status: safeWasmCall('get_maintenance_status', [])
  };
}

/**
 * Create a safe wrapper for WASM function calls with parameter validation
 * @param {string} funcName - Name of the WASM function
 * @param {Array<string>} paramNames - Expected parameter names
 * @param {Object} paramTransforms - Parameter transformation functions
 * @returns {Function} Safe wrapper function
 */
function safeWasmCall(funcName, paramNames = [], paramTransforms = {}) {
  return function(...args) {
    try {
      // Handle case where arguments might be undefined or not properly spread
      if (!arguments || arguments.length === 0) {
        args = [];
      } else if (args === undefined || args === null) {
        args = [];
      } else if (!Array.isArray(args)) {
        // Try to convert arguments to array
        args = Array.from(arguments);
      }

      // Validate we have the right number of parameters
      if (args.length !== paramNames.length) {
        const message = `${funcName}: expected ${paramNames.length} parameters (${paramNames.join(', ')}), got ${args.length}`;
        logger.error(message);
        throw new Error(message);
      }

      // Transform parameters if needed
      const transformedArgs = args.map((arg, index) => {
        const paramName = paramNames[index];
        const transform = paramTransforms[paramName];

        // Handle undefined arguments explicitly
        if (arg === undefined || arg === null) {
          // For Number transforms, undefined should become 0, not NaN
          if (transform === Number) {
            logger.warn(`${funcName}: parameter '${paramName}' is undefined, using 0`);
            return 0;
          }
          // For other transforms, pass through the undefined/null
          logger.warn(`${funcName}: parameter '${paramName}' is undefined/null`);
          return arg;
        }

        if (transform) {
          if (transform === Boolean) {
            return Boolean(arg);
          } else if (transform === Number) {
            const num = Number(arg);
            if (isNaN(num)) {
              logger.warn(`${funcName}: parameter '${paramName}' is NaN, using 0`);
              return 0; // Use 0 instead of throwing error
            }
            return num;
          } else if (typeof transform === 'function') {
            return transform(arg);
          }
        }

        // Basic type validation
        if (typeof arg !== 'string' && typeof arg !== 'number' && typeof arg !== 'boolean' && arg !== null && arg !== undefined) {
          logger.warn(`${funcName}: parameter '${paramName}' has unexpected type: ${typeof arg}`);
        }

        return arg;
      });

      // Check if WASM module and function exist
      if (!IndexState.wasmModule) {
        throw new Error(`WASM module not loaded for function: ${funcName}`);
      }

      const wasmFunc = IndexState.wasmModule[funcName];
      if (!wasmFunc || typeof wasmFunc !== 'function') {
        throw new Error(`WASM function '${funcName}' not found or not callable`);
      }

      // Call the function with transformed arguments
      const result = wasmFunc.apply(IndexState.wasmModule, transformedArgs);

      // Log successful calls in development mode
      if (process.env.NODE_ENV === 'development') {
        logger.debug(`WASM call successful: ${funcName}(${transformedArgs.map(arg =>
          typeof arg === 'string' ? `"${arg}"` : arg
        ).join(', ')})`);
      }

      return result;

    } catch (error) {
      // Enhanced error handling with context - ensure args is defined
      const safeArgs = Array.isArray(args) ? args : [];
      const contextInfo = {
        function: funcName,
        expectedParams: paramNames,
        receivedArgs: safeArgs.map(arg => arg === undefined ? 'undefined' : typeof arg),
        error: error.message
      };

      // Use console.error directly to prevent infinite recursion if logger WASM calls fail
      console.error(`[ERROR] WASM call failed:`, contextInfo);

      // Re-throw with enhanced error message
      const enhancedError = new Error(`WASM call failed: ${funcName} - ${error.message}`);
      enhancedError.context = contextInfo;
      throw enhancedError;
    }
  };
}