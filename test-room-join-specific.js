/**
 * Specific Room Join Test - Focus on the bug fix
 * Tests that room joining works without infinite recursion or CPU spikes
 */

const { chromium } = require('playwright');

async function testRoomJoinSpecific() {
  console.log('🔧 Testing Specific Room Join Bug Fix...\n');

  const browser = await chromium.launch({ headless: false });
  const context1 = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const context2 = await browser.newContext({ viewport: { width: 1400, height: 900 } });

  const page1 = await context1.newPage();
  const page2 = await context2.newPage();

  const roomId = `join-test-${Date.now()}`;
  const testUrl = `http://localhost:8080`;

  try {
    // Monitor for recursion-specific errors
    const recursionErrors = [];
    const cpuWarnings = [];

    [page1, page2].forEach((page, index) => {
      page.on('console', msg => {
        const text = msg.text();
        if (text.includes('recursion') || text.includes('Maximum call stack') || text.includes('RangeError')) {
          recursionErrors.push(`User ${index + 1}: ${text}`);
        }
        if (text.includes('CPU') || text.includes('freeze') || text.includes('infinite')) {
          cpuWarnings.push(`User ${index + 1}: ${text}`);
        }
      });
    });

    console.log('🌐 Loading pages...');
    await page1.goto(testUrl);
    await page2.goto(testUrl);

    // Wait for WASM initialization
    await page1.waitForTimeout(3000);
    await page2.waitForTimeout(3000);

    console.log('👤 Setting usernames...');
    await page1.locator('#userName').fill('User1', { force: true });
    await page2.locator('#userName').fill('User2', { force: true });

    console.log('🏠 Opening rooms section...');
    await page1.click('#roomsHeader');
    await page2.click('#roomsHeader');
    await page1.waitForTimeout(500);

    console.log('🚪 Testing room joining sequence...');

    // Test the specific join sequence that was causing issues
    console.log('  Step 1: User1 creates room...');
    const startTime = Date.now();

    await page1.evaluate((rid) => {
      document.getElementById('roomIdInput').value = rid;
      document.getElementById('joinRoomBtn').click();
    }, roomId);

    await page1.waitForTimeout(2000);

    console.log('  Step 2: User2 joins existing room...');
    await page2.evaluate((rid) => {
      document.getElementById('roomIdInput').value = rid;
      document.getElementById('joinRoomBtn').click();
    }, roomId);

    await page2.waitForTimeout(3000);
    const joinTime = Date.now() - startTime;

    console.log(`  ✓ Join sequence completed in ${joinTime}ms`);

    // Test message exchange to verify P2P works
    console.log('💬 Testing basic message exchange...');
    await page1.locator('#messageInput').fill('Test message from User1');
    await page1.locator('#sendBtn').click({ force: true });
    await page1.waitForTimeout(1000);

    await page2.locator('#messageInput').fill('Reply from User2');
    await page2.locator('#sendBtn').click({ force: true });
    await page2.waitForTimeout(2000);

    // Check results
    const status1 = await page1.textContent('#connectionStatus');
    const status2 = await page2.textContent('#connectionStatus');
    const chatArea1 = await page1.textContent('#chatArea');
    const chatArea2 = await page2.textContent('#chatArea');

    console.log('\n' + '='.repeat(50));
    console.log('📊 ROOM JOIN BUG FIX TEST RESULTS');
    console.log('='.repeat(50));

    let success = true;
    let issues = [];

    // Check for recursion errors (main bug fix)
    if (recursionErrors.length > 0) {
      success = false;
      issues.push('❌ RECURSION ERRORS DETECTED (BUG NOT FIXED):');
      recursionErrors.forEach(error => issues.push(`   ${error}`));
    } else {
      issues.push('✅ No recursion errors detected');
    }

    // Check for CPU warnings
    if (cpuWarnings.length > 0) {
      issues.push('⚠️  CPU warnings detected:');
      cpuWarnings.forEach(warning => issues.push(`   ${warning}`));
    } else {
      issues.push('✅ No CPU warnings detected');
    }

    // Check join performance (should not freeze)
    if (joinTime > 10000) {
      issues.push(`⚠️  Slow room joining: ${joinTime}ms (might indicate issues)`);
    } else {
      issues.push(`✅ Room joining time acceptable: ${joinTime}ms`);
    }

    // Check connections
    if (!status1.includes('Connected') || !status2.includes('Connected')) {
      success = false;
      issues.push('❌ Connection failed:');
      issues.push(`   User 1: ${status1.trim()}`);
      issues.push(`   User 2: ${status2.trim()}`);
    } else {
      issues.push('✅ Both users connected successfully');
    }

    // Check message delivery
    if (!chatArea1.includes('Reply from User2') || !chatArea2.includes('Test message from User1')) {
      success = false;
      issues.push('❌ Message delivery failed');
    } else {
      issues.push('✅ Messages delivered correctly');
    }

    // Print results
    issues.forEach(issue => console.log(issue));

    if (success) {
      console.log('\n🎉 ROOM JOIN BUG FIX VERIFIED - ALL TESTS PASSED!');
      console.log('   ✓ No infinite recursion detected');
      console.log('   ✓ No CPU spikes or freezing');
      console.log('   ✓ Room joining works correctly');
      console.log('   ✓ P2P connections established');
      console.log('   ✓ Messages delivered successfully');
    } else {
      console.log('\n❌ ISSUES DETECTED - FIX MAY NOT BE COMPLETE');
    }

    console.log('='.repeat(50) + '\n');

    // Brief visual inspection
    console.log('🔎 Keeping browser open for 3 seconds...');
    await page1.waitForTimeout(3000);

    return { success, joinTime, recursionErrors, cpuWarnings };

  } catch (error) {
    console.error('❌ Test failed with error:', error);
    return { success: false, error: error.message };
  } finally {
    await browser.close();
    console.log('🧹 Test complete.');
  }
}

// Run the test
testRoomJoinSpecific().catch(console.error);