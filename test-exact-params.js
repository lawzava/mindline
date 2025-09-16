#!/usr/bin/env node

/**
 * Test with exact parameter types to debug the issue
 */

const fs = require('fs');
const path = require('path');

// Load WASM module
const wasmPath = path.join(__dirname, 'pkg', 'mindline_bg.wasm');
const wasmModule = require('./pkg/mindline.js');

// Read and initialize WASM
const wasmBytes = fs.readFileSync(wasmPath);

console.log('=== Testing Exact Parameter Types ===\n');

async function testParameterTypes() {
    try {
        await wasmModule.default(wasmBytes);
        const wasm = wasmModule;

        // Initialize exactly like browser
        wasm.initialize('Anonymous', 'b31c9209-027d-4c81-b00f-aaae6e2bf225');
        wasm.set_message_manager_user('b31c9209-027d-4c81-b00f-aaae6e2bf225');

        const roomId = 'bcd9cd32-5a96-41f8-83e9-36afb8ab4b54';
        wasm.join_room(roomId, '');

        console.log('Testing different parameter types for get_room_messages:\n');

        // Test 1: Number limit (what we expect to work)
        console.log('1. Testing with number limit (100):');
        try {
            const result = wasm.get_room_messages(roomId, 100);
            console.log('   ✅ Success with number 100');
        } catch (e) {
            console.error('   ❌ Failed with number 100:', e.message);
        }

        // Test 2: String limit (what browser was sending)
        console.log('\n2. Testing with string limit ("100"):');
        try {
            const result = wasm.get_room_messages(roomId, "100");
            console.log('   ✅ Success with string "100"');
        } catch (e) {
            console.error('   ❌ Failed with string "100":', e.message);
        }

        // Test 3: undefined
        console.log('\n3. Testing with undefined:');
        try {
            const result = wasm.get_room_messages(roomId, undefined);
            console.log('   ✅ Success with undefined');
        } catch (e) {
            console.error('   ❌ Failed with undefined:', e.message);
        }

        // Test 4: null
        console.log('\n4. Testing with null:');
        try {
            const result = wasm.get_room_messages(roomId, null);
            console.log('   ✅ Success with null');
        } catch (e) {
            console.error('   ❌ Failed with null:', e.message);
        }

        // Test 5: No second parameter
        console.log('\n5. Testing with no limit parameter:');
        try {
            const result = wasm.get_room_messages(roomId);
            console.log('   ✅ Success with no limit parameter');
        } catch (e) {
            console.error('   ❌ Failed with no limit parameter:', e.message);
        }

        // Test 6: Empty string
        console.log('\n6. Testing with empty string ("");');
        try {
            const result = wasm.get_room_messages(roomId, "");
            console.log('   ✅ Success with empty string');
        } catch (e) {
            console.error('   ❌ Failed with empty string:', e.message);
        }

        // Test 7: Zero
        console.log('\n7. Testing with zero (0):');
        try {
            const result = wasm.get_room_messages(roomId, 0);
            console.log('   ✅ Success with zero');
        } catch (e) {
            console.error('   ❌ Failed with zero:', e.message);
        }

        // Now test after adding messages
        console.log('\n8. Adding messages and testing retrieval:');

        // Add some messages
        for (let i = 0; i < 5; i++) {
            wasm.send_message_enhanced(roomId, `Message ${i}`, `msg-${i}`);
        }
        console.log('   Added 5 messages');

        // Try retrieving with number
        try {
            const result = wasm.get_room_messages(roomId, 10);
            console.log(`   ✅ Retrieved ${result ? result.length : 0} messages with limit 10`);
        } catch (e) {
            console.error('   ❌ Failed after adding messages:', e.message);
        }

        // Check what type the browser is actually using
        console.log('\n9. Type checking:');
        console.log('   typeof 100:', typeof 100);
        console.log('   typeof "100":', typeof "100");
        console.log('   typeof undefined:', typeof undefined);
        console.log('   typeof null:', typeof null);

    } catch (error) {
        console.error('\n❌ Test failed:', error);
        console.error('Stack:', error.stack);
    }
}

testParameterTypes().then(() => {
    console.log('\n✅ Test completed');
}).catch(err => {
    console.error('\n❌ Test failed:', err);
});