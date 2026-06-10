/**
 * Voice and video capture (PROTOCOL.md §5.3).
 *
 * MediaRecorder with honest format detection: Chromium/Firefox produce
 * webm/opus, Safari produces mp4/AAC. The mime travels with the blob;
 * cross-engine playback limits surface in the player UI, not here.
 */

export interface Recording {
	data: Uint8Array;
	mime: string;
	duration: number; // seconds
	waveform?: number[]; // 64 normalized peaks, voice only
}

const VOICE_MIMES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
const VIDEO_MIMES = ['video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];

export const VOICE_MAX_SECONDS = 600;
export const VIDEO_MAX_SECONDS = 90;

function pickMime(candidates: string[]): string | undefined {
	return candidates.find((m) => MediaRecorder.isTypeSupported(m));
}

export class Recorder {
	private recorder: MediaRecorder | null = null;
	private stream: MediaStream | null = null;
	private chunks: BlobPart[] = [];
	private startedAt = 0;
	private peaks: number[] = [];
	private analyserStop: (() => void) | null = null;
	private limitTimer: ReturnType<typeof setTimeout> | null = null;
	readonly kind: 'voice' | 'video';

	constructor(kind: 'voice' | 'video') {
		this.kind = kind;
	}

	get isRecording(): boolean {
		return this.recorder?.state === 'recording';
	}

	get elapsedSeconds(): number {
		return this.startedAt ? (Date.now() - this.startedAt) / 1000 : 0;
	}

	async start(): Promise<MediaStream> {
		const constraints: MediaStreamConstraints =
			this.kind === 'voice'
				? { audio: true }
				: { audio: true, video: { facingMode: 'user', width: { ideal: 1280 } } };
		this.stream = await navigator.mediaDevices.getUserMedia(constraints);

		const mime = pickMime(this.kind === 'voice' ? VOICE_MIMES : VIDEO_MIMES);
		this.recorder = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined);
		this.chunks = [];
		this.peaks = [];
		this.recorder.ondataavailable = (e) => {
			if (e.data.size > 0) this.chunks.push(e.data);
		};
		this.recorder.start(250);
		this.startedAt = Date.now();

		if (this.kind === 'voice') this.sampleWaveform(this.stream);

		const maxSeconds = this.kind === 'voice' ? VOICE_MAX_SECONDS : VIDEO_MAX_SECONDS;
		this.limitTimer = setTimeout(() => void this.stop(), maxSeconds * 1000);

		return this.stream;
	}

	/** 64 normalized peaks sampled while recording (§5.3). */
	private sampleWaveform(stream: MediaStream): void {
		try {
			const ctx = new AudioContext();
			const source = ctx.createMediaStreamSource(stream);
			const analyser = ctx.createAnalyser();
			analyser.fftSize = 256;
			source.connect(analyser);
			const data = new Uint8Array(analyser.frequencyBinCount);
			const interval = setInterval(() => {
				analyser.getByteTimeDomainData(data);
				let peak = 0;
				for (const v of data) peak = Math.max(peak, Math.abs(v - 128) / 128);
				this.peaks.push(peak);
			}, 150);
			this.analyserStop = () => {
				clearInterval(interval);
				void ctx.close();
			};
		} catch {
			/* waveform is decorative; recording continues without it */
		}
	}

	async stop(): Promise<Recording | null> {
		const recorder = this.recorder;
		if (!recorder || recorder.state === 'inactive') {
			this.cleanup();
			return null;
		}

		const stopped = new Promise<void>((resolve) => {
			recorder.onstop = () => resolve();
		});
		recorder.stop();
		await stopped;

		const duration = this.elapsedSeconds;
		const blob = new Blob(this.chunks, { type: recorder.mimeType });
		const waveform =
			this.kind === 'voice' && this.peaks.length > 0 ? resamplePeaks(this.peaks, 64) : undefined;
		this.cleanup();

		if (blob.size === 0) return null;
		return {
			data: new Uint8Array(await blob.arrayBuffer()),
			mime: blob.type || recorder.mimeType,
			duration,
			waveform
		};
	}

	cancel(): void {
		if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
		this.cleanup();
	}

	private cleanup(): void {
		if (this.limitTimer) clearTimeout(this.limitTimer);
		this.limitTimer = null;
		this.analyserStop?.();
		this.analyserStop = null;
		this.stream?.getTracks().forEach((t) => t.stop());
		this.stream = null;
		this.recorder = null;
		this.startedAt = 0;
	}
}

function resamplePeaks(peaks: number[], buckets: number): number[] {
	const out: number[] = [];
	const per = peaks.length / buckets;
	for (let i = 0; i < buckets; i++) {
		const slice = peaks.slice(Math.floor(i * per), Math.max(Math.floor((i + 1) * per), Math.floor(i * per) + 1));
		out.push(Number(Math.max(...slice, 0).toFixed(3)));
	}
	return out;
}
