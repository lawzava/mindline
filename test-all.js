// Run all chat history tests
const { spawn } = require('child_process');

const tests = [
  { name: 'UI Fix Test', file: 'test-ui-fix.js' },
  { name: 'UI Send Test', file: 'test-ui-send.js' },
  { name: 'Final Verification', file: 'test-final-verification.js' },
  { name: 'Single User Persistence', file: 'test-single-user-persistence.js' },
];

async function runTest(testName, testFile) {
  return new Promise((resolve) => {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Running: ${testName}`);
    console.log(`${'='.repeat(60)}`);

    const proc = spawn('node', [testFile], { stdio: 'pipe' });
    let output = '';

    proc.stdout.on('data', (data) => {
      const text = data.toString();
      output += text;
      // Only show key results
      const lines = text.split('\n');
      lines.forEach(line => {
        if (line.includes('SUCCESS') || line.includes('FAIL') ||
            line.includes('PASS') || line.includes('Score:') ||
            line.includes('PERFECT') || line.includes('messages')) {
          console.log(line);
        }
      });
    });

    proc.stderr.on('data', (data) => {
      console.error(`Error: ${data}`);
    });

    proc.on('close', (code) => {
      const passed = output.includes('SUCCESS') || output.includes('PERFECT') ||
                     output.includes('3/3 tests passed') || output.includes('4/4 tests passed');
      resolve({ name: testName, passed, code });
    });
  });
}

async function runAllTests() {
  console.log('🧪 RUNNING ALL CHAT HISTORY TESTS');
  console.log('='.repeat(60));

  const results = [];

  for (const test of tests) {
    const result = await runTest(test.name, test.file);
    results.push(result);
  }

  console.log('\n' + '='.repeat(60));
  console.log('FINAL TEST SUMMARY');
  console.log('='.repeat(60));

  let passCount = 0;
  results.forEach(r => {
    const status = r.passed ? '✅ PASS' : '❌ FAIL';
    console.log(`${status} - ${r.name}`);
    if (r.passed) passCount++;
  });

  console.log(`\n📊 Total: ${passCount}/${results.length} tests passed`);

  if (passCount === results.length) {
    console.log('🎉 ALL TESTS PASSING! Chat history sync is fully functional!');
  } else if (passCount >= results.length - 1) {
    console.log('✅ ALMOST THERE! Most functionality is working correctly.');
  } else {
    console.log('⚠️  Some tests are failing. Review the output above.');
  }
}

runAllTests().catch(console.error);