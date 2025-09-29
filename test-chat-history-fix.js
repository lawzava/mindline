/**
 * Test script for chat history sync fix
 * Tests multi-user chat history synchronization
 */

const { chromium } = require('playwright');

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function test() {
  console.log('🧪 Starting chat history sync test...\n');

  const browser = await chromium.launch({ headless: false });

  try {
    // Create 3 isolated browser contexts (simulating 3 different users)
    console.log('👥 Creating 3 user contexts...');
    const context1 = await browser.newContext({ storageState: undefined });
    const context2 = await browser.newContext({ storageState: undefined });
    const context3 = await browser.newContext({ storageState: undefined });

    const page1 = await context1.newPage();
    const page2 = await context2.newPage();
    const page3 = await context3.newPage();

    const roomId = 'test-sync-' + Date.now();
    console.log(`🏠 Test room ID: ${roomId}\n`);

    // Navigate all users to the app
    console.log('🌐 Loading app for all users...');
    await Promise.all([
      page1.goto('http://localhost:8080'),
      page2.goto('http://localhost:8080'),
      page3.goto('http://localhost:8080')
    ]);

    await sleep(3000);

    // Note: Skipping username setting as the field is in collapsed header
    // Users will have default "Anonymous" names with unique IDs
    console.log('✏️  Using default usernames (Anonymous with unique IDs)...');

    // User 1 (Alice) creates room
    console.log(`\n👤 Alice: Creating room "${roomId}"...`);
    await page1.fill('input[placeholder="Enter room ID (min 8 chars)"]', roomId);
    await page1.click('button:has-text("JOIN")');
    await sleep(2000);

    // Check Alice's connection status
    const aliceStatus = await page1.textContent('.status-indicator');
    console.log(`   ✓ Alice status: ${aliceStatus}`);

    // User 2 (Bob) joins room
    console.log(`\n👤 Bob: Joining room "${roomId}"...`);
    await page2.fill('input[placeholder="Enter room ID (min 8 chars)"]', roomId);
    await page2.click('button:has-text("JOIN")');
    await sleep(3000); // Wait for P2P connection

    const bobStatus = await page2.textContent('.status-indicator');
    console.log(`   ✓ Bob status: ${bobStatus}`);

    // User 3 (Charlie) joins room
    console.log(`\n👤 Charlie: Joining room "${roomId}"...`);
    await page3.fill('input[placeholder="Enter room ID (min 8 chars)"]', roomId);
    await page3.click('button:has-text("JOIN")');
    await sleep(3000); // Wait for P2P connection

    const charlieStatus = await page3.textContent('.status-indicator');
    console.log(`   ✓ Charlie status: ${charlieStatus}`);

    console.log('\n📝 Testing message synchronization...\n');

    // Alice sends first message
    console.log('👤 Alice: Sending message "Hello from Alice!"');
    await page1.fill('textarea[placeholder="Others see this as you type..."]', 'Hello from Alice!');
    await page1.press('textarea[placeholder="Others see this as you type..."]', 'Enter');
    await sleep(2000);

    // Bob sends second message
    console.log('👤 Bob: Sending message "Hi Alice, Bob here!"');
    await page2.fill('textarea[placeholder="Others see this as you type..."]', 'Hi Alice, Bob here!');
    await page2.press('textarea[placeholder="Others see this as you type..."]', 'Enter');
    await sleep(2000);

    // Charlie sends third message
    console.log('👤 Charlie: Sending message "Charlie joining the chat!"');
    await page3.fill('textarea[placeholder="Others see this as you type..."]', 'Charlie joining the chat!');
    await page3.press('textarea[placeholder="Others see this as you type..."]', 'Enter');
    await sleep(2000);

    // Check message history on all pages
    console.log('\n🔍 Verifying message history on all users...\n');

    const getMessages = async (page) => {
      return await page.evaluate(() => {
        const messages = Array.from(document.querySelectorAll('.message-container'));
        return messages.map(m => {
          const sender = m.querySelector('.message-sender')?.textContent || 'Unknown';
          const content = m.querySelector('.message-content')?.textContent || '';
          return { sender, content: content.replace(/\s*\(edited\)\s*$/, '').trim() };
        });
      });
    };

    const aliceMessages = await getMessages(page1);
    const bobMessages = await getMessages(page2);
    const charlieMessages = await getMessages(page3);

    console.log('👤 Alice sees:');
    aliceMessages.forEach((m, i) => console.log(`   ${i + 1}. [${m.sender}]: ${m.content}`));

    console.log('\n👤 Bob sees:');
    bobMessages.forEach((m, i) => console.log(`   ${i + 1}. [${m.sender}]: ${m.content}`));

    console.log('\n👤 Charlie sees:');
    charlieMessages.forEach((m, i) => console.log(`   ${i + 1}. [${m.sender}]: ${m.content}`));

    // Verify all users see the same messages
    console.log('\n✅ Verification Results:');

    const allSeeThreeMessages = aliceMessages.length === 3 && bobMessages.length === 3 && charlieMessages.length === 3;
    console.log(`   ${allSeeThreeMessages ? '✓' : '✗'} All users see 3 messages (Alice: ${aliceMessages.length}, Bob: ${bobMessages.length}, Charlie: ${charlieMessages.length})`);

    const expectedContents = [
      'Hello from Alice!',
      'Hi Alice, Bob here!',
      'Charlie joining the chat!'
    ];

    let allCorrect = true;
    for (let i = 0; i < 3; i++) {
      const aliceMatch = aliceMessages[i]?.content === expectedContents[i];
      const bobMatch = bobMessages[i]?.content === expectedContents[i];
      const charlieMatch = charlieMessages[i]?.content === expectedContents[i];

      const messageCorrect = aliceMatch && bobMatch && charlieMatch;
      console.log(`   ${messageCorrect ? '✓' : '✗'} Message ${i + 1} correct on all users: "${expectedContents[i]}"`);
      allCorrect = allCorrect && messageCorrect;
    }

    // Test persistence: reload Bob's page and check if messages persist
    console.log('\n🔄 Testing persistence: Reloading Bob\'s page...');
    await page2.reload();
    await sleep(3000);

    const bobMessagesAfterReload = await getMessages(page2);
    console.log(`   ${bobMessagesAfterReload.length === 3 ? '✓' : '✗'} Bob sees ${bobMessagesAfterReload.length} messages after reload (expected 3)`);

    if (bobMessagesAfterReload.length === 3) {
      console.log('   Messages after reload:');
      bobMessagesAfterReload.forEach((m, i) => console.log(`      ${i + 1}. [${m.sender}]: ${m.content}`));
    }

    // Final result
    console.log('\n' + '='.repeat(60));
    if (allSeeThreeMessages && allCorrect && bobMessagesAfterReload.length === 3) {
      console.log('✅ TEST PASSED: Chat history sync is working correctly!');
      console.log('   - All users receive messages in real-time');
      console.log('   - Messages are synchronized correctly');
      console.log('   - Messages persist after page reload');
    } else {
      console.log('❌ TEST FAILED: Issues detected with chat history sync');
      if (!allSeeThreeMessages) {
        console.log('   - Not all users are seeing all messages');
      }
      if (!allCorrect) {
        console.log('   - Message content or order is incorrect');
      }
      if (bobMessagesAfterReload.length !== 3) {
        console.log('   - Messages not persisting after reload');
      }
    }
    console.log('='.repeat(60) + '\n');

    // Keep browser open for manual inspection
    console.log('🔍 Browser windows left open for manual inspection.');
    console.log('   Press Ctrl+C to close and exit.\n');

    // Wait indefinitely
    await new Promise(() => {});

  } catch (error) {
    console.error('❌ Test failed with error:', error);
    await browser.close();
    process.exit(1);
  }
}

// Run the test
test().catch(console.error);