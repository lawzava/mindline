#!/usr/bin/env node

/**
 * Proper test for chat history sync with separate browser contexts
 */

const { chromium } = require('playwright');

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function test() {
  console.log('Starting chat history sync test with separate contexts...\n');

  const browser = await chromium.launch({
    headless: false,
    devtools: false
  });

  try {
    // Create two separate browser contexts (like incognito windows)
    // Each context has its own cookies and localStorage
    const aliceContext = await browser.newContext();
    const bobContext = await browser.newContext();

    const alicePage = await aliceContext.newPage();
    const bobPage = await bobContext.newPage();

    // Navigate both to the app
    const appUrl = 'http://localhost:8080/?signaling_server=localhost:3000';

    console.log('Loading app for Alice...');
    await alicePage.goto(appUrl);
    await delay(3000); // Wait for app to load

    // Click start chatting button for Alice if it exists
    try {
      await alicePage.click('text=Start Chatting', { timeout: 2000 });
    } catch (e) {
      // Button might not be present, continue
    }
    await delay(1000);

    // Set Alice's username
    console.log('Setting username for Alice...');
    await alicePage.fill('#userName', 'Alice');
    await delay(500);

    console.log('Loading app for Bob...');
    await bobPage.goto(appUrl);
    await delay(3000); // Wait for app to load

    // Click start chatting button for Bob if it exists
    try {
      await bobPage.click('text=Start Chatting', { timeout: 2000 });
    } catch (e) {
      // Button might not be present, continue
    }
    await delay(1000);

    // Set Bob's username
    console.log('Setting username for Bob...');
    await bobPage.fill('#userName', 'Bob');
    await delay(500);

    // Create room ID
    const roomId = 'test-sync-' + Date.now();

    // Alice joins room first
    console.log(`\nAlice joining room: ${roomId}`);

    // Click to expand rooms section
    await alicePage.click('#roomsHeader');
    await delay(500);

    await alicePage.fill('#roomIdInput', roomId);
    await alicePage.click('#joinRoomBtn');
    await delay(2000);

    // Alice sends messages
    console.log('Alice sending messages...');
    await alicePage.fill('#messageInput', 'Hello from Alice!');
    await alicePage.click('#sendBtn');
    await delay(500);

    await alicePage.fill('#messageInput', 'This is message 2');
    await alicePage.click('#sendBtn');
    await delay(500);

    await alicePage.fill('#messageInput', 'Testing sync');
    await alicePage.click('#sendBtn');
    await delay(1000);

    // Bob joins room - should receive sync
    console.log(`\nBob joining room: ${roomId}`);

    // Click to expand rooms section
    await bobPage.click('#roomsHeader');
    await delay(500);

    await bobPage.fill('#roomIdInput', roomId);
    await bobPage.click('#joinRoomBtn');
    await delay(3000); // Wait for connection and sync

    // Check messages on Bob's side
    console.log('\nChecking messages on Bob\'s side...');
    const bobMessages = await bobPage.evaluate(() => {
      const messages = [];
      document.querySelectorAll('.message').forEach(msg => {
        const sender = msg.querySelector('.message-sender')?.textContent;
        const content = msg.querySelector('.message-content')?.textContent;
        if (sender && content) {
          messages.push(`${sender.replace(':', '').trim()}: ${content}`);
        }
      });
      return messages;
    });

    console.log('Messages Bob sees:');
    bobMessages.forEach(msg => console.log('  - ' + msg));

    if (bobMessages.length === 3) {
      console.log('\n✅ SUCCESS: Bob received all 3 messages from Alice!');
    } else {
      console.log(`\n❌ FAILURE: Expected 3 messages, Bob received ${bobMessages.length}`);
    }

    // Bob sends a message
    console.log('\nBob sending a message...');
    await bobPage.fill('#messageInput', 'Hi Alice, I got your messages!');
    await bobPage.click('#sendBtn');
    await delay(2000);

    // Check if Alice sees Bob's message
    console.log('\nChecking if Alice sees Bob\'s message...');
    const aliceMessages = await alicePage.evaluate(() => {
      const messages = [];
      document.querySelectorAll('.message').forEach(msg => {
        const sender = msg.querySelector('.message-sender')?.textContent;
        const content = msg.querySelector('.message-content')?.textContent;
        if (sender && content) {
          messages.push(`${sender.replace(':', '').trim()}: ${content}`);
        }
      });
      return messages;
    });

    console.log('Messages Alice sees:');
    aliceMessages.forEach(msg => console.log('  - ' + msg));

    if (aliceMessages.length === 4 && aliceMessages[3].includes('Bob')) {
      console.log('\n✅ SUCCESS: Real-time messaging works both ways!');
    } else {
      console.log('\n❌ FAILURE: Alice didn\'t receive Bob\'s message');
    }

    // Test 3: Third user joins late
    console.log('\n=== TEST: Charlie joins after conversation ===');
    const charlieContext = await browser.newContext();
    const charliePage = await charlieContext.newPage();

    await charliePage.goto(appUrl);
    await charliePage.waitForSelector('#userName', { state: 'visible' });
    await delay(2000);

    await charliePage.fill('#userName', 'Charlie');
    await charliePage.click('#roomsHeader');
    await delay(500);

    await charliePage.fill('#roomIdInput', roomId);
    await charliePage.click('#joinRoomBtn');
    await delay(3000);

    const charlieMessages = await charliePage.evaluate(() => {
      const messages = [];
      document.querySelectorAll('.message').forEach(msg => {
        const sender = msg.querySelector('.message-sender')?.textContent;
        const content = msg.querySelector('.message-content')?.textContent;
        if (sender && content) {
          messages.push(`${sender.replace(':', '').trim()}: ${content}`);
        }
      });
      return messages;
    });

    console.log(`\nCharlie received ${charlieMessages.length} messages:`);
    charlieMessages.forEach(msg => console.log('  - ' + msg));

    if (charlieMessages.length === 4) {
      console.log('\n✅ SUCCESS: Charlie received all messages via sync!');
    } else {
      console.log(`\n❌ FAILURE: Expected 4 messages, Charlie received ${charlieMessages.length}`);
    }

    console.log('\n=================================');
    console.log('CHAT HISTORY SYNC TEST COMPLETE');
    console.log('=================================\n');

    console.log('Keeping browsers open for 20 seconds for inspection...');
    await delay(20000);

  } catch (error) {
    console.error('Test failed:', error);
  } finally {
    await browser.close();
  }
}

test().catch(console.error);