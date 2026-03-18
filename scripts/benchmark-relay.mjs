import { performance } from 'node:perf_hooks';

// Simulate the delay of sending a message over a WebSocket/relay (e.g., 5ms roundtrip/processing)
const MOCK_SEND_DELAY_MS = 5;
const NUM_MESSAGES = 100;

async function mockSendRelay(message, peerId) {
    return new Promise(resolve => setTimeout(resolve, MOCK_SEND_DELAY_MS));
}

async function flushSequential(messages, peerId) {
    for (const message of messages) {
        await mockSendRelay(message, peerId);
    }
}

async function flushConcurrent(messages, peerId) {
    await Promise.all(messages.map(message => mockSendRelay(message, peerId)));
}

async function runBenchmark() {
    console.log(`Starting benchmark for flushing ${NUM_MESSAGES} pending relay messages...`);
    const messages = Array.from({ length: NUM_MESSAGES }, (_, i) => ({ id: i, data: 'test' }));
    const peerId = 'mock-peer-123';

    // Measure Sequential (Baseline)
    const startSeq = performance.now();
    await flushSequential(messages, peerId);
    const endSeq = performance.now();
    const timeSeq = endSeq - startSeq;
    console.log(`\n[Baseline] Sequential flush took: ${timeSeq.toFixed(2)} ms`);

    // Measure Concurrent (Optimized)
    const startCon = performance.now();
    await flushConcurrent(messages, peerId);
    const endCon = performance.now();
    const timeCon = endCon - startCon;
    console.log(`[Optimized] Concurrent flush took: ${timeCon.toFixed(2)} ms`);

    console.log(`\nSpeedup: ${(timeSeq / timeCon).toFixed(2)}x faster`);
}

runBenchmark().catch(console.error);
