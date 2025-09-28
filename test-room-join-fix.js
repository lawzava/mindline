/**
 * Test to verify the room joining bug fix
 * This test checks that joining a room doesn't cause infinite recursion/freeze
 */

const assert = require('assert');

async function testRoomJoining() {
  console.log('Starting room join test...');

  try {
    // Navigate to the app
    await mcp__playwright__browser_navigate({ url: 'http://localhost:8080' });
    console.log('✓ Navigated to app');

    // Wait for page to load
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Fill in username if needed
    const usernameInput = '#usernameInput';
    try {
      await mcp__playwright__browser_type({ selector: usernameInput, text: 'TestUser1' });
      console.log('✓ Entered username');
    } catch (e) {
      console.log('Username input not found or already set');
    }

    // Fill in room ID
    const roomIdInput = '#roomIdInput';
    await mcp__playwright__browser_type({ selector: roomIdInput, text: 'test-room-12345' });
    console.log('✓ Entered room ID');

    // Click join button
    const joinBtn = '#joinRoomBtn';
    await mcp__playwright__browser_click({ selector: joinBtn });
    console.log('✓ Clicked join button');

    // Wait a moment and check if page is still responsive
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Try to interact with the page - if it's frozen, this will timeout
    const messageInput = '#messageInput';
    await mcp__playwright__browser_type({ selector: messageInput, text: 'Test message' });
    console.log('✓ Page is still responsive - no freeze!');

    // Check console for errors
    const consoleMessages = await mcp__playwright__browser_console_messages();
    console.log('\nConsole messages:');
    console.log(consoleMessages);

    // Look for the specific error pattern
    const hasRecursionError = consoleMessages.toLowerCase().includes('index out of bounds');

    if (hasRecursionError) {
      console.log('\n❌ FAIL: Still seeing "index out of bounds" error');
      return false;
    } else {
      console.log('\n✅ PASS: No infinite recursion error detected!');
      return true;
    }

  } catch (error) {
    console.error('\n❌ FAIL: Test error:', error.message);
    return false;
  }
}

// Run the test
testRoomJoining().then(success => {
  process.exit(success ? 0 : 1);
}).catch(error => {
  console.error('Fatal test error:', error);
  process.exit(1);
});