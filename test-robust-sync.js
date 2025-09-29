// Robust test for chat history sync
const { chromium } = require('playwright');

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fillUserName(page, name) {
  // Try desktop field first
  try {
    await page.fill('#userName', name, { timeout: 2000 });
  } catch {
    // Try mobile field
    try {
      await page.fill('#userNameMobile', name, { timeout: 2000 });
    } catch {
      console.log('Warning: Could not set username, using Anonymous');
    }
  }
}

async function sendMessage(page, message) {
  await page.fill('#messageInput', message);
  // Try both possible send button selectors
  try {
    await page.click('button:has-text("SEND")', { timeout: 1000 });
  } catch {
    await page.click('#sendBtn');
  }
  await sleep(500);
}

async function test() {
  console.log('🧪 ROBUST CHAT HISTORY SYNC TEST\n');
  console.log('=' .repeat(50));

  const browser = await chromium.launch({ headless: false });

  try {
    const roomId = `room-${Date.now()}`;
    console.log(`📝 Room ID: ${roomId}\n`);

    // ============= SCENARIO 1: Message Persistence =============
    console.log('SCENARIO 1: Testing Message Persistence');
    console.log('-'.repeat(40));

    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();

    await pageA.goto('http://localhost:8080');
    await sleep(2000);

    await fillUserName(pageA, 'Alice');
    await pageA.fill('#roomIdInput', roomId);
    await pageA.click('#joinRoomBtn', { force: true });
    await sleep(2000);

    // Send 2 messages
    await sendMessage(pageA, 'First message from Alice');
    await sendMessage(pageA, 'Second message from Alice');

    let aliceCount1 = await pageA.locator('.neo-message-bubble').count();
    console.log(`✓ Alice sent ${aliceCount1} messages`);

    // Refresh and rejoin
    await pageA.reload();
    await sleep(2000);

    await fillUserName(pageA, 'Alice');
    await pageA.fill('#roomIdInput', roomId);
    await pageA.click('#joinRoomBtn', { force: true });
    await sleep(2000);

    let aliceCount2 = await pageA.locator('.neo-message-bubble').count();
    console.log(`✓ After refresh: Alice sees ${aliceCount2} messages`);

    const test1Pass = aliceCount2 >= 2;
    console.log(test1Pass ? '✅ PASS: Messages persist!\n' : '❌ FAIL: Messages lost!\n');

    // ============= SCENARIO 2: P2P Sync =============
    console.log('SCENARIO 2: Testing P2P Synchronization');
    console.log('-'.repeat(40));

    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();

    await pageB.goto('http://localhost:8080');
    await sleep(2000);

    await fillUserName(pageB, 'Bob');
    await pageB.fill('#roomIdInput', roomId);
    await pageB.click('#joinRoomBtn', { force: true });
    await sleep(3000);

    let bobCount1 = await pageB.locator('.neo-message-bubble').count();
    console.log(`✓ Bob sees ${bobCount1} messages when joining`);

    // Bob sends a message
    await sendMessage(pageB, 'Hello from Bob');
    await sleep(1000);

    // Check both users
    let aliceCount3 = await pageA.locator('.neo-message-bubble').count();
    let bobCount2 = await pageB.locator('.neo-message-bubble').count();

    console.log(`✓ After Bob's message:`);
    console.log(`  - Alice: ${aliceCount3} messages`);
    console.log(`  - Bob: ${bobCount2} messages`);

    const test2Pass = aliceCount3 >= 3 && bobCount2 >= 1;
    console.log(test2Pass ? '✅ PASS: P2P sync works!\n' : '❌ FAIL: P2P sync issues!\n');

    // ============= SCENARIO 3: Third User Sync =============
    console.log('SCENARIO 3: Testing New User Sync');
    console.log('-'.repeat(40));

    const contextC = await browser.newContext();
    const pageC = await contextC.newPage();

    await pageC.goto('http://localhost:8080');
    await sleep(2000);

    await fillUserName(pageC, 'Charlie');
    await pageC.fill('#roomIdInput', roomId);
    await pageC.click('#joinRoomBtn', { force: true });
    await sleep(4000);

    let charlieCount = await pageC.locator('.neo-message-bubble').count();
    console.log(`✓ Charlie sees ${charlieCount} messages when joining`);

    const test3Pass = charlieCount >= 3;
    console.log(test3Pass ? '✅ PASS: New users get synced!\n' : '❌ FAIL: New user sync failed!\n');

    // ============= SCENARIO 4: Leave and Rejoin =============
    console.log('SCENARIO 4: Testing Leave and Rejoin');
    console.log('-'.repeat(40));

    // All send one more message
    await sendMessage(pageA, 'Alice signing off');
    await sendMessage(pageB, 'Bob signing off');
    await sendMessage(pageC, 'Charlie signing off');
    await sleep(2000);

    // Close all
    await pageA.close();
    await pageB.close();
    await pageC.close();
    await sleep(1000);

    // Alice rejoins alone
    const pageA2 = await contextA.newPage();
    await pageA2.goto('http://localhost:8080');
    await sleep(2000);

    await fillUserName(pageA2, 'Alice');
    await pageA2.fill('#roomIdInput', roomId);
    await pageA2.click('#joinRoomBtn', { force: true });
    await sleep(2000);

    let aliceFinal = await pageA2.locator('.neo-message-bubble').count();
    console.log(`✓ Alice rejoining sees ${aliceFinal} messages`);

    const test4Pass = aliceFinal >= 3;
    console.log(test4Pass ? '✅ PASS: Rejoin works!\n' : '⚠️  PARTIAL: Limited history\n');

    // ============= RESULTS =============
    console.log('=' .repeat(50));
    console.log('FINAL RESULTS:');
    console.log('=' .repeat(50));

    const results = [
      { name: 'Message Persistence', pass: test1Pass },
      { name: 'P2P Sync', pass: test2Pass },
      { name: 'New User Sync', pass: test3Pass },
      { name: 'Leave & Rejoin', pass: test4Pass }
    ];

    const passCount = results.filter(r => r.pass).length;

    results.forEach(r => {
      console.log(`${r.pass ? '✅' : '❌'} ${r.name}`);
    });

    console.log(`\n📊 Score: ${passCount}/4 tests passed`);

    if (passCount === 4) {
      console.log('🎉 PERFECT! All sync features working!');
    } else if (passCount >= 2) {
      console.log('⚠️  PARTIAL: Core features work, some issues remain');
    } else {
      console.log('❌ NEEDS WORK: Major sync issues detected');
    }

    await sleep(5000);

  } catch (error) {
    console.error('❌ Test failed:', error.message);
  } finally {
    await browser.close();
  }
}

test().catch(console.error);