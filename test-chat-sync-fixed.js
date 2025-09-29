#!/usr/bin/env node

/**
 * Test script for verifying chat history sync between multiple users
 * Tests the fixed sync-response message handling
 */

const puppeteer = require('puppeteer');

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function test() {
  console.log('Starting chat history sync test with fixed message handler...');

  const browser = await puppeteer.launch({
    headless: false,
    devtools: true,
    args: ['--window-size=1400,900']
  });

  try {
    // Create three browser contexts (users)
    const user1Page = await browser.newPage();
    const user2Page = await browser.newPage();
    const user3Page = await browser.newPage();

    // Position windows
    await user1Page.setViewport({ width: 450, height: 800 });
    await user2Page.setViewport({ width: 450, height: 800 });
    await user3Page.setViewport({ width: 450, height: 800 });

    // Load the app with signaling server enabled
    const appUrl = 'http://localhost:8080/?signaling_server=localhost:3000';

    console.log('Loading application for three users...');
    await Promise.all([
      user1Page.goto(appUrl),
      user2Page.goto(appUrl),
      user3Page.goto(appUrl)
    ]);

    await delay(3000); // Wait for app to load

    // Set usernames
    console.log('Setting usernames...');
    await user1Page.evaluate(() => {
      const input = document.getElementById('userNameInput');
      input.value = 'Alice';
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await user2Page.evaluate(() => {
      const input = document.getElementById('userNameInput');
      input.value = 'Bob';
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await user3Page.evaluate(() => {
      const input = document.getElementById('userNameInput');
      input.value = 'Charlie';
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await delay(1000);

    // Alice and Bob join room first
    const roomId = 'sync-test-' + Date.now();
    console.log(`Alice and Bob joining room: ${roomId}`);

    await user1Page.evaluate((rid) => {
      const input = document.getElementById('roomIdInput');
      input.value = rid;
      document.getElementById('joinRoomBtn').click();
    }, roomId);

    await delay(1000);

    await user2Page.evaluate((rid) => {
      const input = document.getElementById('roomIdInput');
      input.value = rid;
      document.getElementById('joinRoomBtn').click();
    }, roomId);

    await delay(2000); // Wait for P2P connection

    // Alice sends messages
    console.log('Alice sending messages...');
    const messages = [
      'Hello everyone!',
      'This is a test of chat history sync',
      'Message 3 from Alice',
      'Testing sync functionality'
    ];

    for (const msg of messages) {
      await user1Page.evaluate((text) => {
        const input = document.getElementById('messageInput');
        input.value = text;
        document.getElementById('sendMessageBtn').click();
      }, msg);
      await delay(500);
    }

    // Bob sends messages
    console.log('Bob sending messages...');
    const bobMessages = [
      'Hi Alice!',
      'Testing from Bob',
      'Sync test in progress'
    ];

    for (const msg of bobMessages) {
      await user2Page.evaluate((text) => {
        const input = document.getElementById('messageInput');
        input.value = text;
        document.getElementById('sendMessageBtn').click();
      }, msg);
      await delay(500);
    }

    await delay(2000);

    // Charlie joins late - should receive all messages via sync
    console.log(`Charlie joining room late: ${roomId}`);
    await user3Page.evaluate((rid) => {
      const input = document.getElementById('roomIdInput');
      input.value = rid;
      document.getElementById('joinRoomBtn').click();
    }, roomId);

    // Wait for sync to complete
    await delay(3000);

    // Check Charlie received all messages
    console.log('\n=== Checking message sync ===');

    const charlieMessages = await user3Page.evaluate(() => {
      const messages = [];
      document.querySelectorAll('.message').forEach(msg => {
        const sender = msg.querySelector('.message-sender')?.textContent;
        const content = msg.querySelector('.message-content')?.textContent;
        if (sender && content) {
          messages.push(`${sender}: ${content}`);
        }
      });
      return messages;
    });

    console.log('\nMessages Charlie received:');
    charlieMessages.forEach(msg => console.log('  - ' + msg));

    // Verify sync
    const expectedCount = messages.length + bobMessages.length;
    if (charlieMessages.length === expectedCount) {
      console.log(`✅ SUCCESS: Charlie received all ${expectedCount} messages via sync!`);
    } else {
      console.log(`❌ FAILURE: Charlie received ${charlieMessages.length} messages, expected ${expectedCount}`);
    }

    // Check all users have same messages
    const aliceCount = await user1Page.evaluate(() =>
      document.querySelectorAll('.message').length
    );
    const bobCount = await user2Page.evaluate(() =>
      document.querySelectorAll('.message').length
    );
    const charlieCount = await user3Page.evaluate(() =>
      document.querySelectorAll('.message').length
    );

    console.log(`\nMessage counts: Alice=${aliceCount}, Bob=${bobCount}, Charlie=${charlieCount}`);

    if (aliceCount === bobCount && bobCount === charlieCount) {
      console.log('✅ All users have the same message count');
    } else {
      console.log('❌ Message counts differ between users');
    }

    // Check console for sync logs
    console.log('\n=== Checking console logs for sync activity ===');

    const charlieLogs = await user3Page.evaluate(() => {
      const logs = [];
      // Get recent console logs if available
      if (window.consoleHistory) {
        return window.consoleHistory.filter(log =>
          log.includes('sync') || log.includes('Sync')
        );
      }
      return logs;
    });

    if (charlieLogs.length > 0) {
      console.log('Sync-related logs found:');
      charlieLogs.forEach(log => console.log('  - ' + log));
    }

    console.log('\n✅ Test completed. Check the browser windows to verify message sync.');
    console.log('Press Ctrl+C to close the browsers and exit.');

    // Keep browser open for manual inspection
    await delay(60000);

  } catch (error) {
    console.error('Test failed:', error);
  } finally {
    await browser.close();
  }
}

test().catch(console.error);