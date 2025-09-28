/**
 * Multi-User Chat Test
 * Tests 3 users chatting in the same room
 */

const { chromium } = require('playwright');

async function testMultiUserChat() {
  console.log('🧪 Starting Multi-User Chat Test...\n');

  const browser = await chromium.launch({ headless: false });

  // Create 3 separate browser contexts (simulating 3 different users)
  // Use desktop viewport (>= 768px for md breakpoint) to ensure all elements are visible
  const context1 = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const context2 = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const context3 = await browser.newContext({ viewport: { width: 1400, height: 900 } });

  const page1 = await context1.newPage();
  const page2 = await context2.newPage();
  const page3 = await context3.newPage();

  const roomId = `test-room-${Date.now()}`;
  const testUrl = `http://localhost:8080`;

  console.log(`📝 Test Room ID: ${roomId}\n`);

  try {
    // Step 1: Load all 3 pages
    console.log('🌐 Loading pages for 3 users...');
    await Promise.all([
      page1.goto(testUrl),
      page2.goto(testUrl),
      page3.goto(testUrl)
    ]);

    // Wait for WASM to load
    await page1.waitForTimeout(2000);
    await page2.waitForTimeout(2000);
    await page3.waitForTimeout(2000);

    // Step 2: Set usernames
    console.log('👤 Setting usernames...');
    await page1.locator('#userName').fill('Alice', { force: true });
    await page2.locator('#userName').fill('Bob', { force: true });
    await page3.locator('#userName').fill('Charlie', { force: true });

    // Step 3: Expand rooms section for all users
    console.log('🏠 Opening rooms section...');
    await page1.click('#roomsHeader');
    await page2.click('#roomsHeader');
    await page3.click('#roomsHeader');

    await page1.waitForTimeout(500);
    await page2.waitForTimeout(500);
    await page3.waitForTimeout(500);

    // Step 4: Join the same room
    console.log(`🚪 Joining room: ${roomId}...`);

    // User 1 joins first
    await page1.evaluate((rid) => {
      document.getElementById('roomIdInput').value = rid;
      document.getElementById('joinRoomBtn').click();
    }, roomId);
    await page1.waitForTimeout(2000); // Wait for P2P setup

    // User 2 joins
    await page2.evaluate((rid) => {
      document.getElementById('roomIdInput').value = rid;
      document.getElementById('joinRoomBtn').click();
    }, roomId);
    await page2.waitForTimeout(2000); // Wait for P2P setup

    // User 3 joins
    await page3.evaluate((rid) => {
      document.getElementById('roomIdInput').value = rid;
      document.getElementById('joinRoomBtn').click();
    }, roomId);
    await page3.waitForTimeout(3000); // Wait for all peers to connect

    console.log('✅ All users joined the room\n');

    // Step 5: Send messages from each user
    console.log('💬 Testing message sending...\n');

    // Alice sends a message
    console.log('  📤 Alice: "Hello everyone!"');
    await page1.locator('#messageInput').fill('Hello everyone!');
    await page1.locator('#sendBtn').click({ force: true });
    await page1.waitForTimeout(1000);

    // Bob sends a message
    console.log('  📤 Bob: "Hi Alice! How are you?"');
    await page2.locator('#messageInput').fill('Hi Alice! How are you?');
    await page2.locator('#sendBtn').click({ force: true });
    await page2.waitForTimeout(1000);

    // Charlie sends a message
    console.log('  📤 Charlie: "Hey guys, good to see you!"');
    await page3.locator('#messageInput').fill('Hey guys, good to see you!');
    await page3.locator('#sendBtn').click({ force: true });
    await page3.waitForTimeout(2000);

    // Step 6: Test typing indicators
    console.log('\n⌨️  Testing typing indicators...');
    await page1.locator('#messageInput').fill('Alice is typing...');
    await page1.waitForTimeout(1000);
    await page1.locator('#messageInput').fill(''); // Clear typing
    await page1.waitForTimeout(500);

    // Step 7: Verify messages in chat area
    console.log('\n🔍 Verifying message delivery...');

    const chatArea1 = await page1.textContent('#chatArea');
    const chatArea2 = await page2.textContent('#chatArea');
    const chatArea3 = await page3.textContent('#chatArea');

    let success = true;
    let errors = [];

    // Check if messages are visible
    if (!chatArea1.includes('Hello everyone!')) {
      errors.push('❌ User 1 (Alice) did not receive Alice\'s message');
      success = false;
    }
    if (!chatArea2.includes('Hello everyone!')) {
      errors.push('❌ User 2 (Bob) did not receive Alice\'s message');
      success = false;
    }
    if (!chatArea3.includes('Hello everyone!')) {
      errors.push('❌ User 3 (Charlie) did not receive Alice\'s message');
      success = false;
    }

    if (!chatArea1.includes('Hi Alice! How are you?') || !chatArea2.includes('Hi Alice! How are you?') || !chatArea3.includes('Hi Alice! How are you?')) {
      errors.push('❌ Not all users received Bob\'s message');
      success = false;
    }

    if (!chatArea1.includes('Hey guys, good to see you!') || !chatArea2.includes('Hey guys, good to see you!') || !chatArea3.includes('Hey guys, good to see you!')) {
      errors.push('❌ Not all users received Charlie\'s message');
      success = false;
    }

    // Check connection status
    const status1 = await page1.textContent('#connectionStatus');
    const status2 = await page2.textContent('#connectionStatus');
    const status3 = await page3.textContent('#connectionStatus');

    console.log(`  User 1 Status: ${status1.trim()}`);
    console.log(`  User 2 Status: ${status2.trim()}`);
    console.log(`  User 3 Status: ${status3.trim()}`);

    // Print results
    console.log('\n' + '='.repeat(50));
    if (success) {
      console.log('✅ ALL TESTS PASSED!');
      console.log('   ✓ 3 users successfully joined the same room');
      console.log('   ✓ All messages were delivered to all users');
      console.log('   ✓ P2P connections are working correctly');
    } else {
      console.log('❌ SOME TESTS FAILED:');
      errors.forEach(err => console.log('   ' + err));
    }
    console.log('='.repeat(50) + '\n');

    // Keep browser open for 10 seconds to observe
    console.log('🔎 Keeping browser open for 10 seconds for visual inspection...');
    await page1.waitForTimeout(10000);

  } catch (error) {
    console.error('❌ Test failed with error:', error);
  } finally {
    await browser.close();
    console.log('🧹 Browser closed. Test complete.');
  }
}

// Run the test
testMultiUserChat().catch(console.error);