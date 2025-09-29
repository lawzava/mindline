// Debug test for localStorage persistence
const { chromium } = require('playwright');

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function test() {
  console.log('🧪 Testing localStorage message persistence\n');

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Enable console logging
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log('❌ Console Error:', msg.text());
    } else if (msg.text().includes('WASM') || msg.text().includes('storage') || msg.text().includes('localStorage')) {
      console.log('📝 Console:', msg.text());
    }
  });

  try {
    const roomId = `storage-test-${Date.now()}`;
    console.log(`📝 Test room ID: ${roomId}\n`);

    console.log('=== Loading page ===');
    await page.goto('http://localhost:8080');
    await sleep(2000);

    console.log('=== Setting up user and room ===');
    await page.fill('#userName', 'TestUser');
    await page.fill('#roomIdInput', roomId);
    await page.click('#joinRoomBtn', { force: true });
    await sleep(3000);

    console.log('=== Sending test messages ===');
    await page.fill('#messageInput', 'Test message 1');
    await page.click('button:has-text("SEND")');
    await sleep(1000);

    await page.fill('#messageInput', 'Test message 2');
    await page.click('button:has-text("SEND")');
    await sleep(1000);

    // Check localStorage directly
    console.log('\n=== Checking localStorage ===');
    const localStorageData = await page.evaluate((roomId) => {
      const keys = Object.keys(localStorage);
      const storageData = {};

      // Get all localStorage keys and values
      keys.forEach(key => {
        if (key.includes('chatHistory') || key.includes(roomId)) {
          storageData[key] = localStorage.getItem(key);
        }
      });

      // Try to manually save using WASM
      if (window.safeWasm && window.safeWasm.save_room_messages_to_storage) {
        try {
          window.safeWasm.save_room_messages_to_storage(roomId);
          console.log('Manually triggered save_room_messages_to_storage');
        } catch (e) {
          console.error('Error saving:', e);
        }
      }

      // Check again after manual save
      const keysAfter = Object.keys(localStorage);
      keysAfter.forEach(key => {
        if (key.includes('chatHistory') || key.includes(roomId)) {
          storageData[`after_${key}`] = localStorage.getItem(key);
        }
      });

      return {
        storageData,
        allKeys: Object.keys(localStorage),
        wasmAvailable: !!window.safeWasm,
        saveFunction: !!window.safeWasm?.save_room_messages_to_storage,
        loadFunction: !!window.safeWasm?.load_room_messages_from_storage,
        getFunction: !!window.safeWasm?.get_room_messages
      };
    }, roomId);

    console.log('localStorage keys:', localStorageData.allKeys);
    console.log('Chat history data:', localStorageData.storageData);
    console.log('WASM functions available:', {
      wasmAvailable: localStorageData.wasmAvailable,
      saveFunction: localStorageData.saveFunction,
      loadFunction: localStorageData.loadFunction,
      getFunction: localStorageData.getFunction
    });

    // Now test loading messages
    console.log('\n=== Testing message retrieval ===');
    const messages = await page.evaluate((roomId) => {
      if (window.safeWasm && window.safeWasm.get_room_messages) {
        const msgs = window.safeWasm.get_room_messages(roomId, 100);
        return {
          messages: msgs,
          messageCount: Array.isArray(msgs) ? msgs.length : 0,
          type: typeof msgs
        };
      }
      return { messages: null, messageCount: 0, type: 'none' };
    }, roomId);

    console.log('Retrieved messages:', messages);

    // Test reload to check persistence
    console.log('\n=== Reloading page to test persistence ===');
    await page.reload();
    await sleep(2000);

    // Rejoin room
    await page.fill('#roomIdInput', roomId);
    await page.click('#joinRoomBtn', { force: true });
    await sleep(2000);

    // Check messages after reload
    const messagesAfterReload = await page.evaluate((roomId) => {
      // First try to load from storage
      if (window.safeWasm && window.safeWasm.load_room_messages_from_storage) {
        try {
          const loaded = window.safeWasm.load_room_messages_from_storage(roomId);
          console.log('Load from storage result:', loaded);
        } catch (e) {
          console.error('Error loading from storage:', e);
        }
      }

      // Then get messages
      if (window.safeWasm && window.safeWasm.get_room_messages) {
        const msgs = window.safeWasm.get_room_messages(roomId, 100);
        return {
          messages: msgs,
          messageCount: Array.isArray(msgs) ? msgs.length : 0,
          visibleMessages: document.querySelectorAll('.neo-message-bubble').length
        };
      }
      return { messages: null, messageCount: 0, visibleMessages: 0 };
    }, roomId);

    console.log('Messages after reload:', messagesAfterReload);

    if (messagesAfterReload.messageCount >= 2) {
      console.log('\n✅ SUCCESS: Messages persisted to localStorage!');
    } else {
      console.log(`\n❌ FAIL: Only ${messagesAfterReload.messageCount} messages found after reload`);
    }

    await sleep(5000);

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await browser.close();
  }
}

test().catch(console.error);