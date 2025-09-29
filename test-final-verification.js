// Final verification of chat history persistence
const { chromium } = require('playwright');

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function test() {
  console.log('🧪 FINAL CHAT HISTORY VERIFICATION TEST\n');
  console.log('=' .repeat(50));

  const browser = await chromium.launch({ headless: true });

  try {
    const roomId = `verify-${Date.now()}`;
    console.log(`📝 Room ID: ${roomId}\n`);

    // ============= TEST 1: Direct WASM Storage =============
    console.log('TEST 1: Direct WASM Storage Test');
    console.log('-'.repeat(40));

    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto('http://localhost:8080');
    await sleep(1500);

    // Test WASM storage directly
    const wasmTest = await page.evaluate((rid) => {
      const results = {};

      if (!window.safeWasm) {
        return { error: 'WASM not loaded' };
      }

      try {
        // Initialize and create room
        window.safeWasm.update_user_session('TestUser', 'test-user-123');
        window.safeWasm.create_room_with_id(rid);

        // Send test messages
        window.safeWasm.send_message_enhanced(rid, 'Message 1', 'msg-1');
        window.safeWasm.send_message_enhanced(rid, 'Message 2', 'msg-2');
        window.safeWasm.send_message_enhanced(rid, 'Message 3', 'msg-3');

        // Save to localStorage
        window.safeWasm.save_room_messages_to_storage(rid);

        // Check localStorage directly
        const storageKey = `chatHistory_${rid}`;
        const stored = localStorage.getItem(storageKey);
        results.localStorageExists = !!stored;

        if (stored) {
          const parsed = JSON.parse(stored);
          results.storedCount = parsed.messages ? parsed.messages.length : 0;
        }

        // Get messages from WASM
        const messages = window.safeWasm.get_room_messages(rid, 100);
        results.wasmMessageCount = Array.isArray(messages) ? messages.length : 0;

      } catch (e) {
        results.error = e.message;
      }

      return results;
    }, roomId);

    console.log('WASM Storage Test Results:');
    console.log('  localStorage exists:', wasmTest.localStorageExists);
    console.log('  Stored message count:', wasmTest.storedCount);
    console.log('  WASM message count:', wasmTest.wasmMessageCount);

    const test1Pass = wasmTest.storedCount >= 3 && wasmTest.wasmMessageCount >= 3;
    console.log(test1Pass ? '✅ PASS\n' : '❌ FAIL\n');

    // ============= TEST 2: Persistence Across Reload =============
    console.log('TEST 2: Persistence Across Page Reload');
    console.log('-'.repeat(40));

    await page.reload();
    await sleep(1500);

    const reloadTest = await page.evaluate((rid) => {
      const results = {};

      // Check localStorage
      const storageKey = `chatHistory_${rid}`;
      const stored = localStorage.getItem(storageKey);
      results.localStorageExists = !!stored;

      if (stored) {
        const parsed = JSON.parse(stored);
        results.storedCount = parsed.messages ? parsed.messages.length : 0;
      }

      // Load from storage and get messages
      if (window.safeWasm) {
        window.safeWasm.load_room_messages_from_storage(rid);
        const messages = window.safeWasm.get_room_messages(rid, 100);
        results.loadedCount = Array.isArray(messages) ? messages.length : 0;
      }

      return results;
    }, roomId);

    console.log('After Reload:');
    console.log('  localStorage exists:', reloadTest.localStorageExists);
    console.log('  Stored count:', reloadTest.storedCount);
    console.log('  Loaded count:', reloadTest.loadedCount);

    const test2Pass = reloadTest.loadedCount >= 3;
    console.log(test2Pass ? '✅ PASS\n' : '❌ FAIL\n');

    // ============= TEST 3: UI Integration =============
    console.log('TEST 3: UI Integration Test');
    console.log('-'.repeat(40));

    // Create a new room with messages via UI
    const uiRoomId = `ui-test-${Date.now()}`;

    await page.evaluate(() => {
      // Expand rooms section if needed
      const roomsHeader = document.getElementById('roomsHeader');
      if (roomsHeader) {
        roomsHeader.click();
      }
    });
    await sleep(500);

    // Fill in room ID and join
    await page.fill('#roomIdInput', uiRoomId);
    await page.click('#joinRoomBtn');
    await sleep(1500);

    // Send messages via UI
    await page.fill('#messageInput', 'UI Test Message 1');
    await page.click('button:has-text("SEND")');
    await sleep(500);

    await page.fill('#messageInput', 'UI Test Message 2');
    await page.click('button:has-text("SEND")');
    await sleep(500);

    const uiMessages = await page.locator('.neo-message-bubble').count();
    console.log(`  Messages shown in UI: ${uiMessages}`);

    // Check if saved to localStorage
    const uiStorage = await page.evaluate((rid) => {
      const key = `chatHistory_${rid}`;
      const stored = localStorage.getItem(key);
      if (stored) {
        const parsed = JSON.parse(stored);
        return parsed.messages ? parsed.messages.length : 0;
      }
      return 0;
    }, uiRoomId);

    console.log(`  Messages in localStorage: ${uiStorage}`);

    const test3Pass = uiMessages >= 2 && uiStorage >= 2;
    console.log(test3Pass ? '✅ PASS\n' : '❌ FAIL\n');

    // ============= FINAL RESULTS =============
    console.log('=' .repeat(50));
    console.log('FINAL RESULTS:');
    console.log('=' .repeat(50));

    const results = [
      { name: 'WASM Storage', pass: test1Pass },
      { name: 'Persistence', pass: test2Pass },
      { name: 'UI Integration', pass: test3Pass }
    ];

    let passCount = 0;
    results.forEach(r => {
      console.log(`${r.pass ? '✅' : '❌'} ${r.name}`);
      if (r.pass) passCount++;
    });

    console.log(`\n📊 Score: ${passCount}/3 tests passed`);

    if (passCount === 3) {
      console.log('🎉 SUCCESS! Chat history is working correctly!');
    } else if (passCount >= 2) {
      console.log('⚠️  PARTIAL: Most features working, some issues remain');
    } else {
      console.log('❌ NEEDS WORK: Chat history has issues');
    }

  } catch (error) {
    console.error('Test error:', error);
  } finally {
    await browser.close();
  }
}

test().catch(console.error);