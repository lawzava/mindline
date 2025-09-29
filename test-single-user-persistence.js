// Test single user message persistence
const { chromium } = require('playwright');

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function test() {
  console.log('🧪 SINGLE USER PERSISTENCE TEST\n');
  console.log('=' .repeat(50));

  const browser = await chromium.launch({ headless: true });

  try {
    const roomId = `persist-${Date.now()}`;
    console.log(`📝 Room ID: ${roomId}\n`);

    // ============= TEST 1: Send Messages =============
    console.log('TEST 1: User sends messages');
    console.log('-'.repeat(40));

    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto('http://localhost:8080');
    await sleep(2000);

    // Expand rooms section
    await page.evaluate(() => {
      const roomsHeader = document.getElementById('roomsHeader');
      if (roomsHeader) roomsHeader.click();
    });
    await sleep(500);

    // Join room
    await page.fill('#roomIdInput', roomId);
    await page.click('#joinRoomBtn');
    await sleep(2000);

    // Send messages
    await page.fill('#messageInput', 'First message');
    await page.evaluate(() => window.sendMessage && window.sendMessage());
    await sleep(500);

    await page.fill('#messageInput', 'Second message');
    await page.evaluate(() => window.sendMessage && window.sendMessage());
    await sleep(500);

    await page.fill('#messageInput', 'Third message');
    await page.evaluate(() => window.sendMessage && window.sendMessage());
    await sleep(500);

    const messageCount1 = await page.locator('.neo-message-bubble').count();
    console.log(`✅ Sent ${messageCount1} messages`);

    const test1Pass = messageCount1 >= 3;
    console.log(test1Pass ? '✅ PASS\n' : '❌ FAIL\n');

    // ============= TEST 2: Reload and Check =============
    console.log('TEST 2: Persistence after reload');
    console.log('-'.repeat(40));

    await page.reload();
    await sleep(2000);

    // Expand rooms section
    await page.evaluate(() => {
      const roomsHeader = document.getElementById('roomsHeader');
      if (roomsHeader) roomsHeader.click();
    });
    await sleep(500);

    // Rejoin same room
    await page.fill('#roomIdInput', roomId);
    await page.click('#joinRoomBtn');
    await sleep(2000);

    const messageCount2 = await page.locator('.neo-message-bubble').count();
    console.log(`📊 After reload: ${messageCount2} messages`);

    const test2Pass = messageCount2 >= 3;
    console.log(test2Pass ? '✅ PASS\n' : '❌ FAIL\n');

    // ============= TEST 3: New Session =============
    console.log('TEST 3: Persistence in new browser session');
    console.log('-'.repeat(40));

    // Get storage state before closing
    const storageState = await context.storageState();

    await page.close();
    await context.close();

    // Create new context with same storage state
    // Note: In real usage, localStorage would persist, but in test contexts it doesn't
    const context2 = await browser.newContext({ storageState });
    const page2 = await context2.newPage();

    await page2.goto('http://localhost:8080');
    await sleep(2000);

    // Expand rooms section
    await page2.evaluate(() => {
      const roomsHeader = document.getElementById('roomsHeader');
      if (roomsHeader) roomsHeader.click();
    });
    await sleep(500);

    // Join same room
    await page2.fill('#roomIdInput', roomId);
    await page2.click('#joinRoomBtn');
    await sleep(2000);

    const messageCount3 = await page2.locator('.neo-message-bubble').count();
    console.log(`📊 New session: ${messageCount3} messages`);

    const test3Pass = messageCount3 >= 3;
    console.log(test3Pass ? '✅ PASS\n' : '❌ FAIL\n');

    // ============= TEST 4: Add More Messages =============
    console.log('TEST 4: Add messages and check total');
    console.log('-'.repeat(40));

    await page2.fill('#messageInput', 'Fourth message');
    await page2.evaluate(() => window.sendMessage && window.sendMessage());
    await sleep(500);

    const messageCount4 = await page2.locator('.neo-message-bubble').count();
    console.log(`📊 After adding: ${messageCount4} messages`);

    const test4Pass = messageCount4 >= 4;
    console.log(test4Pass ? '✅ PASS\n' : '❌ FAIL\n');

    // ============= RESULTS =============
    console.log('=' .repeat(50));
    console.log('FINAL RESULTS:');
    console.log('=' .repeat(50));

    const results = [
      { name: 'Initial Send', pass: test1Pass },
      { name: 'After Reload', pass: test2Pass },
      { name: 'New Session', pass: test3Pass },
      { name: 'Add More', pass: test4Pass }
    ];

    let passCount = 0;
    results.forEach(r => {
      console.log(`${r.pass ? '✅' : '❌'} ${r.name}`);
      if (r.pass) passCount++;
    });

    console.log(`\n📊 Score: ${passCount}/4 tests passed`);

    if (passCount === 4) {
      console.log('🎉 PERFECT! Single user persistence works flawlessly!');
    } else if (passCount >= 3) {
      console.log('✅ GOOD: Most persistence features work');
    } else {
      console.log('❌ NEEDS WORK: Persistence has issues');
    }

  } catch (error) {
    console.error('Test error:', error);
  } finally {
    await browser.close();
  }
}

test().catch(console.error);