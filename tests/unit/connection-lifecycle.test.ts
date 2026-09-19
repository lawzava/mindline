import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { P2PConnection } from '$lib/p2p/connection';
import type { CryptoSession } from '$lib/p2p/crypto-session';

class FakeChannel {
	readyState = 'open';
	onopen: (() => void) | null = null;
	onmessage: ((event: { data: string }) => void) | null = null;
	send = vi.fn();
	constructor(readonly label: string) {}
	close() {
		this.readyState = 'closed';
	}
}

class FakePeerConnection {
	static instances: FakePeerConnection[] = [];
	connectionState = 'connected';
	signalingState = 'stable';
	localDescription = { type: 'offer', sdp: '' };
	remoteDescription = { type: 'answer', sdp: '' };
	onconnectionstatechange: (() => void) | null = null;
	onnegotiationneeded: (() => Promise<void>) | null = null;
	onicecandidate: ((event: { candidate: { toJSON: () => object } }) => Promise<void>) | null = null;
	ondatachannel: ((event: { channel: FakeChannel }) => void) | null = null;
	channels: FakeChannel[] = [];
	restartIce = vi.fn();
	setLocalDescription = vi.fn(async () => {});
	setRemoteDescription = vi.fn(async () => {});
	constructor() {
		FakePeerConnection.instances.push(this);
	}
	createDataChannel(label: string) {
		const channel = new FakeChannel(label);
		this.channels.push(channel);
		return channel;
	}
	close() {
		// Browsers may deliver an already queued callback after replacement.
		this.connectionState = 'closed';
	}
}

class FakeSocket {
	static OPEN = 1;
	static instance: FakeSocket;
	readyState = FakeSocket.OPEN;
	onopen: (() => void) | null = null;
	onmessage: ((event: { data: string }) => void) | null = null;
	onclose: (() => void) | null = null;
	send = vi.fn();
	constructor() {
		FakeSocket.instance = this;
	}
	close() {
		this.onclose?.();
	}
	async receive(message: object) {
		this.onmessage?.({ data: JSON.stringify(message) });
		await vi.advanceTimersByTimeAsync(0);
	}
}

