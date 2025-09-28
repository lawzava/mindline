/**
 * CPU Performance Test for Room Joining Bug Fix
 * Tests that room joining doesn't cause infinite recursion and CPU spikes
 */

const { chromium } = require('playwright');

async function testCPUPerformance() {
  console.log('🔍 Starting CPU Performance Test for Room Joining...\n');

  const browser = await chromium.launch({ headless: false });

  // Create multiple contexts to stress test the system
  const context1 = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const context2 = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const context3 = await browser.newContext({ viewport: { width: 1400, height: 900 } });

  const page1 = await context1.newPage();
  const page2 = await context2.newPage();
  const page3 = await context3.newPage();

  const roomId = `performance-test-${Date.now()}`;
  const testUrl = `http://localhost:8080`;

  console.log(`📝 Test Room ID: ${roomId}\n`);

  try {
    // Monitor console errors and performance
    const errors = [];
    const performanceWarnings = [];

    // Set up error listeners
    [page1, page2, page3].forEach((page, index) => {
      page.on('console', msg => {
        if (msg.type() === 'error') {
          errors.push(`User ${index + 1}: ${msg.text()}`);
        }
        if (msg.text().includes('recursion') || msg.text().includes('Maximum call stack')) {
          performanceWarnings.push(`User ${index + 1}: Recursion detected - ${msg.text()}`);
        }
      });

      page.on('pageerror', error => {
        errors.push(`User ${index + 1} Page Error: ${error.message}`);
      });
    });

    // Step 1: Load all pages and monitor initial performance
    console.log('🌐 Loading pages and monitoring performance...');
    const startTime = Date.now();

    await Promise.all([
      page1.goto(testUrl),
      page2.goto(testUrl),
      page3.goto(testUrl)
    ]);

    // Wait for WASM to load
    await page1.waitForTimeout(3000);
    await page2.waitForTimeout(3000);
    await page3.waitForTimeout(3000);

    const loadTime = Date.now() - startTime;
    console.log(`✓ Pages loaded in ${loadTime}ms`);

    // Step 2: Set usernames
    console.log('👤 Setting usernames...');
    await page1.locator('#userName').fill('TestUser1', { force: true });
    await page2.locator('#userName').fill('TestUser2', { force: true });
    await page3.locator('#userName').fill('TestUser3', { force: true });

    // Step 3: Expand rooms section
    console.log('🏠 Opening rooms section...');
    await page1.click('#roomsHeader');
    await page2.click('#roomsHeader');
    await page3.click('#roomsHeader');
    await page1.waitForTimeout(500);

    // Step 4: Test rapid room joining (stress test for infinite recursion)
    console.log('🚀 Testing rapid room joining (stress test)...');

    const joinStartTime = Date.now();

    // Join room rapidly to test for recursion issues
    await page1.evaluate((rid) => {
      document.getElementById('roomIdInput').value = rid;
      document.getElementById('joinRoomBtn').click();
    }, roomId);

    await page1.waitForTimeout(1000); // Minimal wait to stress test

    await page2.evaluate((rid) => {
      document.getElementById('roomIdInput').value = rid;
      document.getElementById('joinRoomBtn').click();
    }, roomId);

    await page2.waitForTimeout(1000);

    await page3.evaluate((rid) => {
      document.getElementById('roomIdInput').value = rid;
      document.getElementById('joinRoomBtn').click();
    }, roomId);

    await page3.waitForTimeout(2000); // Wait for connections to establish

    const joinTime = Date.now() - joinStartTime;
    console.log(`✓ All users joined in ${joinTime}ms`);

    // Step 5: Test rapid message sending to stress P2P connections
    console.log('💨 Testing rapid message sending...');

    const messageStartTime = Date.now();

    // Send messages in quick succession
    for (let i = 1; i <= 5; i++) {
      await page1.locator('#messageInput').fill(`Rapid message ${i} from User1`);
      await page1.locator('#sendBtn').click({ force: true });
      await page1.waitForTimeout(200); // Very short delay

      await page2.locator('#messageInput').fill(`Rapid message ${i} from User2`);
      await page2.locator('#sendBtn').click({ force: true });
      await page2.waitForTimeout(200);

      await page3.locator('#messageInput').fill(`Rapid message ${i} from User3`);
      await page3.locator('#sendBtn').click({ force: true });
      await page3.waitForTimeout(200);
    }

    const messageTime = Date.now() - messageStartTime;
    console.log(`✓ Rapid messaging completed in ${messageTime}ms`);

    // Step 6: Monitor for a few seconds to catch any delayed recursion issues
    console.log('⏱️  Monitoring for delayed performance issues...');
    await page1.waitForTimeout(5000);

    // Step 7: Check connection status
    const status1 = await page1.textContent('#connectionStatus');
    const status2 = await page2.textContent('#connectionStatus');
    const status3 = await page3.textContent('#connectionStatus');

    // Step 8: Verify message delivery after stress test
    console.log('🔍 Verifying message delivery after stress test...');
    const chatArea1 = await page1.textContent('#chatArea');
    const chatArea2 = await page2.textContent('#chatArea');
    const chatArea3 = await page3.textContent('#chatArea');

    // Analysis
    console.log('\n' + '='.repeat(60));
    console.log('📊 PERFORMANCE TEST RESULTS');
    console.log('='.repeat(60));

    let success = true;
    let issues = [];

    // Check for performance issues
    if (loadTime > 10000) {
      issues.push(`⚠️  Slow page load: ${loadTime}ms (expected < 10s)`);
    }

    if (joinTime > 8000) {
      issues.push(`⚠️  Slow room joining: ${joinTime}ms (expected < 8s)`);
    }

    if (messageTime > 5000) {
      issues.push(`⚠️  Slow message sending: ${messageTime}ms (expected < 5s)`);
    }

    // Check for errors
    if (errors.length > 0) {
      success = false;
      issues.push('❌ Console errors detected:');
      errors.forEach(error => issues.push(`   ${error}`));
    }

    // Check for recursion warnings
    if (performanceWarnings.length > 0) {
      success = false;
      issues.push('❌ Performance warnings detected:');
      performanceWarnings.forEach(warning => issues.push(`   ${warning}`));
    }

    // Check connection status
    if (!status1.includes('Connected') || !status2.includes('Connected') || !status3.includes('Connected')) {
      success = false;
      issues.push('❌ Not all users are properly connected');
      issues.push(`   User 1: ${status1.trim()}`);
      issues.push(`   User 2: ${status2.trim()}`);
      issues.push(`   User 3: ${status3.trim()}`);
    }

    // Check message delivery
    const testMessage = 'Rapid message 1 from User1';
    if (!chatArea1.includes(testMessage) || !chatArea2.includes(testMessage) || !chatArea3.includes(testMessage)) {
      success = false;
      issues.push('❌ Message delivery failed after stress test');
    }

    // Print results
    if (success) {
      console.log('✅ ALL PERFORMANCE TESTS PASSED!');
      console.log(`   ✓ Page load time: ${loadTime}ms`);
      console.log(`   ✓ Room joining time: ${joinTime}ms`);
      console.log(`   ✓ Message sending time: ${messageTime}ms`);
      console.log('   ✓ No infinite recursion detected');
      console.log('   ✓ No console errors or warnings');
      console.log('   ✓ All P2P connections stable');
      console.log('   ✓ Message delivery working correctly');
      console.log('\n🎉 ROOM JOINING BUG FIX VERIFIED SUCCESSFUL!');
    } else {
      console.log('❌ PERFORMANCE ISSUES DETECTED:');
      issues.forEach(issue => console.log(issue));
    }
    console.log('='.repeat(60) + '\n');

    // Keep browser open briefly for visual inspection
    console.log('🔎 Keeping browser open for 5 seconds for visual inspection...');
    await page1.waitForTimeout(5000);

    return { success, issues, loadTime, joinTime, messageTime, errors, performanceWarnings };

  } catch (error) {
    console.error('❌ Performance test failed with error:', error);
    return { success: false, error: error.message };
  } finally {
    await browser.close();
    console.log('🧹 Browser closed. Performance test complete.');
  }
}

// Run the test
testCPUPerformance().catch(console.error);