// Simple test for localStorage persistence
const { chromium } = require('playwright');

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function test() {
  console.log('🧪 Testing localStorage persistence\n');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    const roomId = `test-${Date.now()}`;

    // Navigate and setup
    await page.goto('http://localhost:8080');
    await sleep(1000);

    // Join room
    await page.evaluate((rid) => {
      // Initialize if needed
      if (window.safeWasm) {
        window.safeWasm.update_user_session('TestUser', 'test-user-id');
        window.safeWasm.create_room_with_id(rid);
      }
    }, roomId);

    await sleep(500);

    // Send messages using WASM directly
    console.log('Sending test messages...');
    const sendResult = await page.evaluate((rid) => {
      const results = [];

      if (window.safeWasm) {
        // Send messages
        try {
          window.safeWasm.send_message_enhanced(rid, 'Message 1', 'msg-1');
          results.push('Sent message 1');
        } catch (e) {
          results.push(`Error sending 1: ${e}`);
        }

        try {
          window.safeWasm.send_message_enhanced(rid, 'Message 2', 'msg-2');
          results.push('Sent message 2');
        } catch (e) {
          results.push(`Error sending 2: ${e}`);
        }

        // Save to storage
        try {
          window.safeWasm.save_room_messages_to_storage(rid);
          results.push('Saved to storage');
        } catch (e) {
          results.push(`Error saving: ${e}`);
        }

        // Check localStorage directly
        const storageKey = `chatHistory_${rid}`;
        const stored = localStorage.getItem(storageKey);
        results.push(`localStorage key exists: ${!!stored}`);
        if (stored) {
          try {
            const parsed = JSON.parse(stored);
            results.push(`Stored messages count: ${parsed.messages ? parsed.messages.length : 0}`);
          } catch (e) {
            results.push('Could not parse stored data');
          }
        }
      }

      return results;
    }, roomId);

    console.log('Send results:', sendResult.join('\n  '));

    // Reload page
    console.log('\nReloading page...');
    await page.reload();
    await sleep(1000);

    // Load messages
    const loadResult = await page.evaluate((rid) => {
      const results = [];

      if (window.safeWasm) {
        // Check localStorage first
        const storageKey = `chatHistory_${rid}`;
        const stored = localStorage.getItem(storageKey);
        results.push(`localStorage data exists: ${!!stored}`);

        // Load from storage
        try {
          const loaded = window.safeWasm.load_room_messages_from_storage(rid);
          results.push(`Load from storage result: ${loaded}`);
        } catch (e) {
          results.push(`Error loading: ${e}`);
        }

        // Get messages
        try {
          const messages = window.safeWasm.get_room_messages(rid, 100);
          results.push(`Got ${Array.isArray(messages) ? messages.length : 0} messages`);
          if (Array.isArray(messages) && messages.length > 0) {
            results.push(`First message: ${messages[0].content}`);
          }
        } catch (e) {
          results.push(`Error getting messages: ${e}`);
        }
      }

      return results;
    }, roomId);

    console.log('Load results:', loadResult.join('\n  '));

    // Final check
    const finalCheck = await page.evaluate((rid) => {
      // Check all localStorage keys
      const keys = Object.keys(localStorage).filter(k => k.includes('chat') || k.includes(rid));
      return {
        localStorageKeys: keys,
        keyCount: keys.length
      };
    }, roomId);

    console.log('\nFinal localStorage keys:', finalCheck.localStorageKeys);

    if (loadResult.some(r => r.includes('Got 2 messages'))) {
      console.log('\n✅ SUCCESS: Messages persisted correctly!');
    } else {
      console.log('\n❌ FAIL: Messages did not persist');
    }

  } catch (error) {
    console.error('Test error:', error);
  } finally {
    await browser.close();
  }
}

test().catch(console.error);