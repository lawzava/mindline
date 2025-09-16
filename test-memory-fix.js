#!/usr/bin/env node

/**
 * Test to verify memory access fix for get_room_messages
 */

const fs = require('fs');
const path = require('path');

// Load WASM module
const wasmPath = path.join(__dirname, 'pkg', 'mindline_bg.wasm');
const wasmModule = require('./pkg/mindline.js');

console.log('=== Memory Access Fix Test ===\n');

// Read and initialize WASM manually for Node.js
const wasmBytes = fs.readFileSync(wasmPath);

async function runTest() {
    try {
        // Initialize WASM
        await wasmModule.default(wasmBytes);
        const wasm = wasmModule;
        console.log('✅ WASM module loaded successfully');

        // Initialize user
        wasm.initialize('TestUser', 'test-user-123');
        console.log('✅ User initialized');

        // Set message manager user
        wasm.set_message_manager_user('test-user-123');
        console.log('✅ Message manager user set');

        // Test 1: Get messages from empty room
        console.log('\n1. Testing get_room_messages on empty room...');
        try {
            const emptyMessages = wasm.get_room_messages('empty-room', 50);
            console.log('   ✅ Empty room returned:', emptyMessages ? emptyMessages.length : 0, 'messages');
        } catch (e) {
            console.error('   ❌ Error on empty room:', e.message);
            throw e;
        }

        // Test 2: Add messages and retrieve
        console.log('\n2. Testing with messages...');
        const roomId = 'test-room-' + Date.now();

        // Add some messages
        for (let i = 0; i < 5; i++) {
            const messageId = 'msg-' + i;
            const content = 'Test message ' + i;
            try {
                const result = wasm.send_message_enhanced(roomId, content, messageId);
                console.log(`   ✅ Added message ${i}: ${messageId}`);
            } catch (e) {
                console.error(`   ❌ Failed to add message ${i}:`, e.message);
                throw e;
            }
        }

        // Retrieve messages
        console.log('\n3. Retrieving messages...');
        try {
            const messages = wasm.get_room_messages(roomId, 50);
            console.log('   ✅ Retrieved', messages ? messages.length : 0, 'messages');

            if (messages && messages.length > 0) {
                console.log('   First message:', messages[0].content);
                console.log('   Last message:', messages[messages.length - 1].content);
            }
        } catch (e) {
            console.error('   ❌ Error retrieving messages:', e.message);
            throw e;
        }

        // Test 4: Stress test with many messages
        console.log('\n4. Stress testing with many messages...');
        const stressRoomId = 'stress-room-' + Date.now();

        for (let i = 0; i < 100; i++) {
            const messageId = 'stress-msg-' + i;
            const content = 'Stress test message ' + i;
            wasm.send_message_enhanced(stressRoomId, content, messageId);
        }
        console.log('   ✅ Added 100 messages');

        try {
            const stressMessages = wasm.get_room_messages(stressRoomId, 50);
            console.log('   ✅ Retrieved', stressMessages ? stressMessages.length : 0, 'messages (limit 50)');

            // Try different limits
            const allMessages = wasm.get_room_messages(stressRoomId, 200);
            console.log('   ✅ Retrieved', allMessages ? allMessages.length : 0, 'messages (limit 200)');

            const fewMessages = wasm.get_room_messages(stressRoomId, 10);
            console.log('   ✅ Retrieved', fewMessages ? fewMessages.length : 0, 'messages (limit 10)');
        } catch (e) {
            console.error('   ❌ Error in stress test:', e.message);
            throw e;
        }

        // Test 5: Edge cases
        console.log('\n5. Testing edge cases...');

        // Test with undefined limit
        try {
            const noLimit = wasm.get_room_messages(stressRoomId);
            console.log('   ✅ No limit specified:', noLimit ? noLimit.length : 0, 'messages');
        } catch (e) {
            console.error('   ❌ Error with no limit:', e.message);
            throw e;
        }

        // Test with 0 limit
        try {
            const zeroLimit = wasm.get_room_messages(stressRoomId, 0);
            console.log('   ✅ Zero limit:', zeroLimit ? zeroLimit.length : 0, 'messages');
        } catch (e) {
            console.error('   ❌ Error with zero limit:', e.message);
            throw e;
        }

        // Test with very large limit
        try {
            const hugeLimit = wasm.get_room_messages(stressRoomId, 10000);
            console.log('   ✅ Huge limit (10000):', hugeLimit ? hugeLimit.length : 0, 'messages');
        } catch (e) {
            console.error('   ❌ Error with huge limit:', e.message);
            throw e;
        }

        console.log('\n✨ All tests passed! Memory access issues appear to be fixed.');

    } catch (error) {
        console.error('\n❌ Test failed:', error);
        console.error('Stack:', error.stack);
        process.exit(1);
    }
}

// Run the test
runTest().then(() => {
    console.log('\n✅ Test completed successfully');
    process.exit(0);
}).catch(err => {
    console.error('\n❌ Test failed with error:', err);
    process.exit(1);
});