import { performance } from 'perf_hooks';

// Mock RTCIceCandidate
class RTCIceCandidate {
    constructor(candidateInit) {
        this.candidate = candidateInit.candidate;
        this.sdpMid = candidateInit.sdpMid;
        this.sdpMLineIndex = candidateInit.sdpMLineIndex;
    }
}

// Mock RTCPeerConnection that adds a simulated delay to addIceCandidate
class MockRTCPeerConnection {
    async addIceCandidate(candidate) {
        // Simulate a small delay for adding an ICE candidate (e.g., 5-15ms)
        const delay = Math.floor(Math.random() * 10) + 5;
        return new Promise((resolve) => setTimeout(resolve, delay));
    }
}

async function runBenchmark() {
    console.log("Generating 50 mock ICE candidates...");
    const candidates = Array.from({ length: 50 }).map((_, i) => ({
        candidate: `mock-candidate-${i}`,
        sdpMid: 'mock-mid',
        sdpMLineIndex: 0
    }));

    const pc1 = new MockRTCPeerConnection();
    const pc2 = new MockRTCPeerConnection();

    const seqStart = performance.now();
    for (const candidate of candidates) {
        try {
            await pc1.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (error) {
            console.error(error);
        }
    }
    const seqEnd = performance.now();
    const seqTime = seqEnd - seqStart;
    console.log(`Sequential processing took: ${seqTime.toFixed(2)} ms`);

    const concStart = performance.now();
    await Promise.allSettled(
        candidates.map(async (candidate) => {
            try {
                await pc2.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (error) {
                console.error(error);
            }
        })
    );
    const concEnd = performance.now();
    const concTime = concEnd - concStart;
    console.log(`Concurrent processing took: ${concTime.toFixed(2)} ms`);

    console.log("\n--- Results ---");
    console.log(`Improvement: ${((seqTime - concTime) / seqTime * 100).toFixed(2)}% faster`);
    console.log(`Absolute difference: ${(seqTime - concTime).toFixed(2)} ms`);
}

runBenchmark().catch(console.error);
