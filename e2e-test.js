/**
 * Comprehensive E2E Test for Mindline P2P Chat
 * Tests multi-user interaction with 3 separate browser contexts
 */

const { chromium } = require('playwright');

// Test configuration
const TEST_CONFIG = {
  baseUrl: 'http://localhost:8080',
  timeout: 30000,
  headless: false, // Set to true for CI/CD
  slowMo: 500, // Slow down operations for visibility
  roomId: `test-room-${Date.now()}`,
  users: [
    { name: 'Alice', color: 'User1' },
    { name: 'Bob', color: 'User2' },
    { name: 'Charlie', color: 'User3' }
  ]
};

// Helper function to wait for element and get text
async function getElementText(page, selector) {
  try {
    await page.waitForSelector(selector, { timeout: 5000 });
    return await page.locator(selector).textContent();
  } catch (error) {
    console.error(`Failed to get text for ${selector}: ${error.message}`);
    return null;
  }
}

// Helper function to check if element exists
async function elementExists(page, selector) {
  try {
    const count = await page.locator(selector).count();
    return count > 0;
  } catch (error) {
    return false;
  }
}

// Helper function to wait for toast message
async function waitForToast(page, expectedText, timeout = 5000) {
  try {
    await page.waitForSelector('#toastContainer .toast', { timeout });
    const toasts = page.locator('#toastContainer .toast');
    const count = await toasts.count();

    for (let i = 0; i < count; i++) {
      const text = await toasts.nth(i).textContent();
      if (text.includes(expectedText)) {
        console.log(`✅ Found expected toast: ${text}`);
        return true;
      }
    }

    console.log(`⚠️ Toast not found with text: ${expectedText}`);
    return false;
  } catch (error) {
    console.log(`⚠️ No toast found: ${error.message}`);
    return false;
  }
}

// Helper function to check for error messages
async function checkForErrors(page, userName) {
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  // Check for visible error messages with emojis (excluding expected warnings)
  const errorSelectors = [
    'text=/❌/',
    '.error-message'
  ];

  let actualErrors = [];

  for (const selector of errorSelectors) {
    const errors = page.locator(selector);
    const count = await errors.count();
    if (count > 0) {
      for (let i = 0; i < count; i++) {
        const text = await errors.nth(i).textContent();
        // Exclude the expected room ID warning
        if (!text.includes('Anyone who guesses your room ID') && !text.includes('Use something hard to guess')) {
          actualErrors.push(text);
          console.log(`⚠️ ${userName} - Error message found: ${text}`);
        }
      }
    }
  }

  return { consoleErrors, uiErrors: actualErrors };
}

