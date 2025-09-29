// Comprehensive test for chat history sync
const { chromium } = require('playwright');

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function test() {
  console.log('🧪 COMPREHENSIVE CHAT HISTORY SYNC TEST\n');
  console.log('=' .repeat(50));

  const browser = await chromium.launch({ headless: false });

  try {
    const roomId = `sync-test-${Date.now()}`;
    console.log(`📝 Room ID: ${roomId}\n`);

    // ============= TEST 1: Single User Persistence =============
    console.log('TEST 1: Single User Message Persistence');
    console.log('-'.repeat(40));

    const context1 = await browser.newContext();
    const page1 = await context1.newPage();

    await page1.goto('http://localhost:8080');
    await sleep(2000);

    // User A joins and sends messages
    await page1.fill('#userName', 'Alice');
    await page1.fill('#roomIdInput', roomId);
    await page1.click('#joinRoomBtn', { force: true });
    await sleep(2000);

    await page1.fill('#messageInput', 'Alice message 1');
    await page1.click('button:has-text("SEND")');
    await sleep(500);

    await page1.fill('#messageInput', 'Alice message 2');
    await page1.click('button:has-text("SEND")');
    await sleep(500);

    const aliceMessages1 = await page1.locator('.neo-message-bubble').count();
    console.log(`✅ Alice sent ${aliceMessages1} messages`);

    // Alice refreshes page
    await page1.reload();
    await sleep(2000);

    await page1.fill('#roomIdInput', roomId);
    await page1.click('#joinRoomBtn', { force: true });
    await sleep(2000);

    const aliceMessages2 = await page1.locator('.neo-message-bubble').count();
    console.log(`📊 After refresh: Alice sees ${aliceMessages2} messages`);

    if (aliceMessages2 >= 2) {
      console.log('✅ TEST 1 PASSED: Messages persist after refresh\n');
    } else {
      console.log('❌ TEST 1 FAILED: Messages lost after refresh\n');
    }

    // ============= TEST 2: P2P Message Sync =============
    console.log('TEST 2: P2P Message Synchronization');
    console.log('-'.repeat(40));

    // Bob joins the same room
    const context2 = await browser.newContext();
    const page2 = await context2.newPage();

    await page2.goto('http://localhost:8080');
    await sleep(2000);

    await page2.fill('#userName', 'Bob');
    await page2.fill('#roomIdInput', roomId);
    await page2.click('#joinRoomBtn', { force: true });
    await sleep(3000); // Wait for sync

    const bobMessages1 = await page2.locator('.neo-message-bubble').count();
    console.log(`📊 Bob sees ${bobMessages1} messages upon joining`);

    // Bob sends a message
    await page2.fill('#messageInput', 'Bob message 1');
    await page2.click('button:has-text("SEND")');
    await sleep(1000);

    // Check if Alice sees Bob's message
    const aliceMessages3 = await page1.locator('.neo-message-bubble').count();
    const bobMessages2 = await page2.locator('.neo-message-bubble').count();

    console.log(`📊 After Bob's message:`);
    console.log(`   Alice sees: ${aliceMessages3} messages`);
    console.log(`   Bob sees: ${bobMessages2} messages`);

    if (aliceMessages3 >= 3 && bobMessages2 >= 3) {
      console.log('✅ TEST 2 PASSED: P2P messaging works\n');
    } else {
      console.log('❌ TEST 2 FAILED: P2P sync not working\n');
    }

    // ============= TEST 3: New User Sync =============
    console.log('TEST 3: New User History Sync');
    console.log('-'.repeat(40));

    // Charlie joins as a completely new user
    const context3 = await browser.newContext();
    const page3 = await context3.newPage();

    await page3.goto('http://localhost:8080');
    await sleep(2000);

    await page3.fill('#userName', 'Charlie');
    await page3.fill('#roomIdInput', roomId);
    await page3.click('#joinRoomBtn', { force: true });
    await sleep(4000); // Wait for sync from peers

    const charlieMessages = await page3.locator('.neo-message-bubble').count();
    console.log(`📊 Charlie (new user) sees ${charlieMessages} messages`);

    if (charlieMessages >= 3) {
      console.log('✅ TEST 3 PASSED: New users receive history\n');
    } else {
      console.log('❌ TEST 3 FAILED: New users don\'t get history\n');
    }

    // ============= TEST 4: Concurrent Messages =============
    console.log('TEST 4: Concurrent Message Handling');
    console.log('-'.repeat(40));

    // All users send messages simultaneously
    await Promise.all([
      page1.fill('#messageInput', 'Alice concurrent'),
      page2.fill('#messageInput', 'Bob concurrent'),
      page3.fill('#messageInput', 'Charlie concurrent')
    ]);

    await Promise.all([
      page1.click('button:has-text("SEND")'),
      page2.click('button:has-text("SEND")'),
      page3.click('button:has-text("SEND")')
    ]);

    await sleep(2000);

    const finalAlice = await page1.locator('.neo-message-bubble').count();
    const finalBob = await page2.locator('.neo-message-bubble').count();
    const finalCharlie = await page3.locator('.neo-message-bubble').count();

    console.log(`📊 Final message counts:`);
    console.log(`   Alice: ${finalAlice} messages`);
    console.log(`   Bob: ${finalBob} messages`);
    console.log(`   Charlie: ${finalCharlie} messages`);

    if (finalAlice >= 6 && finalBob >= 6 && finalCharlie >= 6) {
      console.log('✅ TEST 4 PASSED: Concurrent messages handled\n');
    } else {
      console.log('⚠️  TEST 4 PARTIAL: Some messages may be missing\n');
    }

    // ============= TEST 5: Persistence After All Leave =============
    console.log('TEST 5: Persistence After All Users Leave');
    console.log('-'.repeat(40));

    // All users leave
    await page1.close();
    await page2.close();
    await page3.close();
    await sleep(1000);

    // New user David joins the abandoned room
    const context4 = await browser.newContext();
    const page4 = await context4.newPage();

    await page4.goto('http://localhost:8080');
    await sleep(2000);

    await page4.fill('#userName', 'David');
    await page4.fill('#roomIdInput', roomId);
    await page4.click('#joinRoomBtn', { force: true });
    await sleep(2000);

    const davidMessages = await page4.locator('.neo-message-bubble').count();
    console.log(`📊 David (joining empty room) sees ${davidMessages} messages`);

    // David should see his own history if he has any, but not others' unless synced
    console.log('ℹ️  Note: David sees only his localStorage (expected behavior)\n');

    // ============= FINAL RESULTS =============
    console.log('=' .repeat(50));
    console.log('FINAL TEST RESULTS:');
    console.log('=' .repeat(50));

    let passCount = 0;
    if (aliceMessages2 >= 2) passCount++;
    if (aliceMessages3 >= 3 && bobMessages2 >= 3) passCount++;
    if (charlieMessages >= 3) passCount++;
    if (finalAlice >= 6 && finalBob >= 6 && finalCharlie >= 6) passCount++;

    console.log(`\n🎯 PASSED: ${passCount}/4 core tests`);

    if (passCount === 4) {
      console.log('🎉 ALL TESTS PASSED! Chat history sync is working perfectly!');
    } else if (passCount >= 2) {
      console.log('⚠️  PARTIAL SUCCESS: Some features working, some need attention');
    } else {
      console.log('❌ NEEDS WORK: Major issues with chat history sync');
    }

    await sleep(5000);

    // Cleanup
    await context4.close();

  } catch (error) {
    console.error('❌ Test error:', error);
  } finally {
    await browser.close();
  }
}

test().catch(console.error);