describe('P2P peer callback lifecycle', () => {
	let connection: P2PConnection;
	let socket: FakeSocket;
	let session: ReturnType<typeof makeSession>;
	const hello = { deviceId: 'remote-device', g: 1, gid: 'generation-1' };
	function makeSession() {
		return {
			roomId: 'room',
			deviceId: 'local-device',
			generation: { g: 1, gid: 'generation-1' },
			hasGeneration: () => true,
			acceptHello: vi.fn(async () => hello),
			makeHello: vi.fn(async () => '{}'),
			openMessage: vi.fn(async () => ({ type: 'chat', text: 'hello' })),
			verifySignalingAuth: vi.fn(async () => true),
			signalingAuth: vi.fn(async () => 'auth')
		};
	}
	async function join() {
		await socket.receive({ type: 'room-joined', yourId: 'local', peers: ['remote'] });
		return FakePeerConnection.instances.at(-1)!;
	}
	async function verify(pc: FakePeerConnection) {
		pc.channels[0].onmessage?.({ data: '{}' });
		await vi.advanceTimersByTimeAsync(0);
	}
	beforeEach(async () => {
		vi.useFakeTimers();
		vi.stubGlobal('RTCPeerConnection', FakePeerConnection);
		vi.stubGlobal('WebSocket', FakeSocket);
		FakePeerConnection.instances = [];
		session = makeSession();
		connection = new P2PConnection(session as unknown as CryptoSession, {}, () => 'Local');
		const connecting = connection.connect();
		socket = FakeSocket.instance;
		socket.onopen?.();
		await connecting;
	});
	afterEach(() => {
		connection.disconnect();
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	test('an old queued close cannot remove a replacement; its own close still removes it', async () => {
		const disconnected = vi.fn();
		connection.onPeerDisconnected(disconnected);
		const old = await join();
		await verify(old);
		const replacement = await join();
		await verify(replacement);
		old.onconnectionstatechange?.();
		expect(connection.getDirectPeers()).toEqual(['remote-device']);
		expect(replacement.connectionState).toBe('connected');
		expect(disconnected).not.toHaveBeenCalled();
		replacement.close();
		replacement.onconnectionstatechange?.();
		expect(connection.getDirectPeers()).toEqual([]);
		expect(disconnected).toHaveBeenCalledExactlyOnceWith('remote-device');
	});

	test('stale failure and media callbacks cannot restart or expose a replaced peer', async () => {
		const media = vi.fn();
		connection.onMediaChannel(media);
		const old = await join();
		await verify(old);
		const liveChannel = new FakeChannel('media-live');
		old.ondatachannel?.({ channel: liveChannel });
		expect(media).toHaveBeenCalledExactlyOnceWith('remote-device', 'live', liveChannel);
		media.mockClear();
		await join();
		old.connectionState = 'failed';
		old.onconnectionstatechange?.();
		const channel = new FakeChannel('media-transfer');
		old.ondatachannel?.({ channel });
		await vi.advanceTimersByTimeAsync(1000);
		expect(old.restartIce).not.toHaveBeenCalled();
		expect(media).not.toHaveBeenCalled();
		expect(channel.readyState).toBe('closed');
	});

	test('a pending hello cannot register a peer after its connection was replaced', async () => {
		let finish!: (value: typeof hello) => void;
		session.acceptHello.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
		const connected = vi.fn();
		connection.onPeerConnected(connected);
		const old = await join();
		old.channels[0].onmessage?.({ data: '{}' });
		await join();
		finish(hello);
		await vi.advanceTimersByTimeAsync(0);
		expect(connected).not.toHaveBeenCalled();
		expect(connection.getDirectPeers()).toEqual([]);
	});

	test('stale channel messages are ignored, including decryption already in progress', async () => {
		const message = vi.fn();
		connection.onMessage(message);
		const old = await join();
		await verify(old);
		let finish!: (body: { type: string; text: string }) => void;
		session.openMessage.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
		old.channels[0].onmessage?.({ data: '{}' });
		await join();
		finish({ type: 'chat', text: 'late' });
		old.channels[1].onmessage?.({ data: '{}' });
		await vi.advanceTimersByTimeAsync(0);
		expect(message).not.toHaveBeenCalled();
		expect(session.openMessage).toHaveBeenCalledTimes(1);
	});

	test('negotiation and candidate authentication finishing after replacement sends nothing', async () => {
		const old = await join();
		let finish!: (auth: string) => void;
		const pendingAuth = new Promise<string>((resolve) => (finish = resolve));
		session.signalingAuth.mockReturnValue(pendingAuth);
		const negotiation = old.onnegotiationneeded?.();
		const candidate = old.onicecandidate?.({ candidate: { toJSON: () => ({}) } });
		await join();
		socket.send.mockClear();
		finish('auth');
		await Promise.all([negotiation, candidate]);
		await vi.advanceTimersByTimeAsync(100);
		expect(socket.send).not.toHaveBeenCalled();
	});

	test('callbacks on a rekeyed live peer use its current clientId', async () => {
		const pc = await join();
		await verify(pc);
		await socket.receive({
			type: 'answer',
			fromId: 'remote-reconnected',
			data: {
				auth: { deviceId: 'remote-device', hmac: 'valid' },
				description: { type: 'answer', sdp: '' }
			}
		});
		socket.send.mockClear();
		await pc.onnegotiationneeded?.();
		await pc.onicecandidate?.({ candidate: { toJSON: () => ({}) } });
		await vi.advanceTimersByTimeAsync(100);
		expect(socket.send.mock.calls.map(([wire]) => JSON.parse(wire).targetId)).toEqual([
			'remote-reconnected',
			'remote-reconnected'
		]);
		pc.close();
		pc.onconnectionstatechange?.();
		expect(connection.getDirectPeers()).toEqual([]);
	});

	test('an answer pending remote description is discarded after peer replacement', async () => {
		const old = await join();
		let finish!: () => void;
		old.setRemoteDescription.mockImplementationOnce(
			() => new Promise<void>((resolve) => (finish = resolve))
		);
		await socket.receive({
			type: 'offer',
			fromId: 'remote',
			data: {
				auth: { deviceId: 'remote-device', hmac: 'valid' },
				description: { type: 'offer', sdp: '' }
			}
		});
		await join();
		socket.send.mockClear();
		finish();
		await vi.advanceTimersByTimeAsync(100);
		expect(socket.send).not.toHaveBeenCalled();
		expect(old.setLocalDescription).not.toHaveBeenCalled();
	});

	test('replacement cancels an already scheduled ICE restart', async () => {
		const old = await join();
		old.connectionState = 'failed';
		old.onconnectionstatechange?.();
		await join();
		await vi.advanceTimersByTimeAsync(1000);
		expect(old.restartIce).not.toHaveBeenCalled();
	});

	test('an outbound hello finishing after replacement is not sent to its old channel', async () => {
		const old = await join();
		let finish!: (wire: string) => void;
		session.makeHello.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
		old.channels[0].onopen?.();
		await join();
		finish('{}');
		await vi.advanceTimersByTimeAsync(0);
		expect(old.channels[0].send).not.toHaveBeenCalled();
	});
});