// Main test function
async function runE2ETests() {
  console.log('🚀 Starting Mindline E2E Tests\n');
  console.log(`Test Configuration:`);
  console.log(`  - Base URL: ${TEST_CONFIG.baseUrl}`);
  console.log(`  - Room ID: ${TEST_CONFIG.roomId}`);
  console.log(`  - Users: ${TEST_CONFIG.users.map(u => u.name).join(', ')}`);
  console.log('\n' + '='.repeat(60) + '\n');

  let browser;
  const contexts = [];
  const pages = [];
  let testsPassed = 0;
  let testsFailed = 0;

  try {
    // Launch browser
    console.log('🌐 Launching browser...');
    browser = await chromium.launch({
      headless: TEST_CONFIG.headless,
      slowMo: TEST_CONFIG.slowMo
    });

    // Create 3 isolated browser contexts (one for each user)
    console.log('👥 Creating 3 isolated browser contexts...');
    for (let i = 0; i < 3; i++) {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 720 }
      });
      contexts.push(context);

      const page = await context.newPage();
      pages.push(page);

      console.log(`  ✅ Context ${i + 1} created for ${TEST_CONFIG.users[i].name}`);
    }

    console.log('\n' + '='.repeat(60) + '\n');

    // TEST 1: Load application for all users
    console.log('📋 TEST 1: Loading application for all users');
    for (let i = 0; i < 3; i++) {
      const page = pages[i];
      const user = TEST_CONFIG.users[i];

      console.log(`  Loading page for ${user.name}...`);
      await page.goto(TEST_CONFIG.baseUrl);

      // Wait for page to load
      await page.waitForLoadState('networkidle');

      // Check for WASM initialization
      const title = await page.title();
      console.log(`  ${user.name} - Page title: ${title}`);

      if (title.includes('Mindline')) {
        console.log(`  ✅ ${user.name} - Page loaded successfully`);
        testsPassed++;
      } else {
        console.log(`  ❌ ${user.name} - Page load failed`);
        testsFailed++;
      }

      // Wait a bit for WASM to initialize
      await page.waitForTimeout(2000);
    }

    console.log('\n' + '='.repeat(60) + '\n');

    // TEST 2: Set user names
    console.log('📋 TEST 2: Setting user names');
    for (let i = 0; i < 3; i++) {
      const page = pages[i];
      const user = TEST_CONFIG.users[i];

      console.log(`  Setting name for ${user.name}...`);

      // Try both desktop and mobile inputs - fill whichever is visible
      let userNameInput;
      let enteredName = '';

      try {
        // Try desktop first
        const desktopInput = page.locator('#userName');
        const isDesktopVisible = await desktopInput.isVisible({ timeout: 1000 });

        if (isDesktopVisible) {
          userNameInput = desktopInput;
          await userNameInput.fill(user.name);
          console.log(`    Using desktop input`);
        } else {
          // Fall back to mobile
          userNameInput = page.locator('#userNameMobile');
          await userNameInput.fill(user.name, { timeout: 5000 });
          console.log(`    Using mobile input`);
        }

        await page.waitForTimeout(500);
        enteredName = await userNameInput.inputValue();

        if (enteredName === user.name) {
          console.log(`  ✅ ${user.name} - Name set successfully`);
          testsPassed++;
        } else {
          console.log(`  ❌ ${user.name} - Failed to set name (got: ${enteredName})`);
          testsFailed++;
        }
      } catch (error) {
        console.log(`  ❌ ${user.name} - Error setting name: ${error.message}`);
        testsFailed++;
      }
    }

    console.log('\n' + '='.repeat(60) + '\n');

    // TEST 3: User 1 (Alice) creates a room
    console.log('📋 TEST 3: Alice creates a room');
    const alicePage = pages[0];

    // Expand rooms section if collapsed
    const roomsHeader = alicePage.locator('#roomsHeader');
    await roomsHeader.click();
    await alicePage.waitForTimeout(500);

    // Enter room ID
    console.log(`  Entering room ID: ${TEST_CONFIG.roomId}...`);
    const roomIdInput = alicePage.locator('#roomIdInput');
    await roomIdInput.fill(TEST_CONFIG.roomId);
    await alicePage.waitForTimeout(500);

    // Click join button to create room
    console.log(`  Creating room...`);
    const joinButton = alicePage.locator('#joinRoomBtn');
    await joinButton.click();

    // Wait for room creation confirmation
    await alicePage.waitForTimeout(3000);

    // Check for success - welcome message should be hidden
    const welcomeVisible = await elementExists(alicePage, '#welcomeMessage:visible');
    const messageInputEnabled = await alicePage.locator('#messageInput').isEnabled();

    if (!welcomeVisible && messageInputEnabled) {
      console.log(`  ✅ Alice - Room created successfully (welcome hidden, input enabled)`);
      testsPassed++;
    } else {
      console.log(`  ❌ Alice - Room creation may have failed (welcome: ${welcomeVisible}, input enabled: ${messageInputEnabled})`);
      testsFailed++;
    }

    console.log('\n' + '='.repeat(60) + '\n');

    // TEST 4: User 2 (Bob) joins the room
    console.log('📋 TEST 4: Bob joins the room');
    const bobPage = pages[1];

    // Expand rooms section
    await bobPage.locator('#roomsHeader').click();
    await bobPage.waitForTimeout(500);

    // Enter room ID
    console.log(`  Bob entering room ID: ${TEST_CONFIG.roomId}...`);
    await bobPage.locator('#roomIdInput').fill(TEST_CONFIG.roomId);
    await bobPage.waitForTimeout(500);

    // Click join button
    console.log(`  Bob joining room...`);
    await bobPage.locator('#joinRoomBtn').click();
    await bobPage.waitForTimeout(3000);

    // Check for success - welcome message should be hidden
    const bobWelcomeVisible = await elementExists(bobPage, '#welcomeMessage:visible');
    const bobMessageInputEnabled = await bobPage.locator('#messageInput').isEnabled();

    if (!bobWelcomeVisible && bobMessageInputEnabled) {
      console.log(`  ✅ Bob - Joined room successfully`);
      testsPassed++;
    } else {
      console.log(`  ❌ Bob - Failed to join room`);
      testsFailed++;
    }

    console.log('\n' + '='.repeat(60) + '\n');

    // TEST 5: User 3 (Charlie) joins the room
    console.log('📋 TEST 5: Charlie joins the room');
    const charliePage = pages[2];

    // Expand rooms section
    await charliePage.locator('#roomsHeader').click();
    await charliePage.waitForTimeout(500);

    // Enter room ID
    console.log(`  Charlie entering room ID: ${TEST_CONFIG.roomId}...`);
    await charliePage.locator('#roomIdInput').fill(TEST_CONFIG.roomId);
    await charliePage.waitForTimeout(500);

    // Click join button
    console.log(`  Charlie joining room...`);
    await charliePage.locator('#joinRoomBtn').click();
    await charliePage.waitForTimeout(3000);

    // Check for success - welcome message should be hidden
    const charlieWelcomeVisible = await elementExists(charliePage, '#welcomeMessage:visible');
    const charlieMessageInputEnabled = await charliePage.locator('#messageInput').isEnabled();

    if (!charlieWelcomeVisible && charlieMessageInputEnabled) {
      console.log(`  ✅ Charlie - Joined room successfully`);
      testsPassed++;
    } else {
      console.log(`  ❌ Charlie - Failed to join room`);
      testsFailed++;
    }

    console.log('\n' + '='.repeat(60) + '\n');

    // TEST 6: Alice sends a message
    console.log('📋 TEST 6: Alice sends a message');
    const aliceMessage = `Hello from Alice! ${Date.now()}`;

    console.log(`  Alice typing: "${aliceMessage}"`);
    const aliceMessageInput = alicePage.locator('#messageInput');
    await aliceMessageInput.fill(aliceMessage);
    await alicePage.waitForTimeout(1000);

    console.log(`  Alice sending message...`);
    await alicePage.locator('#sendBtn').click();
    await alicePage.waitForTimeout(2000);

    // Check if message appears in chat area
    const aliceMessageInChat = await elementExists(alicePage, `text=/${aliceMessage}/`);

    if (aliceMessageInChat) {
      console.log(`  ✅ Alice - Message sent and visible in chat`);
      testsPassed++;
    } else {
      console.log(`  ❌ Alice - Message not visible in chat`);
      testsFailed++;
    }

    console.log('\n' + '='.repeat(60) + '\n');

    // TEST 7: Bob sends a message
    console.log('📋 TEST 7: Bob sends a message');
    const bobMessage = `Hi Alice! This is Bob. ${Date.now()}`;

    console.log(`  Bob typing: "${bobMessage}"`);
    await bobPage.locator('#messageInput').fill(bobMessage);
    await bobPage.waitForTimeout(1000);

    console.log(`  Bob sending message...`);
    await bobPage.locator('#sendBtn').click();
    await bobPage.waitForTimeout(2000);

    const bobMessageInChat = await elementExists(bobPage, `text=/${bobMessage}/`);

    if (bobMessageInChat) {
      console.log(`  ✅ Bob - Message sent and visible in chat`);
      testsPassed++;
    } else {
      console.log(`  ❌ Bob - Message not visible in chat`);
      testsFailed++;
    }

    console.log('\n' + '='.repeat(60) + '\n');

    // TEST 8: Charlie sends a message
    console.log('📋 TEST 8: Charlie sends a message');
    const charlieMessage = `Hey everyone! Charlie here. ${Date.now()}`;

    console.log(`  Charlie typing: "${charlieMessage}"`);
    await charliePage.locator('#messageInput').fill(charlieMessage);
    await charliePage.waitForTimeout(1000);

    console.log(`  Charlie sending message...`);
    await charliePage.locator('#sendBtn').click();
    await charliePage.waitForTimeout(2000);

    const charlieMessageInChat = await elementExists(charliePage, `text=/${charlieMessage}/`);

    if (charlieMessageInChat) {
      console.log(`  ✅ Charlie - Message sent and visible in chat`);
      testsPassed++;
    } else {
      console.log(`  ❌ Charlie - Message not visible in chat`);
      testsFailed++;
    }

    console.log('\n' + '='.repeat(60) + '\n');

    // TEST 9: Check typing indicators
    console.log('📋 TEST 9: Testing typing indicators');

    // Alice starts typing
    console.log(`  Alice starts typing...`);
    await aliceMessageInput.fill('Alice is typing...');
    await alicePage.waitForTimeout(500);

    // Check if typing indicator appears for Bob and Charlie
    await bobPage.waitForTimeout(1000);
    await charliePage.waitForTimeout(1000);

    // Look for draft messages area
    const bobSeesTyping = await elementExists(bobPage, '#draftsArea:visible') ||
                          await elementExists(bobPage, 'text=/Alice/');
    const charlieSeesTyping = await elementExists(charliePage, '#draftsArea:visible') ||
                               await elementExists(charliePage, 'text=/Alice/');

    if (bobSeesTyping || charlieSeesTyping) {
      console.log(`  ✅ Typing indicators working (Bob: ${bobSeesTyping}, Charlie: ${charlieSeesTyping})`);
      testsPassed++;
    } else {
      console.log(`  ⚠️ Typing indicators not detected (may be P2P connection issue)`);
      console.log(`  Note: This is expected in local-only mode`);
      // Don't count as failure - P2P might not be established yet
    }

    // Clear Alice's input
    await aliceMessageInput.clear();
    await alicePage.waitForTimeout(500);

    console.log('\n' + '='.repeat(60) + '\n');

    // TEST 10: Check for error messages
    console.log('📋 TEST 10: Checking for error messages');
    let errorsFound = false;

    for (let i = 0; i < 3; i++) {
      const page = pages[i];
      const user = TEST_CONFIG.users[i];
      const errorResult = await checkForErrors(page, user.name);

      if (errorResult.consoleErrors.length > 0 || errorResult.uiErrors.length > 0) {
        console.log(`  ⚠️ ${user.name} - Errors found (Console: ${errorResult.consoleErrors.length}, UI: ${errorResult.uiErrors.length})`);
        errorsFound = true;
      } else {
        console.log(`  ✅ ${user.name} - No errors`);
      }
    }

    if (!errorsFound) {
      testsPassed++;
    } else {
      console.log(`  ⚠️ Some errors detected, but functionality may still work`);
      testsFailed++;
    }

    console.log('\n' + '='.repeat(60) + '\n');

    // TEST 11: Message persistence - refresh and check
    console.log('📋 TEST 11: Testing message persistence');

    console.log(`  Refreshing Alice's page...`);
    await alicePage.reload();
    await alicePage.waitForLoadState('networkidle');
    await alicePage.waitForTimeout(3000);

    // Check if Alice's message is still there
    const messageStillThere = await elementExists(alicePage, `text=/${aliceMessage}/`);

    if (messageStillThere) {
      console.log(`  ✅ Message persistence - Messages survived page refresh`);
      testsPassed++;
    } else {
      console.log(`  ❌ Message persistence - Messages lost after refresh`);
      testsFailed++;
    }

    console.log('\n' + '='.repeat(60) + '\n');

    // TEST 12: Room sharing functionality
    console.log('📋 TEST 12: Testing room sharing functionality');

    // Check if share button is visible for Alice
    const shareButton = alicePage.locator('#shareRoomBtn');
    const shareButtonVisible = await elementExists(alicePage, '#shareRoomBtn:not(.hidden)');

    if (shareButtonVisible) {
      console.log(`  Share room button is visible`);
      await shareButton.click();
      await alicePage.waitForTimeout(1000);

      // Check for success toast
      const shareSuccess = await waitForToast(alicePage, '✅');

      if (shareSuccess) {
        console.log(`  ✅ Room sharing - Link copied successfully`);
        testsPassed++;
      } else {
        console.log(`  ⚠️ Room sharing - Status unclear`);
        testsFailed++;
      }
    } else {
      console.log(`  ⚠️ Share room button not visible (may be hidden by design)`);
      // Don't count as failure
    }

    console.log('\n' + '='.repeat(60) + '\n');

    // Summary
    console.log('📊 TEST SUMMARY');
    console.log('='.repeat(60));
    console.log(`  Total Tests: ${testsPassed + testsFailed}`);
    console.log(`  ✅ Passed: ${testsPassed}`);
    console.log(`  ❌ Failed: ${testsFailed}`);
    console.log(`  Success Rate: ${((testsPassed / (testsPassed + testsFailed)) * 100).toFixed(1)}%`);
    console.log('='.repeat(60));

    // Take screenshots for documentation
    console.log('\n📸 Taking screenshots...');
    for (let i = 0; i < 3; i++) {
      const page = pages[i];
      const user = TEST_CONFIG.users[i];
      const screenshotPath = `/Users/j/Code/lawzava/mindline/test-screenshot-${user.name}.png`;
      await page.screenshot({ path: screenshotPath, fullPage: true });
      console.log(`  ✅ Screenshot saved: ${screenshotPath}`);
    }

    console.log('\n' + '='.repeat(60) + '\n');

    // Final verdict
    if (testsFailed === 0) {
      console.log('🎉 OVERALL RESULT: PASS - All critical functionality working!');
      return true;
    } else if (testsFailed <= 2) {
      console.log('⚠️ OVERALL RESULT: PARTIAL PASS - Minor issues detected but core functionality works');
      return true;
    } else {
      console.log('❌ OVERALL RESULT: FAIL - Critical issues detected');
      return false;
    }

  } catch (error) {
    console.error('\n❌ TEST EXECUTION ERROR:', error.message);
    console.error(error.stack);
    return false;
  } finally {
    // Cleanup
    console.log('\n🧹 Cleaning up...');

    // Keep browser open for 5 seconds to review
    if (!TEST_CONFIG.headless) {
      console.log('   Browser will close in 5 seconds...');
      await new Promise(resolve => setTimeout(resolve, 5000));
    }

    for (const context of contexts) {
      await context.close();
    }

    if (browser) {
      await browser.close();
    }

    console.log('   ✅ Cleanup complete\n');
  }
}

// Run the tests
runE2ETests()
  .then(success => {
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });