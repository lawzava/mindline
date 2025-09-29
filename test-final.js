// Final test for chat history
const { chromium } = require('playwright');

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function test() {
  console.log('🧪 Testing chat history fix\n');

  const browser = await chromium.launch({ headless: true });

  try {
    const roomId = `final-${Date.now()}`;

    // PHASE 1: Create room and send messages
    console.log('Phase 1: Creating room and sending messages...');
    const context1 = await browser.newContext();
    const page1 = await context1.newPage();

    await page1.goto('http://localhost:8080');
    await sleep(1500);

    await page1.evaluate((rid) => {
      // Initialize user
      if (window.safeWasm) {
        window.safeWasm.update_user_session('Alice', 'alice-id');
        window.safeWasm.create_room_with_id(rid);

        // Send messages
        window.safeWasm.send_message_enhanced(rid, 'First message', 'msg-1');
        window.safeWasm.send_message_enhanced(rid, 'Second message', 'msg-2');

        // Save to storage
        window.safeWasm.save_room_messages_to_storage(rid);
      }
    }, roomId);

    const check1 = await page1.evaluate((rid) => {
      const key = `chatHistory_${rid}`;
      const data = localStorage.getItem(key);
      if (data) {
        const parsed = JSON.parse(data);
        return parsed.messages ? parsed.messages.length : 0;
      }
      return 0;
    }, roomId);

    console.log(`  ✓ Saved ${check1} messages to localStorage`);

    // PHASE 2: New context (simulates rejoin)
    console.log('\nPhase 2: Simulating rejoin...');
    await context1.close();

    const context2 = await browser.newContext();
    const page2 = await context2.newPage();

    await page2.goto('http://localhost:8080');
    await sleep(1500);

    // Try the retrieveMessages path (what the UI uses)
    const retrieveTest = await page2.evaluate((rid) => {
      const results = {};

      // Check localStorage exists
      const key = `chatHistory_${rid}`;
      const stored = localStorage.getItem(key);
      results.localStorageExists = !!stored;
      if (stored) {
        const parsed = JSON.parse(stored);
        results.storedMessageCount = parsed.messages ? parsed.messages.length : 0;
      }

      // Initialize user for this session
      if (window.safeWasm) {
        window.safeWasm.update_user_session('Alice', 'alice-id');
      }

      // Import the retrieveMessages function
      return new Promise((resolve) => {
        import('./message-manager.js').then(module => {
          const messages = module.retrieveMessages(rid);
          results.retrievedMessageCount = messages ? messages.length : 0;
          results.retrievedMessages = messages;
          resolve(results);
        }).catch(err => {
          results.error = err.message;
          resolve(results);
        });
      });
    }, roomId);

    console.log('  localStorage exists:', retrieveTest.localStorageExists);
    console.log('  Stored message count:', retrieveTest.storedMessageCount);
    console.log('  Retrieved message count:', retrieveTest.retrievedMessageCount);

    // PHASE 3: Test via UI
    console.log('\nPhase 3: Testing via UI...');
    await page2.fill('#roomIdInput', roomId);
    await page2.click('#joinRoomBtn');
    await sleep(2000);

    const uiMessageCount = await page2.locator('.neo-message-bubble').count();
    console.log(`  UI shows ${uiMessageCount} messages`);

    // Final verdict
    console.log('\n=== RESULTS ===');
    if (retrieveTest.storedMessageCount >= 2 && uiMessageCount >= 2) {
      console.log('✅ SUCCESS: Chat history is persisting and displaying correctly!');
    } else if (retrieveTest.storedMessageCount >= 2) {
      console.log('⚠️  PARTIAL: Messages are persisted but not displayed in UI');
    } else {
      console.log('❌ FAIL: Messages are not persisting correctly');
    }

  } catch (error) {
    console.error('Test error:', error);
  } finally {
    await browser.close();
  }
}

test().catch(console.error);