import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Recorder, VOICE_MAX_SECONDS } from '$lib/media/recorder';

class FakeMediaRecorder {
	static isTypeSupported() {
		return true;
	}
	state = 'inactive';
	mimeType = 'audio/webm';
	ondataavailable: ((event: { data: Blob }) => void) | null = null;
	onstop: (() => void) | null = null;
	start() {
		this.state = 'recording';
	}
	stop() {
		this.state = 'inactive';
		queueMicrotask(() => {
			this.ondataavailable?.({ data: new Blob(['voice']) });
			this.onstop?.();
		});
	}
}

describe('Recorder lifecycle', () => {
	let stopTrack: ReturnType<typeof vi.fn>;
	let stream: MediaStream;
	let getUserMedia: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.useFakeTimers();
		stopTrack = vi.fn();
		stream = { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream;
		getUserMedia = vi.fn().mockResolvedValue(stream);
		vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
		vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	test('retains a completed recording after the automatic duration limit', async () => {
		const recorder = new Recorder('voice');
		await recorder.start();
		await vi.advanceTimersByTimeAsync(VOICE_MAX_SECONDS * 1000);
		expect(recorder.isRecording).toBe(false);
		const result = await recorder.stop();
		expect(result?.data).toEqual(new TextEncoder().encode('voice'));
		expect(result?.duration).toBe(VOICE_MAX_SECONDS);
		expect(stopTrack).toHaveBeenCalledTimes(1);
	});

	test('releases a stream if MediaRecorder construction fails', async () => {
		vi.stubGlobal(
			'MediaRecorder',
			class extends FakeMediaRecorder {
				constructor() {
					super();
					throw new Error('unsupported recorder');
				}
			}
		);
		await expect(new Recorder('voice').start()).rejects.toThrow('unsupported recorder');
		expect(stopTrack).toHaveBeenCalledTimes(1);
	});

	test('cancels a permission request that resolves after cancellation', async () => {
		let resolve!: (stream: MediaStream) => void;
		getUserMedia.mockReturnValue(
			new Promise<MediaStream>((done) => {
				resolve = done;
			})
		);
		const recorder = new Recorder('voice');
		const started = recorder.start();
		const rejected = expect(started).rejects.toMatchObject({ name: 'AbortError' });
		recorder.cancel();
		resolve(stream);
		await rejected;
		expect(stopTrack).toHaveBeenCalledTimes(1);
		expect(recorder.isRecording).toBe(false);
	});

	test('rejects duplicate starts without requesting another stream', async () => {
		const recorder = new Recorder('voice');
		const started = recorder.start();
		await expect(recorder.start()).rejects.toThrow();
		await started;
		await expect(recorder.start()).rejects.toThrow();
		expect(getUserMedia).toHaveBeenCalledTimes(1);
		recorder.cancel();
	});

	test('concurrent stops both receive the completed recording', async () => {
		const recorder = new Recorder('voice');
		await recorder.start();
		const [first, second] = await Promise.all([recorder.stop(), recorder.stop()]);
		expect(first?.data).toEqual(new TextEncoder().encode('voice'));
		expect(second).toEqual(first);
		expect(stopTrack).toHaveBeenCalledTimes(1);
	});

	test('cancel during stop discards the result and releases capture', async () => {
		const recorder = new Recorder('voice');
		await recorder.start();
		const stopped = recorder.stop();
		recorder.cancel();
		expect(await stopped).toBeNull();
		expect(stopTrack).toHaveBeenCalledTimes(1);
	});

	test('cancel discards a recording already completed by the duration limit', async () => {
		const recorder = new Recorder('voice');
		await recorder.start();
		await vi.advanceTimersByTimeAsync(VOICE_MAX_SECONDS * 1000);
		recorder.cancel();
		expect(await recorder.stop()).toBeNull();
	});
});
