// Test UI message sending and storage
const { chromium } = require('playwright');

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function test() {
  console.log('🧪 Testing UI Message Send & Storage\n');

  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    // Enable console for debugging
    page.on('console', msg => {
      const text = msg.text();
      if (text.includes('ERROR') || text.includes('FAIL')) {
        console.log('[Console]', text);
      }
    });

    await page.goto('http://localhost:8080');
    await sleep(2000);

    const roomId = `ui-send-test-${Date.now()}`;
    console.log(`Room ID: ${roomId}\n`);

    // Skip username - will use Anonymous

    // Expand rooms section first
    await page.evaluate(() => {
      const roomsHeader = document.getElementById('roomsHeader');
      if (roomsHeader) {
        roomsHeader.click();
      }
    });
    await sleep(500);

    // Create and join room
    await page.fill('#roomIdInput', roomId);
    await page.click('#joinRoomBtn');
    await sleep(2000);

    // Check if room was actually joined
    const currentRoom = await page.evaluate(() => {
      if (window.safeWasm && window.safeWasm.get_current_room_id) {
        return window.safeWasm.get_current_room_id();
      }
      return null;
    });
    console.log(`Current room after join: ${currentRoom}`);

    console.log('=== Sending Messages via UI ===');

    // Send first message
    await page.fill('#messageInput', 'Test Message 1');
    await page.evaluate(() => {
      if (window.sendMessage) {
        window.sendMessage();
      } else {
        console.error('sendMessage not available');
      }
    });
    await sleep(1000);

    // Send second message
    await page.fill('#messageInput', 'Test Message 2');
    await page.evaluate(() => {
      if (window.sendMessage) {
        window.sendMessage();
      } else {
        console.error('sendMessage not available');
      }
    });
    await sleep(1000);

    // Check UI display
    const uiCount = await page.locator('.neo-message-bubble').count();
    console.log(`Messages in UI: ${uiCount}`);

    // Check localStorage
    const storageCheck = await page.evaluate((rid) => {
      const key = `chatHistory_${rid}`;
      const stored = localStorage.getItem(key);

      if (!stored) {
        return { exists: false, count: 0 };
      }

      try {
        const parsed = JSON.parse(stored);
        return {
          exists: true,
          count: parsed.messages ? parsed.messages.length : 0,
          sample: parsed.messages ? parsed.messages[0] : null
        };
      } catch (e) {
        return { exists: true, count: 0, error: e.message };
      }
    }, roomId);

    console.log('localStorage check:', storageCheck);

    // Also check WASM directly
    const wasmCheck = await page.evaluate((rid) => {
      if (!window.safeWasm) return { error: 'No WASM' };

      const messages = window.safeWasm.get_room_messages(rid, 100);
      return {
        count: messages ? messages.length : 0,
        hasMessages: !!messages
      };
    }, roomId);

    console.log('WASM check:', wasmCheck);

    // Results
    console.log('\n=== RESULTS ===');
    if (uiCount >= 2 && storageCheck.count >= 2) {
      console.log('✅ SUCCESS: Messages sent, displayed, and stored!');
    } else {
      console.log('❌ FAIL: Issues detected');
      console.log('  - UI messages:', uiCount);
      console.log('  - Storage messages:', storageCheck.count);
      console.log('  - WASM messages:', wasmCheck.count);
    }

  } catch (error) {
    console.error('Test error:', error);
  } finally {
    await browser.close();
  }
}

test().catch(console.error);