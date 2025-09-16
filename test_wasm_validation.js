// Test WASM validation functions locally
import init, * as wasm from './pkg/mindline.js';

async function testWasmValidation() {
  console.log('🧪 Testing WASM Validation Functions\n');

  // Initialize WASM module
  await init();
  console.log('✅ WASM module loaded\n');

  // Test cases
  const testCases = {
    room_ids: ['testroom', 'room-123', 'invalid<>', ''],
    usernames: ['TestUser', 'user_123', 'invalid<script>', ''],
    messages: ['Hello world', 'Test message', '<script>alert("xss")</script>', '']
  };

  console.log('🔍 Testing validate_room_id:');
  testCases.room_ids.forEach(roomId => {
    try {
      const result = wasm.validate_room_id(roomId);
      console.log(`  Input: "${roomId}" → Result: "${result}" (type: ${typeof result})`);
    } catch (error) {
      console.log(`  Input: "${roomId}" → ERROR: ${error.message}`);
    }
  });

  console.log('\n🔍 Testing validate_username:');
  testCases.usernames.forEach(username => {
    try {
      const result = wasm.validate_username(username);
      console.log(`  Input: "${username}" → Result: "${result}" (type: ${typeof result})`);
    } catch (error) {
      console.log(`  Input: "${username}" → ERROR: ${error.message}`);
    }
  });

  console.log('\n🔍 Testing validate_message:');
  testCases.messages.forEach(message => {
    try {
      const result = wasm.validate_message(message);
      console.log(`  Input: "${message}" → Result: "${result}" (type: ${typeof result})`);
    } catch (error) {
      console.log(`  Input: "${message}" → ERROR: ${error.message}`);
    }
  });

  console.log('\n🔍 Testing other string functions:');
  try {
    const roomFromUrl = wasm.get_room_from_url();
    console.log(`  get_room_from_url() → "${roomFromUrl}" (type: ${typeof roomFromUrl})`);
  } catch (error) {
    console.log(`  get_room_from_url() → ERROR: ${error.message}`);
  }

  try {
    const currentUserId = wasm.get_current_user_id();
    console.log(`  get_current_user_id() → "${currentUserId}" (type: ${typeof currentUserId})`);
  } catch (error) {
    console.log(`  get_current_user_id() → ERROR: ${error.message}`);
  }

  console.log('\n✅ WASM validation test complete');
}

testWasmValidation().catch(console.error);