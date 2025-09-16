#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

async function debug() {
  // Load WASM module
  const wasmPath = path.join(__dirname, '..', 'pkg', 'mindline_bg.wasm');
  const wasmModule = await import('../pkg/mindline.js');
  const wasmBytes = fs.readFileSync(wasmPath);
  await wasmModule.default(wasmBytes);
  const wasm = wasmModule;

  // Initialize
  wasm.initialize('TestUser', 'test-user-id');
  wasm.set_message_manager_user('test-user-id');

  // Test reactions
  console.log('\n=== Testing Reactions ===');
  const roomId = 'test-room';
  const messageId = 'msg-test';

  wasm.send_message_enhanced(roomId, 'Test message', messageId);
  wasm.add_message_reaction(roomId, messageId, '👍', 'user-1');
  wasm.add_message_reaction(roomId, messageId, '👍', 'user-2');

  const messages = wasm.get_room_messages(roomId, 10);
  const message = messages.find(m => m.id === messageId);

  console.log('Message reactions:', message.reactions);
  console.log('Reactions keys:', Object.keys(message.reactions || {}));

  // Test mentions
  console.log('\n=== Testing Mentions ===');
  const mentionContent = 'Hello @alice and @bob, please review. cc @charlie';
  const mentionMsgId = 'mention-msg';

  const mentionMsg = wasm.send_message_enhanced(roomId, mentionContent, mentionMsgId);

  console.log('Mentions array:', mentionMsg.mentions);
  console.log('Mentions length:', mentionMsg.mentions ? mentionMsg.mentions.length : 0);
  console.log('Mentions content:', mentionMsg.mentions);
}

debug().catch(console.error);