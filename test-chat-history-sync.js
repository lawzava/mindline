#!/usr/bin/env node

/**
 * Test script for chat history sync between multiple users
 * Tests that messages sync correctly when users join and re-join rooms
 */

const { chromium } = require('playwright');

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function setupUser(browser, userName) {
  const context = await browser.newContext();
  const page = await context.newPage();

  // Load the app with signaling server
  const appUrl = 'http://localhost:8080/?signaling_server=localhost:3000';
  await page.goto(appUrl, { waitUntil: 'networkidle' });

  // Wait for the username input to be available
  await page.waitForSelector('#userName', { state: 'visible', timeout: 10000 });
  await delay(1000); // Extra delay to ensure WASM is loaded

  // Set username
  await page.fill('#userName', userName);
  await delay(500);

  return { context, page };
}

async function sendMessage(page, message) {
  await page.fill('#messageInput', message);
  await page.click('#sendBtn');
  await delay(500);
}

async function joinRoom(page, roomId) {
  await page.fill('#roomIdInput', roomId);
  await page.click('#joinRoomBtn');
  await delay(2000); // Wait for connection
}

async function getMessages(page) {
  return await page.evaluate(() => {
    const messages = [];
    document.querySelectorAll('.message').forEach(msg => {
      const sender = msg.querySelector('.message-sender')?.textContent;
      const content = msg.querySelector('.message-content')?.textContent;
      if (sender && content) {
        messages.push({ sender: sender.replace(':', '').trim(), content });
      }
    });
    return messages;
  });
}

async function test() {
  console.log('Starting comprehensive chat history sync test...\n');

  const browser = await chromium.launch({
    headless: false,
    devtools: true
  });

  try {
    const roomId = 'test-room-' + Date.now();

    // ===== TEST 1: Basic sync between two users =====
    console.log('TEST 1: Basic sync between Alice and Bob');
    console.log('=========================================');

    // Setup Alice and Bob
    const alice = await setupUser(browser, 'Alice');
    const bob = await setupUser(browser, 'Bob');

    // Alice creates/joins room and sends messages
    console.log('Alice joining room:', roomId);
    await joinRoom(alice.page, roomId);

    console.log('Alice sending messages...');
    await sendMessage(alice.page, 'Hello from Alice!');
    await sendMessage(alice.page, 'This is message 2');
    await sendMessage(alice.page, 'Testing sync feature');

    // Bob joins - should get synced messages
    console.log('Bob joining room:', roomId);
    await joinRoom(bob.page, roomId);
    await delay(3000); // Wait for sync

    const bobMessages = await getMessages(bob.page);
    console.log(`Bob received ${bobMessages.length} messages:`);
    bobMessages.forEach(msg => console.log(`  - ${msg.sender}: ${msg.content}`));

    if (bobMessages.length === 3) {
      console.log('✅ TEST 1 PASSED: Bob received all messages from Alice\n');
    } else {
      console.log(`❌ TEST 1 FAILED: Expected 3 messages, got ${bobMessages.length}\n`);
    }

    // ===== TEST 2: Third user joins late =====
    console.log('TEST 2: Charlie joins after conversation');
    console.log('=========================================');

    // Bob sends additional messages
    console.log('Bob sending messages...');
    await sendMessage(bob.page, 'Hi Alice!');
    await sendMessage(bob.page, 'Bob here');

    // Charlie joins late
    const charlie = await setupUser(browser, 'Charlie');
    console.log('Charlie joining room:', roomId);
    await joinRoom(charlie.page, roomId);
    await delay(3000); // Wait for sync

    const charlieMessages = await getMessages(charlie.page);
    console.log(`Charlie received ${charlieMessages.length} messages:`);
    charlieMessages.forEach(msg => console.log(`  - ${msg.sender}: ${msg.content}`));

    if (charlieMessages.length === 5) {
      console.log('✅ TEST 2 PASSED: Charlie received all messages\n');
    } else {
      console.log(`❌ TEST 2 FAILED: Expected 5 messages, got ${charlieMessages.length}\n`);
    }

    // ===== TEST 3: User leaves and rejoins =====
    console.log('TEST 3: Alice leaves and rejoins');
    console.log('=================================');

    // Close Alice's context completely
    await alice.context.close();
    await delay(2000);

    // Charlie sends message while Alice is away
    console.log('Charlie sending message while Alice is away...');
    await sendMessage(charlie.page, 'Message while Alice is gone');

    // Alice rejoins as new session
    console.log('Alice rejoining room...');
    const aliceNew = await setupUser(browser, 'Alice');
    await joinRoom(aliceNew.page, roomId);
    await delay(3000); // Wait for sync

    const aliceNewMessages = await getMessages(aliceNew.page);
    console.log(`Alice received ${aliceNewMessages.length} messages after rejoin:`);
    aliceNewMessages.forEach(msg => console.log(`  - ${msg.sender}: ${msg.content}`));

    if (aliceNewMessages.length === 6) {
      console.log('✅ TEST 3 PASSED: Alice received all messages including ones sent while away\n');
    } else {
      console.log(`❌ TEST 3 FAILED: Expected 6 messages, got ${aliceNewMessages.length}\n`);
    }

    // ===== TEST 4: New user with same name =====
    console.log('TEST 4: New user with same name as existing user');
    console.log('=================================================');

    // Close Bob's context
    await bob.context.close();
    await delay(2000);

    // New user also named Bob joins
    const bobNew = await setupUser(browser, 'Bob');
    console.log('New Bob joining room:', roomId);
    await joinRoom(bobNew.page, roomId);
    await delay(3000); // Wait for sync

    const bobNewMessages = await getMessages(bobNew.page);
    console.log(`New Bob received ${bobNewMessages.length} messages:`);
    bobNewMessages.forEach(msg => console.log(`  - ${msg.sender}: ${msg.content}`));

    if (bobNewMessages.length === 6) {
      console.log('✅ TEST 4 PASSED: New Bob received all messages\n');
    } else {
      console.log(`❌ TEST 4 FAILED: Expected 6 messages, got ${bobNewMessages.length}\n`);
    }

    // ===== SUMMARY =====
    console.log('=================================');
    console.log('TEST SUMMARY');
    console.log('=================================');
    console.log('All tests completed. Check results above.');

    console.log('\nKeeping browser open for 30 seconds for manual inspection...');
    console.log('Press Ctrl+C to close and exit.');

    await delay(30000);

  } catch (error) {
    console.error('Test failed with error:', error);
  } finally {
    await browser.close();
  }
}

test().catch(console.error);
