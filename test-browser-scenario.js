#!/usr/bin/env node

/**
 * Test to replicate the exact browser scenario causing memory access errors
 */

const fs = require('fs');
const path = require('path');

// Load WASM module
const wasmPath = path.join(__dirname, 'pkg', 'mindline_bg.wasm');
const wasmModule = require('./pkg/mindline.js');

// Read and initialize WASM
const wasmBytes = fs.readFileSync(wasmPath);

console.log('=== Browser Scenario Test ===\n');

async function simulateBrowserFlow() {
    try {
        // Initialize WASM like browser does
        await wasmModule.default(wasmBytes);
        const wasm = wasmModule;
        console.log('✅ WASM module loaded');

        // Simulate browser initialization sequence
        console.log('\n1. Simulating browser initialization...');

        // Initialize user (browser does this on load)
        const userId = 'b31c9209-027d-4c81-b00f-aaae6e2bf225';
        const userName = 'Anonymous';
        wasm.initialize(userName, userId);
        console.log('✅ User initialized:', userName, userId);

        // Set message manager user
        wasm.set_message_manager_user(userId);
        console.log('✅ Message manager user set');

        // Join room (browser restores from localStorage)
        const roomId = 'bcd9cd32-5a96-41f8-83e9-36afb8ab4b54';
        console.log('\n2. Joining room:', roomId);
        wasm.join_room(roomId, '');
        console.log('✅ Room joined');

        // Simulate browser trying to load from storage first
        console.log('\n3. Attempting to load from storage...');
        try {
            const loaded = wasm.load_room_messages_from_storage(roomId);
            console.log('   Storage load result:', loaded);
        } catch (e) {
            console.log('   Storage load failed:', e.message);
        }

        // This is where the browser crashes - calling get_room_messages
        console.log('\n4. Calling get_room_messages (THIS IS WHERE IT CRASHES)...');

        // Try with different limit values like browser does
        const limits = [100, 50, undefined, null, 0];

        for (const limit of limits) {
            console.log(`\n   Testing with limit: ${limit}`);
            try {
                const messages = wasm.get_room_messages(roomId, limit);
                console.log(`   ✅ Success! Retrieved ${messages ? messages.length : 0} messages`);
            } catch (e) {
                console.error(`   ❌ MEMORY ERROR with limit ${limit}:`, e.message);
                console.error(`      Stack:`, e.stack);

                // Try to understand what's happening
                console.log('\n   Debugging info:');

                // Check if room exists
                try {
                    const stats = wasm.get_room_message_stats(roomId);
                    console.log('   Room stats:', stats);
                } catch (statsErr) {
                    console.log('   Could not get room stats:', statsErr.message);
                }

                // Try to add a message first
                console.log('\n   Trying to add a message first...');
                try {
                    const msgResult = wasm.send_message_enhanced(roomId, 'Test message', 'test-msg-1');
                    console.log('   Message added:', msgResult ? 'success' : 'failed');

                    // Now try to get messages again
                    console.log('   Retrying get_room_messages after adding message...');
                    const messagesAfter = wasm.get_room_messages(roomId, limit);
                    console.log(`   ✅ Success after adding message! Retrieved ${messagesAfter ? messagesAfter.length : 0} messages`);
                } catch (addErr) {
                    console.error('   ❌ Still failing after adding message:', addErr.message);
                }

                break; // Stop testing other limits after first error
            }
        }

        // Test the exact sequence that happens in browser
        console.log('\n5. Testing exact browser sequence...');

        // Browser calls this on page restore
        console.log('   Step 1: Page loads, restores user from localStorage');
        // Already done above

        console.log('   Step 2: restoreRoomConnection is called');
        // Join room already done

        console.log('   Step 3: loadChatHistory is called');
        console.log('   - First tries load_room_messages_from_storage');
        try {
            wasm.load_room_messages_from_storage(roomId);
        } catch (e) {
            console.log('     Storage load error (expected):', e.message);
        }

        console.log('   - Then calls get_room_messages(roomId, 100)');
        try {
            const messages = wasm.get_room_messages(roomId, 100);
            console.log('     ✅ Success!', messages ? messages.length : 0, 'messages');
        } catch (e) {
            console.error('     ❌ CRASH HERE:', e.message);
        }

        console.log('   Step 4: retrieveMessages is called after timeout');
        console.log('   - Calls get_room_messages(roomId, 50)');
        try {
            const messages = wasm.get_room_messages(roomId, 50);
            console.log('     ✅ Success!', messages ? messages.length : 0, 'messages');
        } catch (e) {
            console.error('     ❌ CRASH HERE TOO:', e.message);
        }

    } catch (error) {
        console.error('\n❌ Test failed:', error);
        console.error('Stack:', error.stack);
        process.exit(1);
    }
}

// Run the test
simulateBrowserFlow().then(() => {
    console.log('\n✅ Test completed');
    process.exit(0);
}).catch(err => {
    console.error('\n❌ Test failed:', err);
    process.exit(1);
});