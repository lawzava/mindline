#!/usr/bin/env node

/**
 * Comprehensive test for chat history sync functionality
 * Tests the scenarios requested:
 * 1. Alice joins room and sends 3 messages
 * 2. Bob joins same room and verifies sync of all 3 messages
 * 3. Bob sends message and Alice receives it
 * 4. Charlie joins late and receives all previous messages
 *
 * Also monitors for:
 * - WASM errors in console
 * - Messages displaying correctly (not as "[object Object]")
 * - No record_performance_metric errors
 */

const { chromium } = require('playwright');

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function captureConsoleErrors(page, userLabel) {
  const errors = [];

  page.on('console', msg => {
    if (msg.type() === 'error') {
      const error = `[${userLabel}] Console Error: ${msg.text()}`;
      errors.push(error);
      console.error(error);
    }
  });

  page.on('pageerror', error => {
    const errorMsg = `[${userLabel}] Page Error: ${error.message}`;
    errors.push(errorMsg);
    console.error(errorMsg);
  });

  return errors;
}

async function setupUser(browser, userLabel, roomId = null) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = await captureConsoleErrors(page, userLabel);

  const appUrl = 'http://localhost:8080/?signaling_server=localhost:3000';

  console.log(`Setting up ${userLabel}...`);
  await page.goto(appUrl);
  await delay(3000); // Wait for app to load

  // Set username
  await page.fill('#userName', userLabel);
  await delay(500);

  if (roomId) {
    // Join room
    console.log(`${userLabel} joining room: ${roomId}`);
    await page.click('#roomsHeader');
    await delay(500);
    await page.fill('#roomIdInput', roomId);
    await page.click('#joinRoomBtn');
    await delay(3000); // Wait for connection and potential sync
  }

  return { context, page, errors };
}

async function getMessages(page, userLabel) {
  console.log(`Getting messages for ${userLabel}...`);

  const messages = await page.evaluate(() => {
    const messageElements = [];
    document.querySelectorAll('.message').forEach(msg => {
      const sender = msg.querySelector('.message-sender')?.textContent;
      const content = msg.querySelector('.message-content')?.textContent;

      if (sender && content) {
        const cleanSender = sender.replace(':', '').trim();
        messageElements.push({
          sender: cleanSender,
          content: content.trim(),
          full: `${cleanSender}: ${content.trim()}`
        });
      }
    });
    return messageElements;
  });

  console.log(`${userLabel} sees ${messages.length} messages:`);
  messages.forEach((msg, i) => console.log(`  ${i + 1}. ${msg.full}`));

  return messages;
}

async function sendMessage(page, userLabel, message) {
  console.log(`${userLabel} sending: "${message}"`);
  await page.fill('#messageInput', message);
  await page.click('#sendBtn');
  await delay(1000); // Wait for message to be sent
}

async function validateMessages(messages, expectedCount, description, userLabel) {
  console.log(`\nValidating ${description} for ${userLabel}:`);
  console.log(`Expected: ${expectedCount}, Actual: ${messages.length}`);

  // Check for "[object Object]" in messages
  const objectObjectErrors = messages.filter(msg =>
    msg.content.includes('[object Object]') ||
    msg.sender.includes('[object Object]')
  );

  if (objectObjectErrors.length > 0) {
    console.error(`❌ ERROR: Found "[object Object]" in messages for ${userLabel}:`);
    objectObjectErrors.forEach(msg => console.error(`  - ${msg.full}`));
    return false;
  }

  if (messages.length === expectedCount) {
    console.log(`✅ SUCCESS: ${description} - ${userLabel} has ${expectedCount} messages`);
    return true;
  } else {
    console.log(`❌ FAILURE: ${description} - Expected ${expectedCount}, got ${messages.length}`);
    return false;
  }
}

