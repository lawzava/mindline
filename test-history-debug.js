// Debug test for chat history persistence
const { chromium } = require('playwright');

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function test() {
  console.log('🧪 Testing chat history persistence with debug logs\n');

  const browser = await chromium.launch({ headless: false });
  const contextA = await browser.newContext();
  const pageA = await contextA.newPage();

  // Capture console logs
  pageA.on('console', msg => {
    const text = msg.text();
    if (text.includes('loadChatHistory') || text.includes('retrieveMessages') || text.includes('displayChatHistory')) {
      console.log('[DEBUG]', text);
    }
  });

  try {
    const roomId = `debug-${Date.now()}`;
    console.log(`📝 Room ID: ${roomId}\n`);

    console.log('=== User A creates room and sends messages ===');
    await pageA.goto('http://localhost:8080');
    await sleep(2000);

    await pageA.fill('#userName', 'Alice');
    await pageA.fill('#roomIdInput', roomId);
    await pageA.click('#joinRoomBtn', { force: true });
    await sleep(2000);

    // Send messages
    await pageA.fill('#messageInput', 'Message 1 from Alice');
    await pageA.click('button:has-text("SEND")');
    await sleep(1000);

    await pageA.fill('#messageInput', 'Message 2 from Alice');
    await pageA.click('button:has-text("SEND")');
    await sleep(1000);

    const messageCount1 = await pageA.locator('.neo-message-bubble').count();
    console.log(`✅ Alice sent ${messageCount1} messages\n`);

    console.log('=== Alice leaves and rejoins ===');
    await pageA.close();
    await sleep(1000);

    const pageA2 = await contextA.newPage();
    pageA2.on('console', msg => {
      const text = msg.text();
      if (text.includes('loadChatHistory') || text.includes('retrieveMessages') || text.includes('displayChatHistory')) {
        console.log('[DEBUG REJOIN]', text);
      }
    });

    await pageA2.goto('http://localhost:8080');
    await sleep(2000);

    await pageA2.fill('#roomIdInput', roomId);
    await pageA2.click('#joinRoomBtn', { force: true });
    await sleep(3000);

    const messageCount2 = await pageA2.locator('.neo-message-bubble').count();
    console.log(`📊 Alice sees ${messageCount2} messages after rejoin\n`);

    // Check localStorage directly
    const storageCheck = await pageA2.evaluate((rid) => {
      const key = `chatHistory_${rid}`;
      const data = localStorage.getItem(key);
      if (data) {
        try {
          const parsed = JSON.parse(data);
          return {
            exists: true,
            messageCount: parsed.messages ? parsed.messages.length : 0,
            messages: parsed.messages ? parsed.messages.map(m => m.content) : []
          };
        } catch (e) {
          return { exists: true, error: e.message };
        }
      }
      return { exists: false };
    }, roomId);

    console.log('localStorage check:', storageCheck);

    // Try manual load and display
    const manualTest = await pageA2.evaluate((rid) => {
      const results = [];

      // Load from storage
      if (window.safeWasm && window.safeWasm.load_room_messages_from_storage) {
        const loaded = window.safeWasm.load_room_messages_from_storage(rid);
        results.push(`Load result: ${loaded}`);
      }

      // Get messages
      if (window.safeWasm && window.safeWasm.get_room_messages) {
        const msgs = window.safeWasm.get_room_messages(rid, 100);
        results.push(`Got ${Array.isArray(msgs) ? msgs.length : 0} messages`);

        // Try to display them manually
        if (Array.isArray(msgs) && msgs.length > 0) {
          if (window.displayChatHistory) {
            window.displayChatHistory(msgs);
            results.push('Called displayChatHistory');
          }
        }
      }

      // Check UI
      const displayed = document.querySelectorAll('.neo-message-bubble').length;
      results.push(`UI shows ${displayed} messages`);

      return results;
    }, roomId);

    console.log('Manual test results:', manualTest.join(' | '));

    if (messageCount2 >= 2) {
      console.log('\n✅ SUCCESS: Chat history persisted!');
    } else {
      console.log('\n❌ FAIL: Chat history not displayed correctly');
    }

    await sleep(5000);

  } catch (error) {
    console.error('Test error:', error);
  } finally {
    await browser.close();
  }
}

test().catch(console.error);