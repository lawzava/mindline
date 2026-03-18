async function mockSendRelay(msg) {
  // Simulate crypto.subtle.encrypt delay
  return new Promise(resolve => setTimeout(resolve, 5));
}

async function sequential(pending) {
  const start = performance.now();
  for (const m of pending) {
    await mockSendRelay(m);
  }
  return performance.now() - start;
}

async function parallel(pending) {
  const start = performance.now();
  await Promise.all(pending.map(m => mockSendRelay(m)));
  return performance.now() - start;
}

async function run() {
  const pending = new Array(100).fill(0);
  const seqTime = await sequential(pending);
  const parTime = await parallel(pending);

  console.log("Sequential time:", seqTime, "ms");
  console.log("Parallel time:", parTime, "ms");
  console.log("Improvement:", (seqTime / parTime).toFixed(2) + "x");
}

run();
