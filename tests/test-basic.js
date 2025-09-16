#!/usr/bin/env node

/**
 * Basic test to verify Phase 3 message processing works correctly
 */

const fs = require('fs');
const path = require('path');

async function runBasicTest() {
  console.log('=== Basic Phase 3 Functionality Test ===\n');

  // Load WASM module
  const wasmPath = path.join(__dirname, '..', 'pkg', 'mindline_bg.wasm');
  const wasmModule = await import('../pkg/mindline.js');
  const wasmBytes = fs.readFileSync(wasmPath);
  await wasmModule.default(wasmBytes);
  const wasm = wasmModule;

  // 1. Initialize
  console.log('1. Initializing user...');
  wasm.initialize('Alice', 'alice-123');
  wasm.set_message_manager_user('alice-123');
  console.log('   ✓ User initialized\n');

  // 2. Send messages
  console.log('2. Sending messages...');
  const room = 'test-room';

  const msg1 = wasm.send_message_enhanced(room, 'Hello world!', 'msg-1');
  console.log('   ✓ Sent:', msg1.content);

  const msg2 = wasm.send_message_enhanced(room, 'This is a test @bob', 'msg-2');
  console.log('   ✓ Sent:', msg2.content);

  const msg3 = wasm.send_message_enhanced(room, 'Testing reactions!', 'msg-3');
  console.log('   ✓ Sent:', msg3.content, '\n');

  // 3. Retrieve messages
  console.log('3. Retrieving messages...');
  const messages = wasm.get_room_messages(room, 10);
  console.log(`   ✓ Found ${messages.length} messages\n`);

  // 4. Edit a message
  console.log('4. Editing message...');
  wasm.edit_message(room, 'msg-1', 'Hello world! (edited)');
  const edited = wasm.get_room_messages(room, 10).find(m => m.id === 'msg-1');
  console.log('   ✓ Message edited:', edited.content);
  console.log('   ✓ Original content:', edited.original_content, '\n');

  // 5. Add reactions
  console.log('5. Adding reactions...');
  wasm.add_message_reaction(room, 'msg-3', '👍', 'alice-123');
  wasm.add_message_reaction(room, 'msg-3', '👍', 'bob-456');
  wasm.add_message_reaction(room, 'msg-3', '❤️', 'alice-123');

  const withReactions = wasm.get_room_messages(room, 10).find(m => m.id === 'msg-3');
  console.log('   ✓ Reactions added:');
  for (const [emoji, data] of withReactions.reactions) {
    console.log(`     ${emoji}: ${data.count} users`);
  }
  console.log();

  // 6. Typing indicators
  console.log('6. Testing typing indicators...');
  wasm.handle_typing_indicator(room, 'bob-456', true);
  wasm.handle_typing_indicator(room, 'charlie-789', true);

  let typing = wasm.get_typing_users(room);
  console.log('   ✓ Typing users:', typing.join(', '));

  wasm.handle_typing_indicator(room, 'bob-456', false);
  typing = wasm.get_typing_users(room);
  console.log('   ✓ After Bob stops typing:', typing.join(', '), '\n');

  // 7. Delete a message
  console.log('7. Deleting message...');
  wasm.delete_message(room, 'msg-2');
  const deleted = wasm.get_room_messages(room, 10).find(m => m.id === 'msg-2');
  console.log('   ✓ Message deleted, content:', deleted.content, '\n');

  // 8. Message stats
  console.log('8. Room statistics...');
  const stats = wasm.get_room_message_stats(room);
  console.log('   ✓ Total messages:', stats.totalMessages);
  console.log('   ✓ Unread count:', stats.unreadCount);
  console.log('   ✓ Last sync:', new Date(stats.lastSync).toISOString(), '\n');

  // 9. Simulate peer message
  console.log('9. Receiving peer message...');
  const peerMsg = {
    id: 'peer-msg-1',
    sender_id: 'bob-456',
    sender_name: 'Bob',
    message_type: 'Text',
    content: 'Hello from Bob!',
    timestamp: Date.now(),
    room_id: room,
    status: 'Sent',
    edited: false,
    edit_timestamp: null,
    original_content: null,
    reply_to: null,
    reactions: new Map(),
    mentions: [],
    local_timestamp: Date.now(),
    delivery_attempts: 0,
    size_bytes: 50
  };

  const received = wasm.receive_message_from_peer(peerMsg);
  console.log('   ✓ Peer message received:', received);

  const allMessages = wasm.get_room_messages(room, 10);
  console.log(`   ✓ Total messages in room: ${allMessages.length}\n`);

  // 10. Create sync request
  console.log('10. Message synchronization...');
  const syncRequest = wasm.create_sync_request(room, Date.now() - 60000, 10);
  console.log('   ✓ Sync request created for room:', syncRequest.room_id);

  const syncMessages = wasm.get_messages_for_sync(room, Date.now() - 60000, 10);
  console.log(`   ✓ Messages to sync: ${syncMessages.length}\n`);

  console.log('=== All basic tests completed successfully! ===');
}

runBasicTest().catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});