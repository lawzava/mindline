const { performance } = require('perf_hooks');

const runBenchmark = () => {
  const SIZES = [10, 100, 1000, 10000];
  const ITERATIONS = 1000;

  console.log(`| Set Size | Array.from() (ms) | Direct Iteration (ms) | Improvement |`);
  console.log(`|----------|-------------------|-----------------------|-------------|`);

  for (const size of SIZES) {
    const set = new Set();
    for (let i = 0; i < size; i++) {
      set.add(`peer-${i}`);
    }

    // Warmup
    for (let i = 0; i < 100; i++) {
      const arr = Array.from(set);
      for (const item of arr) {}
      for (const item of set) {}
    }

    const t0 = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
      const arr = Array.from(set);
      for (const item of arr) {
        // simulate some minor work
        const a = item;
      }
    }
    const t1 = performance.now();
    const arrayTime = t1 - t0;

    const t2 = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
      for (const item of set) {
        // simulate some minor work
        const a = item;
      }
    }
    const t3 = performance.now();
    const setTime = t3 - t2;

    const improvement = ((arrayTime - setTime) / arrayTime * 100).toFixed(2);
    console.log(`| ${size.toString().padEnd(8)} | ${arrayTime.toFixed(2).padStart(17)} | ${setTime.toFixed(2).padStart(21)} | ${improvement.padStart(10)}% |`);
  }
};

runBenchmark();