async function test() {
  console.log('🚀 Starting comprehensive chat history sync test...\n');

  const browser = await chromium.launch({
    headless: false,
    devtools: false
  });

  let testResults = {
    passed: 0,
    failed: 0,
    errors: [],
    details: []
  };

  try {
    const roomId = 'test-sync-' + Date.now();
    console.log(`🏠 Room ID: ${roomId}\n`);

    // ==========================================
    // SCENARIO 1: Alice joins room and sends 3 messages
    // ==========================================
    console.log('=== SCENARIO 1: Alice joins and sends 3 messages ===');

    const alice = await setupUser(browser, 'Alice');

    // Alice creates/joins room
    await alice.page.click('#roomsHeader');
    await delay(500);
    await alice.page.fill('#roomIdInput', roomId);
    await alice.page.click('#joinRoomBtn');
    await delay(2000);

    // Alice sends 3 messages
    const aliceMessages = [
      'Hello from Alice!',
      'This is message 2',
      'Testing sync functionality'
    ];

    for (let i = 0; i < aliceMessages.length; i++) {
      await sendMessage(alice.page, 'Alice', aliceMessages[i]);
      await delay(500);
    }

    // Verify Alice has 3 messages
    const aliceMessagesAfter = await getMessages(alice.page, 'Alice');
    const scenario1Pass = await validateMessages(aliceMessagesAfter, 3, 'Scenario 1', 'Alice');
    testResults.passed += scenario1Pass ? 1 : 0;
    testResults.failed += scenario1Pass ? 0 : 1;
    testResults.details.push(`Scenario 1 (Alice sends 3 messages): ${scenario1Pass ? 'PASSED' : 'FAILED'}`);

    // ==========================================
    // SCENARIO 2: Bob joins and verifies sync
    // ==========================================
    console.log('\n=== SCENARIO 2: Bob joins and verifies message sync ===');

    const bob = await setupUser(browser, 'Bob', roomId);

    // Get Bob's messages after joining
    const bobMessages = await getMessages(bob.page, 'Bob');
    const scenario2Pass = await validateMessages(bobMessages, 3, 'Scenario 2', 'Bob');
    testResults.passed += scenario2Pass ? 1 : 0;
    testResults.failed += scenario2Pass ? 0 : 1;
    testResults.details.push(`Scenario 2 (Bob receives sync): ${scenario2Pass ? 'PASSED' : 'FAILED'}`);

    // ==========================================
    // SCENARIO 3: Bob sends message, Alice receives
    // ==========================================
    console.log('\n=== SCENARIO 3: Real-time messaging (Bob to Alice) ===');

    await sendMessage(bob.page, 'Bob', 'Hi Alice, I got your messages!');
    await delay(2000); // Wait for real-time delivery

    // Check Alice receives Bob's message
    const aliceMessagesWithBob = await getMessages(alice.page, 'Alice');
    const scenario3Pass = await validateMessages(aliceMessagesWithBob, 4, 'Scenario 3', 'Alice');

    // Additional check: verify last message is from Bob
    if (scenario3Pass && aliceMessagesWithBob.length > 0) {
      const lastMessage = aliceMessagesWithBob[aliceMessagesWithBob.length - 1];
      if (lastMessage.sender === 'Bob') {
        console.log('✅ SUCCESS: Alice received Bob\'s message in real-time');
      } else {
        console.log('❌ FAILURE: Last message is not from Bob');
        testResults.failed += 1;
        testResults.details.push('Scenario 3 (Real-time delivery): FAILED - Wrong sender');
      }
    }

    testResults.passed += scenario3Pass ? 1 : 0;
    testResults.failed += scenario3Pass ? 0 : 1;
    testResults.details.push(`Scenario 3 (Real-time messaging): ${scenario3Pass ? 'PASSED' : 'FAILED'}`);

    // ==========================================
    // SCENARIO 4: Charlie joins late and gets full history
    // ==========================================
    console.log('\n=== SCENARIO 4: Charlie joins late and receives full history ===');

    const charlie = await setupUser(browser, 'Charlie', roomId);

    // Get Charlie's messages after joining
    const charlieMessages = await getMessages(charlie.page, 'Charlie');
    const scenario4Pass = await validateMessages(charlieMessages, 4, 'Scenario 4', 'Charlie');
    testResults.passed += scenario4Pass ? 1 : 0;
    testResults.failed += scenario4Pass ? 0 : 1;
    testResults.details.push(`Scenario 4 (Charlie late join): ${scenario4Pass ? 'PASSED' : 'FAILED'}`);

    // ==========================================
    // ERROR MONITORING
    // ==========================================
    console.log('\n=== ERROR MONITORING ===');

    const allErrors = [...alice.errors, ...bob.errors, ...charlie.errors];

    // Check for specific error types
    const wasmErrors = allErrors.filter(error =>
      error.toLowerCase().includes('wasm') ||
      error.toLowerCase().includes('webassembly')
    );

    const performanceErrors = allErrors.filter(error =>
      error.includes('record_performance_metric')
    );

    const objectObjectErrors = allErrors.filter(error =>
      error.includes('[object Object]')
    );

    testResults.errors = {
      total: allErrors.length,
      wasm: wasmErrors.length,
      performance: performanceErrors.length,
      objectObject: objectObjectErrors.length,
      all: allErrors
    };

    console.log(`Total console errors: ${allErrors.length}`);
    console.log(`WASM errors: ${wasmErrors.length}`);
    console.log(`Performance metric errors: ${performanceErrors.length}`);
    console.log(`"[object Object]" errors: ${objectObjectErrors.length}`);

    if (allErrors.length > 0) {
      console.log('\nAll errors found:');
      allErrors.forEach(error => console.log(`  - ${error}`));
    }

    // Final verification: Test cross-user messaging
    console.log('\n=== FINAL VERIFICATION: Cross-user messaging ===');

    // Charlie sends a message
    await sendMessage(charlie.page, 'Charlie', 'Charlie here! Testing cross-user sync');
    await delay(2000);

    // Verify all users see Charlie's message
    const finalAliceMessages = await getMessages(alice.page, 'Alice');
    const finalBobMessages = await getMessages(bob.page, 'Bob');
    const finalCharlieMessages = await getMessages(charlie.page, 'Charlie');

    const finalTestPass =
      finalAliceMessages.length === 5 &&
      finalBobMessages.length === 5 &&
      finalCharlieMessages.length === 5;

    testResults.passed += finalTestPass ? 1 : 0;
    testResults.failed += finalTestPass ? 0 : 1;
    testResults.details.push(`Final verification (All users see 5 messages): ${finalTestPass ? 'PASSED' : 'FAILED'}`);

    console.log(`Final message counts - Alice: ${finalAliceMessages.length}, Bob: ${finalBobMessages.length}, Charlie: ${finalCharlieMessages.length}`);

    console.log('\n📊 Keeping browsers open for 30 seconds for inspection...');
    await delay(30000);

  } catch (error) {
    console.error('🚨 Test execution failed:', error);
    testResults.errors.all.push(`Test execution error: ${error.message}`);
    testResults.failed += 1;
  } finally {
    await browser.close();
  }

  // ==========================================
  // TEST REPORT
  // ==========================================
  console.log('\n' + '='.repeat(60));
  console.log('📋 COMPREHENSIVE TEST REPORT');
  console.log('='.repeat(60));

  console.log(`\n📈 SUMMARY:`);
  console.log(`  ✅ Tests Passed: ${testResults.passed}`);
  console.log(`  ❌ Tests Failed: ${testResults.failed}`);
  console.log(`  🚨 Total Errors: ${testResults.errors.total}`);

  console.log(`\n📝 DETAILED RESULTS:`);
  testResults.details.forEach(detail => console.log(`  • ${detail}`));

  if (testResults.errors.total > 0) {
    console.log(`\n🐛 ERROR BREAKDOWN:`);
    console.log(`  • WASM Errors: ${testResults.errors.wasm}`);
    console.log(`  • Performance Errors: ${testResults.errors.performance}`);
    console.log(`  • Object Display Errors: ${testResults.errors.objectObject}`);
    console.log(`  • Other Errors: ${testResults.errors.total - testResults.errors.wasm - testResults.errors.performance - testResults.errors.objectObject}`);
  }

  const overallStatus = testResults.failed === 0 && testResults.errors.wasm === 0 && testResults.errors.objectObject === 0;
  console.log(`\n🎯 OVERALL STATUS: ${overallStatus ? '✅ PASSED' : '❌ FAILED'}`);

  if (!overallStatus) {
    console.log('\n🔧 ISSUES FOUND:');
    if (testResults.failed > 0) {
      console.log(`  • ${testResults.failed} test scenario(s) failed`);
    }
    if (testResults.errors.wasm > 0) {
      console.log(`  • ${testResults.errors.wasm} WASM error(s) detected`);
    }
    if (testResults.errors.objectObject > 0) {
      console.log(`  • ${testResults.errors.objectObject} message display error(s) found`);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('🏁 TEST EXECUTION COMPLETE');
  console.log('='.repeat(60));

  return testResults;
}

if (require.main === module) {
  test().catch(console.error);
}

module.exports = { test };