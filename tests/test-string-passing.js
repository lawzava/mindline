#!/usr/bin/env node

/**
 * Test to debug string passing issue between JavaScript and WASM
 */

const fs = require('fs');
const path = require('path');

// Load WASM module
const wasmPath = path.join(__dirname, '..', 'pkg', 'mindline_bg.wasm');
const wasmModule = require('../pkg/mindline.js');

// Read and initialize WASM
const wasmBytes = fs.readFileSync(wasmPath);

console.log('=== Testing String Passing to WASM ===\n');

async function testStringPassing() {
    try {
        await wasmModule.default(wasmBytes);
        const wasm = wasmModule;

        // Initialize
        wasm.initialize('Anonymous', 'b31c9209-027d-4c81-b00f-aaae6e2bf225');
        wasm.set_message_manager_user('b31c9209-027d-4c81-b00f-aaae6e2bf225');

        const roomId = 'bcd9cd32-5a96-41f8-83e9-36afb8ab4b54';
        wasm.join_room(roomId, '');

        console.log('Testing direct WASM call vs module export:\n');

        // Test 1: Direct call with string and number
        console.log('1. Direct call with string roomId and number limit:');
        console.log('   roomId type:', typeof roomId, '- value:', roomId);
        console.log('   limit type:', typeof 100, '- value:', 100);
        try {
            const result = wasm.get_room_messages(roomId, 100);
            console.log('   ✅ Success');
        } catch (e) {
            console.error('   ❌ Failed:', e.message);
        }

        // Test 2: Check what the module actually exports
        console.log('\n2. Checking module exports:');
        console.log('   wasm.get_room_messages type:', typeof wasm.get_room_messages);
        console.log('   wasm.get_room_messages.length (param count):', wasm.get_room_messages.length);

        // Test 3: Try different ways to call it
        console.log('\n3. Testing different calling methods:');

        console.log('   a) Using .call():');
        try {
            const result = wasm.get_room_messages.call(null, roomId, 100);
            console.log('      ✅ Success');
        } catch (e) {
            console.error('      ❌ Failed:', e.message);
        }

        console.log('   b) Using .apply():');
        try {
            const result = wasm.get_room_messages.apply(null, [roomId, 100]);
            console.log('      ✅ Success');
        } catch (e) {
            console.error('      ❌ Failed:', e.message);
        }

        // Test 4: Check if strings are being corrupted
        console.log('\n4. Testing string corruption:');
        console.log('   Original roomId:', roomId);
        console.log('   Original roomId length:', roomId.length);
        console.log('   Original roomId charCodes:', Array.from(roomId).map(c => c.charCodeAt(0)));

        // Test 5: Try with a fresh string
        console.log('\n5. Testing with fresh string:');
        const freshRoomId = String('test-room-123');
        console.log('   Fresh roomId:', freshRoomId);
        wasm.join_room(freshRoomId, '');
        try {
            const result = wasm.get_room_messages(freshRoomId, 50);
            console.log('   ✅ Success with fresh string');
        } catch (e) {
            console.error('   ❌ Failed with fresh string:', e.message);
        }

        // Test 6: Check memory state
        console.log('\n6. Checking WASM memory:');
        if (wasm.memory) {
            console.log('   Memory buffer size:', wasm.memory.buffer.byteLength);
            console.log('   Memory pages:', wasm.memory.buffer.byteLength / (64 * 1024));
        }

        // Test 7: Try the imported module directly
        console.log('\n7. Testing with imported module pattern:');
        const { get_room_messages } = wasm;
        try {
            const result = get_room_messages(roomId, 100);
            console.log('   ✅ Success with destructured function');
        } catch (e) {
            console.error('   ❌ Failed with destructured function:', e.message);
        }

    } catch (error) {
        console.error('\n❌ Test failed:', error);
        console.error('Stack:', error.stack);
    }
}

testStringPassing().then(() => {
    console.log('\n✅ Test completed');
}).catch(err => {
    console.error('\n❌ Test failed:', err);
});