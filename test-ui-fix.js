// Test UI message display fix
const { chromium } = require('playwright');

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function test() {
  console.log('🧪 Testing UI Message Display\n');

  const browser = await chromium.launch({ headless: false }); // Run with UI visible for debugging

  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    // Enable console logging
    page.on('console', msg => {
      if (msg.text().includes('WASM') || msg.text().includes('message') || msg.text().includes('retrieveMessages')) {
        console.log('[Console]', msg.text());
      }
    });

    await page.goto('http://localhost:8080');
    await sleep(2000);

    const roomId = `ui-debug-${Date.now()}`;
    console.log(`Room ID: ${roomId}\n`);

    // TEST 1: Direct message sending
    console.log('=== TEST 1: Direct WASM Message Creation ===');
    const directTest = await page.evaluate((rid) => {
      if (!window.safeWasm) return { error: 'No WASM' };

      // Create room and messages
      window.safeWasm.update_user_session('TestUser', 'test-id');
      window.safeWasm.create_room_with_id(rid);

      // Send messages
      window.safeWasm.send_message_enhanced(rid, 'Direct Message 1', 'msg-1');
      window.safeWasm.send_message_enhanced(rid, 'Direct Message 2', 'msg-2');

      // Save to storage
      window.safeWasm.save_room_messages_to_storage(rid);

      // Get messages
      const messages = window.safeWasm.get_room_messages(rid, 100);

      return {
        messageCount: messages ? messages.length : 0,
        messages: messages
      };
    }, roomId);

    console.log(`Direct test: ${directTest.messageCount} messages created`);
    if (directTest.messages) {
      console.log('Message fields:', Object.keys(directTest.messages[0] || {}));
    }

    // TEST 2: Join room via UI
    console.log('\n=== TEST 2: Joining Room via UI ===');

    // Ensure rooms section is visible
    await page.evaluate(() => {
      const roomsSection = document.getElementById('roomsSection');
      if (roomsSection) {
        roomsSection.style.display = 'block';
      }
      const roomsHeader = document.getElementById('roomsHeader');
      if (roomsHeader) {
        const chevron = roomsHeader.querySelector('svg');
        if (chevron && chevron.style.transform.includes('180')) {
          roomsHeader.click();
        }
      }
    });
    await sleep(500);

    // Fill room ID
    await page.fill('#roomIdInput', roomId);
    await sleep(100);

    // Click join with force
    await page.evaluate(() => {
      const joinBtn = document.getElementById('joinRoomBtn');
      if (joinBtn) {
        console.log('Clicking JOIN button programmatically');
        joinBtn.click();
      }
    });
    await sleep(2000);

    // Check if messages are displayed
    const uiCheck = await page.evaluate(() => {
      const chatArea = document.getElementById('chatArea');
      const messages = document.querySelectorAll('.neo-message-bubble');
      const welcomeMsg = document.getElementById('welcomeMessage');

      return {
        chatAreaExists: !!chatArea,
        messageCount: messages.length,
        welcomeVisible: welcomeMsg ? welcomeMsg.style.display !== 'none' : false,
        chatAreaHTML: chatArea ? chatArea.innerHTML.substring(0, 200) : 'No chat area'
      };
    });

    console.log('\nUI Check Results:');
    console.log('  Chat area exists:', uiCheck.chatAreaExists);
    console.log('  Messages displayed:', uiCheck.messageCount);
    console.log('  Welcome visible:', uiCheck.welcomeVisible);
    console.log('  Chat area content:', uiCheck.chatAreaHTML);

    // TEST 3: Manual retrieval and display
    console.log('\n=== TEST 3: Manual Retrieval and Display ===');
    const manualTest = await page.evaluate((rid) => {
      const results = {};

      // Import and call retrieveMessages
      if (window.retrieveMessages || window.safeWasm) {
        // Load from storage
        if (window.safeWasm.load_room_messages_from_storage) {
          window.safeWasm.load_room_messages_from_storage(rid);
        }

        // Get messages
        const messages = window.safeWasm.get_room_messages(rid, 100);
        results.loadedCount = messages ? messages.length : 0;

        // Try to display them
        if (window.displayChatHistory && messages) {
          window.displayChatHistory(messages);
          results.displayCalled = true;
        }

        // Check UI again
        results.uiMessageCount = document.querySelectorAll('.neo-message-bubble').length;
      }

      return results;
    }, roomId);

    console.log('Manual test results:');
    console.log('  Loaded messages:', manualTest.loadedCount);
    console.log('  Display called:', manualTest.displayCalled);
    console.log('  UI messages after:', manualTest.uiMessageCount);

    // Final verdict
    if (manualTest.uiMessageCount >= 2) {
      console.log('\n✅ SUCCESS: Messages are displaying in UI!');
    } else {
      console.log('\n❌ FAIL: Messages still not showing in UI');

      // Debug: Check what's preventing display
      const debug = await page.evaluate(() => {
        return {
          getCurrentUserId: typeof window.getCurrentUserId === 'function' ? window.getCurrentUserId() : 'N/A',
          displayMessage: typeof window.displayMessage === 'function',
          displayChatHistory: typeof window.displayChatHistory === 'function'
        };
      });
      console.log('\nDebug info:', debug);
    }

    await sleep(5000);

  } catch (error) {
    console.error('Test error:', error);
  } finally {
    await browser.close();
  }
}

test().catch(console.error);