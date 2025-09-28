// Test multi-user chat functionality
const { chromium } = require('@playwright/test');

async function testMultiUserChat() {
  console.log('Starting multi-user chat test...');

  // Launch browser contexts
  const browser = await chromium.launch({
    headless: false,
    slowMo: 500 // Slow down actions for visibility
  });

  try {
    // Create three separate browser contexts (simulating 3 users)
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();
    const context3 = await browser.newContext();

    // Create pages for each user
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();
    const page3 = await context3.newPage();

    // Navigate all users to the application
    const appUrl = 'http://localhost:8080';
    await page1.goto(appUrl);
    await page2.goto(appUrl);
    await page3.goto(appUrl);

    // Wait for app to load
    await page1.waitForTimeout(2000);
    await page2.waitForTimeout(2000);
    await page3.waitForTimeout(2000);

    // Set usernames for each user
    console.log('Setting usernames...');
    await page1.fill('#userName', 'Alice');
    await page2.fill('#userName', 'Bob');
    await page3.fill('#userName', 'Charlie');

    // Wait for initialization
    await page1.waitForTimeout(1000);
    await page2.waitForTimeout(1000);
    await page3.waitForTimeout(1000);

    // Create a test room ID
    const roomId = `test-room-${Date.now()}`;
    console.log(`Test room ID: ${roomId}`);

    // Have all users join the same room
    console.log('All users joining room...');
    await page1.fill('#roomIdInput', roomId);
    await page1.click('#joinRoomBtn');

    await page2.fill('#roomIdInput', roomId);
    await page2.click('#joinRoomBtn');

    await page3.fill('#roomIdInput', roomId);
    await page3.click('#joinRoomBtn');

    // Wait for P2P connections to establish
    console.log('Waiting for P2P connections...');
    await page1.waitForTimeout(3000);

    // Test 1: Alice sends a message
    console.log('Test 1: Alice sending message...');
    await page1.fill('#messageInput', 'Hello from Alice!');
    await page1.click('#sendBtn');

    // Wait and check if Bob and Charlie received it
    await page2.waitForTimeout(2000);
    await page3.waitForTimeout(2000);

    const bobMessages = await page2.evaluate(() => {
      const messages = document.querySelectorAll('.chat-message');
      return Array.from(messages).map(m => m.textContent);
    });
    console.log('Bob sees messages:', bobMessages);

    // Test 2: Bob sends a message
    console.log('Test 2: Bob sending message...');
    await page2.fill('#messageInput', 'Hi Alice! This is Bob.');
    await page2.click('#sendBtn');

    await page1.waitForTimeout(2000);
    await page3.waitForTimeout(2000);

    // Test 3: Charlie sends a message
    console.log('Test 3: Charlie sending message...');
    await page3.fill('#messageInput', 'Hey everyone! Charlie here.');
    await page3.click('#sendBtn');

    await page1.waitForTimeout(2000);
    await page2.waitForTimeout(2000);

    // Test 4: Check typing indicators
    console.log('Test 4: Testing typing indicators...');
    await page1.fill('#messageInput', 'Typing test...');
    await page1.waitForTimeout(1000);

    // Check if typing indicator appears for other users
    const bobSeesTyping = await page2.evaluate(() => {
      const drafts = document.querySelector('.peer-drafts');
      return drafts ? drafts.textContent : 'No typing indicator';
    });
    console.log('Bob sees typing:', bobSeesTyping);

    // Send the message
    await page1.click('#sendBtn');

    // Final check: Count messages for each user
    await page1.waitForTimeout(2000);

    const aliceMessageCount = await page1.evaluate(() => {
      return document.querySelectorAll('.chat-message').length;
    });

    const bobMessageCount = await page2.evaluate(() => {
      return document.querySelectorAll('.chat-message').length;
    });

    const charlieMessageCount = await page3.evaluate(() => {
      return document.querySelectorAll('.chat-message').length;
    });

    console.log('\n=== Test Results ===');
    console.log(`Alice sees ${aliceMessageCount} messages`);
    console.log(`Bob sees ${bobMessageCount} messages`);
    console.log(`Charlie sees ${charlieMessageCount} messages`);

    // All users should see 4 messages (3 initial + 1 typing test)
    const testPassed = aliceMessageCount === 4 && bobMessageCount === 4 && charlieMessageCount === 4;

    if (testPassed) {
      console.log('\n✅ TEST PASSED: All users can send and receive messages!');
    } else {
      console.log('\n❌ TEST FAILED: Message counts do not match');
    }

    // Keep browsers open for manual inspection
    console.log('\nKeeping browsers open for 10 seconds for inspection...');
    await page1.waitForTimeout(10000);

  } catch (error) {
    console.error('Test error:', error);
  } finally {
    await browser.close();
  }
}

// Run the test
testMultiUserChat().catch(console.error);