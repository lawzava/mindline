#!/usr/bin/env node

// Simple Node.js test for room ID validation without web server
const fs = require('fs');
const path = require('path');

async function testRoomIdValidation() {
  console.log('🧪 Testing Room ID Validation Logic\n');

  // Test the JavaScript validation logic that should match WASM
  function validateRoomIdJS(roomId) {
    if (!roomId || typeof roomId !== 'string') {
      return '';
    }

    // Remove any potentially dangerous characters (match Rust logic)
    const sanitized = roomId
      .split('')
      .filter(c => /[a-zA-Z0-9_-]/.test(c))
      .join('');

    // Check length constraints - allow shorter room IDs (minimum 3 chars) and UUIDs
    if (sanitized.length < 3 || sanitized.length > 64) {
      return '';
    }

    return sanitized;
  }

  // Test cases (same as in Rust tests)
  const testCases = [
    { input: 'testroom', expected: 'testroom' },
    { input: 'room-123', expected: 'room-123' },
    { input: 'cd87b151-0660-4b20-84fb-f2a36d2e12d1', expected: 'cd87b151-0660-4b20-84fb-f2a36d2e12d1' },
    { input: 'MyRoom', expected: 'MyRoom' },
    { input: 'ab', expected: '' }, // Too short
    { input: '', expected: '' }, // Empty
    { input: 'invalid<script>', expected: 'invalidscript' }, // XSS filtered
    { input: 'room with spaces', expected: 'roomwithspaces' }, // Spaces removed
    { input: 'room_underscore', expected: 'room_underscore' },
    { input: 'a'.repeat(65), expected: '' }, // Too long
  ];

  console.log('🔍 Testing JavaScript validation logic (should match WASM):');
  console.log('─'.repeat(80));

  let passed = 0;
  let failed = 0;

  testCases.forEach(({ input, expected }, index) => {
    const result = validateRoomIdJS(input);
    const pass = result === expected;

    if (pass) {
      console.log(`✅ Test ${index + 1}: "${input}" → "${result}"`);
      passed++;
    } else {
      console.log(`❌ Test ${index + 1}: "${input}" → "${result}" (expected: "${expected}")`);
      failed++;
    }
  });

  console.log('─'.repeat(80));
  console.log(`📊 Results: ${passed} passed, ${failed} failed`);

  if (failed === 0) {
    console.log('🎉 All tests passed! JavaScript logic is correct.');
    console.log('💡 WASM should return the same results if implemented correctly.');
  } else {
    console.log('❌ Some tests failed. Logic needs adjustment.');
  }

  // Check WASM binary exists
  const wasmPath = path.join(__dirname, '..', 'pkg', 'mindline_bg.wasm');
  if (fs.existsSync(wasmPath)) {
    const stats = fs.statSync(wasmPath);
    console.log(`\n✅ WASM binary exists: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
  } else {
    console.log('\n❌ WASM binary not found. Run npm run build-wasm first.');
  }

  console.log('\n🌐 Testing URL room detection:');

  // Test URL room parsing logic
  function parseRoomFromURL(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.searchParams.get('r');
    } catch (error) {
      console.log('❌ URL parsing failed:', error.message);
      return null;
    }
  }

  const testUrls = [
    'http://localhost:8080/?r=testroom',
    'http://localhost:8080/?r=room-123',
    'http://localhost:8080/?r=cd87b151-0660-4b20-84fb-f2a36d2e12d1',
    'http://localhost:8080/',
    'http://localhost:8080/?other=param'
  ];

  testUrls.forEach(url => {
    const roomId = parseRoomFromURL(url);
    console.log(`URL: ${url} → Room: "${roomId || 'none'}"`);
  });

  console.log('\n💡 To test WASM functions in browser, visit:');
  console.log('   http://localhost:8080/test_room_id.html');
  console.log('\n💡 If WASM returns arrays instead of strings, the issue is in wasm-bindgen compilation.');
}

// Run the test
if (require.main === module) {
  testRoomIdValidation().catch(console.error);
}

module.exports = { testRoomIdValidation };