/**
 * Read QR codes from the camera, on this device only. The platform's
 * BarcodeDetector is used where it reads QR; elsewhere jsQR decodes the
 * frames, loaded only when a scan starts.
 */

type Decode = (video: HTMLVideoElement) => Promise<string | null>;

interface BarcodeDetectorLike {
	detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}

interface BarcodeDetectorClass {
	new (options: { formats: string[] }): BarcodeDetectorLike;
	getSupportedFormats(): Promise<string[]>;
}

async function platformDecoder(): Promise<Decode | null> {
	const Detector = (globalThis as { BarcodeDetector?: BarcodeDetectorClass }).BarcodeDetector;
	if (!Detector) return null;
	try {
		if (!(await Detector.getSupportedFormats()).includes('qr_code')) return null;
		const detector = new Detector({ formats: ['qr_code'] });
		return async (video) => (await detector.detect(video))[0]?.rawValue ?? null;
	} catch {
		return null;
	}
}

async function scriptDecoder(): Promise<Decode> {
	const { default: jsQR } = await import('jsqr');
	const canvas = document.createElement('canvas');
	const context = canvas.getContext('2d', { willReadFrequently: true })!;
	return async (video) => {
		const width = video.videoWidth;
		const height = video.videoHeight;
		if (!width || !height) return null;
		canvas.width = width;
		canvas.height = height;
		context.drawImage(video, 0, 0, width, height);
		const { data } = context.getImageData(0, 0, width, height);
		return jsQR(data, width, height, { inversionAttempts: 'attemptBoth' })?.data ?? null;
	};
}

export interface Scan {
	stop(): void;
}

/**
 * Show the camera in `video` and pass each decoded code to `onText` until
 * it returns true or the scan is stopped. Throws when the camera is refused.
 */
export async function startScan(
	video: HTMLVideoElement,
	onText: (text: string) => boolean
): Promise<Scan> {
	const stream = await navigator.mediaDevices.getUserMedia({
		video: { facingMode: 'environment' },
		audio: false
	});
	let stopped = false;
	const stop = () => {
		stopped = true;
		for (const track of stream.getTracks()) track.stop();
		video.srcObject = null;
	};
	try {
		video.srcObject = stream;
		video.muted = true;
		await video.play();
	} catch (error) {
		stop();
		throw error;
	}
	const decode = (await platformDecoder()) ?? (await scriptDecoder());
	const tick = async () => {
		if (stopped) return;
		let text: string | null = null;
		try {
			text = await decode(video);
		} catch {
			/* a frame that cannot be read: try the next one */
		}
		if (stopped) return;
		if (text && onText(text)) {
			stop();
			return;
		}
		setTimeout(() => void tick(), 150);
	};
	void tick();
	return { stop };
}
