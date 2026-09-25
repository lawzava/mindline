import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { P2PConnection } from '$lib/p2p/connection';
import { CryptoSession } from '$lib/p2p/crypto-session';
import { createRoomKey } from '$lib/crypto/keys';
import type { TypedP2PMessage } from '$lib/p2p/types';

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
	addIceCandidate = vi.fn(async () => {});
	constructor(readonly configuration?: RTCConfiguration) {
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
	close(code?: number) {
		if (code !== undefined && code !== 1000 && (code < 3000 || code > 4999)) {
			throw new DOMException('Invalid WebSocket close code', 'InvalidAccessError');
		}
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
			handleRekeyGrant: vi.fn(async () => 'adopted'),
			canReadGeneration: vi.fn(() => true),
			makeRekeyRequestWire: vi.fn(async () => '{}'),
			sealMessage: vi.fn(async (body: Record<string, unknown>) => JSON.stringify(body)),
			sealDraft: vi.fn(async (body: Record<string, unknown>) => JSON.stringify(body)),
			grantWireFor: vi.fn(async () => '{"type":"rekey-grant"}'),
			mintGeneration: vi.fn(async () => {}),
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

	test('new connections gather candidates on demand by default', async () => {
		const pc = await join();
		expect(pc.configuration?.iceCandidatePoolSize).toBe(0);
	});

	test('a newly created connection gets a deadline without any state-change event', async () => {
		vi.stubGlobal(
			'RTCPeerConnection',
			class extends FakePeerConnection {
				connectionState = 'new';
			}
		);
		const pc = await join();
		await vi.advanceTimersByTimeAsync(16000);
		expect(pc.restartIce).toHaveBeenCalledTimes(1);
	});

	test('explicit pool and attempt timeout settings remain effective', async () => {
		connection.disconnect();
		connection = new P2PConnection(
			session as unknown as CryptoSession,
			{
				icePoolSize: 2,
				offerTimeout: 5000
			},
			() => 'Local'
		);
		const connecting = connection.connect();
		socket = FakeSocket.instance;
		socket.onopen?.();
		await connecting;
		const pc = await join();
		expect(pc.configuration?.iceCandidatePoolSize).toBe(2);
		pc.connectionState = 'new';
		pc.onconnectionstatechange?.();
		await vi.advanceTimersByTimeAsync(6000);
		expect(pc.restartIce).toHaveBeenCalledTimes(1);
	});

	test.each(['new', 'connecting', 'disconnected'])(
		'a connection stalled in %s restarts even without a failed event',
		async (state) => {
			const pc = await join();
			pc.connectionState = state;
			pc.onconnectionstatechange?.();
			await vi.advanceTimersByTimeAsync(14999);
			expect(pc.restartIce).not.toHaveBeenCalled();
			await vi.advanceTimersByTimeAsync(1001);
			expect(pc.restartIce).toHaveBeenCalledTimes(1);
			await vi.advanceTimersByTimeAsync(17000);
			expect(pc.restartIce).toHaveBeenCalledTimes(2);
		}
	);

	test.each([
		{ strictDirect: false, allowRelayFallback: true },
		{ strictDirect: true, allowRelayFallback: true },
		{ strictDirect: false, allowRelayFallback: false }
	])('repeated stalls exhaust the restart budget (%j)', async (config) => {
		connection.disconnect();
		connection = new P2PConnection(session as unknown as CryptoSession, config, () => 'Local');
		const connecting = connection.connect();
		socket = FakeSocket.instance;
		socket.onopen?.();
		await connecting;
		const pc = await join();
		// Successful signaling authentication identifies the peer even when
		// ICE never connects; fallback must still use the relay hello proof.
		await socket.receive({
			type: 'answer',
			fromId: 'remote',
			data: {
				auth: { deviceId: 'remote-device', hmac: 'valid' },
				description: { type: 'answer', sdp: '' }
			}
		});
		pc.connectionState = 'new';
		pc.onconnectionstatechange?.();
		socket.send.mockClear();
		await vi.advanceTimersByTimeAsync(120000);
		expect(pc.restartIce).toHaveBeenCalledTimes(5);
		expect(pc.connectionState).toBe('closed');
		const relays = socket.send.mock.calls
			.map(([wire]) => JSON.parse(wire))
			.filter((message) => message.type === 'relay');
		const relayAllowed = !config.strictDirect && config.allowRelayFallback;
		expect(relays).toHaveLength(relayAllowed ? 1 : 0);
		if (relayAllowed) expect(relays[0].data).toEqual({ hello: '{}' });
		await vi.advanceTimersByTimeAsync(120000);
		expect(pc.restartIce).toHaveBeenCalledTimes(5);
		expect(vi.getTimerCount()).toBe(0);
	});

	test('connecting successfully cancels both the attempt deadline and pending restart', async () => {
		const pc = await join();
		pc.connectionState = 'new';
		pc.onconnectionstatechange?.();
		await vi.advanceTimersByTimeAsync(15000);
		pc.connectionState = 'connected';
		pc.onconnectionstatechange?.();
		await vi.advanceTimersByTimeAsync(120000);
		expect(pc.restartIce).not.toHaveBeenCalled();
		expect(pc.connectionState).toBe('connected');
		expect(vi.getTimerCount()).toBe(0);
	});

	test('replacing or disconnecting a stalled peer cancels its attempt deadline', async () => {
		const old = await join();
		old.connectionState = 'new';
		old.onconnectionstatechange?.();
		await vi.advanceTimersByTimeAsync(10000);
		const replacement = await join();
		replacement.connectionState = 'new';
		replacement.onconnectionstatechange?.();
		await vi.advanceTimersByTimeAsync(6000);
		expect(old.restartIce).not.toHaveBeenCalled();
		expect(replacement.restartIce).not.toHaveBeenCalled();
		connection.disconnect();
		await vi.advanceTimersByTimeAsync(120000);
		expect(replacement.restartIce).not.toHaveBeenCalled();
	});

	test('signaling progress cannot extend a stalled attempt', async () => {
		const pc = await join();
		pc.connectionState = 'new';
		pc.onconnectionstatechange?.();
		await vi.advanceTimersByTimeAsync(14900);
		await socket.receive({
			type: 'answer',
			fromId: 'remote',
			data: {
				auth: { deviceId: 'remote-device', hmac: 'valid' },
				description: { type: 'answer', sdp: '' }
			}
		});
		pc.connectionState = 'connecting';
		pc.onconnectionstatechange?.();
		await vi.advanceTimersByTimeAsync(1100);
		expect(pc.restartIce).toHaveBeenCalledTimes(1);
	});

	test('a restart that immediately connects leaves no attempt timer', async () => {
		const pc = await join();
		pc.connectionState = 'new';
		pc.onconnectionstatechange?.();
		pc.restartIce.mockImplementationOnce(() => {
			pc.connectionState = 'connected';
			pc.onconnectionstatechange?.();
		});
		await vi.advanceTimersByTimeAsync(16000);
		expect(pc.restartIce).toHaveBeenCalledTimes(1);
		expect(vi.getTimerCount()).toBe(0);
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

	test('channel envelopes are opened against the verified device of that channel', async () => {
		const message = vi.fn();
		connection.onMessage(message);
		const pc = await join();
		await verify(pc);
		pc.channels[0].onmessage?.({ data: '{}' });
		await vi.advanceTimersByTimeAsync(0);
		expect(session.openMessage).toHaveBeenCalledWith(expect.anything(), hello.deviceId);
		expect(message).toHaveBeenCalledWith(expect.anything(), hello.deviceId);
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
		socket.close();
		const reconnecting = connection.reconnectSignaling();
		socket = FakeSocket.instance;
		socket.onopen?.();
		await reconnecting;
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
		await vi.advanceTimersByTimeAsync(0);
		await join();
		finish('{}');
		await vi.advanceTimersByTimeAsync(0);
		expect(old.channels[0].send).not.toHaveBeenCalled();
	});

	test('a reliable media offer waits for the preceding hello verification', async () => {
		const pc = await join();
		const message = vi.fn();
		connection.onMessage(message);
		let finish!: (value: typeof hello) => void;
		session.acceptHello.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
		pc.channels[0].onmessage?.({ data: '{"t":"hs"}' });
		await vi.advanceTimersByTimeAsync(0);
		pc.channels[0].onmessage?.({ data: '{"t":"msg","g":1}' });
		await vi.advanceTimersByTimeAsync(0);
		finish(hello);
		await vi.advanceTimersByTimeAsync(0);
		expect(session.acceptHello).toHaveBeenCalledTimes(1);
		expect(message).toHaveBeenCalledExactlyOnceWith(
			{ type: 'chat', text: 'hello' },
			'remote-device'
		);
	});

	test('a reliable media offer waits for the preceding grant adoption', async () => {
		const pc = await join();
		await verify(pc);
		const message = vi.fn();
		connection.onMessage(message);
		let adopted = false;
		let finish!: () => void;
		session.handleRekeyGrant.mockImplementationOnce(
			() =>
				new Promise<string>(
					(resolve) =>
						(finish = () => {
							adopted = true;
							resolve('adopted');
						})
				)
		);
		session.openMessage.mockImplementation(async (envelope?: { t: string }) => {
			if (envelope?.t === 'hs') return { type: 'rekey-grant', text: '' };
			if (!adopted) throw new Error('unknown generation 2 from remote-device');
			return { type: 'media-offer', text: 'attachment' };
		});
		session.canReadGeneration.mockImplementation(() => adopted);
		pc.channels[0].onmessage?.({ data: '{"t":"hs"}' });
		await vi.advanceTimersByTimeAsync(0);
		pc.channels[0].onmessage?.({ data: '{"t":"msg","g":2}' });
		await vi.advanceTimersByTimeAsync(0);
		finish();
		await vi.advanceTimersByTimeAsync(0);
		expect(message).toHaveBeenCalledExactlyOnceWith(
			{ type: 'media-offer', text: 'attachment' },
			'remote-device'
		);
		expect(session.makeRekeyRequestWire).not.toHaveBeenCalled();
	});

	test('after adopting a generation, send its grant before a media offer to that peer', async () => {
		const pc = await join();
		await verify(pc);
		pc.channels[0].send.mockClear();
		session.generation = { g: 2, gid: 'generation-2' };
		let finish!: (wire: string) => void;
		session.grantWireFor.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
		connection.sendToPeer('remote-device', { type: 'media-offer' } as TypedP2PMessage);
		await vi.advanceTimersByTimeAsync(0);
		expect(pc.channels[0].send).not.toHaveBeenCalled();
		finish('{"type":"rekey-grant"}');
		await vi.advanceTimersByTimeAsync(0);
		expect(pc.channels[0].send.mock.calls.map(([wire]) => JSON.parse(wire).type)).toEqual([
			'rekey-grant',
			'media-offer'
		]);
	});

	test('concurrent reliable sends keep sealing and transmission in the same order', async () => {
		const pc = await join();
		await verify(pc);
		pc.channels[0].send.mockClear();
		let finish!: (wire: string) => void;
		session.sealMessage.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
		connection.sendToPeer('remote-device', { type: 'media-offer' } as TypedP2PMessage);
		await vi.advanceTimersByTimeAsync(0);
		connection.sendToPeer('remote-device', { type: 'media-abort' } as TypedP2PMessage);
		await vi.advanceTimersByTimeAsync(0);
		expect(pc.channels[0].send).not.toHaveBeenCalled();
		finish('{"type":"media-offer"}');
		await vi.advanceTimersByTimeAsync(0);
		expect(pc.channels[0].send.mock.calls.map(([wire]) => JSON.parse(wire).type)).toEqual([
			'media-offer',
			'media-abort'
		]);
	});

	test('minting blocks reliable media until the grant is sent, while drafts remain independent', async () => {
		const pc = await join();
		await verify(pc);
		pc.channels[0].send.mockClear();
		session.mintGeneration.mockImplementation(async () => {
			session.generation = { g: 2, gid: 'generation-2' };
		});
		let finish!: (wire: string) => void;
		session.grantWireFor.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
		const mint = connection.mintAndBroadcastGrant();
		await vi.advanceTimersByTimeAsync(0);
		connection.sendToPeer('remote-device', { type: 'media-offer' } as TypedP2PMessage);
		connection.sendToPeer('remote-device', { type: 'typing' } as TypedP2PMessage);
		await vi.advanceTimersByTimeAsync(0);
		expect(pc.channels[0].send).not.toHaveBeenCalled();
		expect(pc.channels[1].send).toHaveBeenCalledExactlyOnceWith('{"type":"typing"}');
		finish('{"type":"rekey-grant"}');
		await mint;
		await vi.advanceTimersByTimeAsync(0);
		expect(pc.channels[0].send.mock.calls.map(([wire]) => JSON.parse(wire).type)).toEqual([
			'rekey-grant',
			'media-offer'
		]);
	});

	test('disconnect cancels a pending grant and reliable bodies queued behind it', async () => {
		const pc = await join();
		await verify(pc);
		pc.channels[0].send.mockClear();
		let finish!: (wire: string) => void;
		session.grantWireFor.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
		const grant = connection.broadcastGrant();
		await vi.advanceTimersByTimeAsync(0);
		connection.sendToPeer('remote-device', { type: 'media-offer' } as TypedP2PMessage);
		connection.disconnect();
		finish('{"type":"rekey-grant"}');
		await grant;
		await vi.advanceTimersByTimeAsync(0);
		expect(pc.channels[0].send).not.toHaveBeenCalled();
		expect(session.sealMessage).not.toHaveBeenCalled();
	});

	test('receive queue has a count limit and drops pending work on teardown', async () => {
		const pc = await join();
		await verify(pc);
		const message = vi.fn();
		connection.onMessage(message);
		let finish!: (body: { type: string; text: string }) => void;
		session.openMessage.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
		pc.channels[0].onmessage?.({ data: '{}' });
		const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			for (let i = 0; i < 513; i++) pc.channels[0].onmessage?.({ data: '{}' });
			expect(connection.getDirectPeers()).toEqual([]);
			expect(pc.connectionState).toBe('closed');
			finish({ type: 'media-offer', text: 'late' });
			await vi.advanceTimersByTimeAsync(0);
			expect(session.openMessage).toHaveBeenCalledTimes(1);
			expect(message).not.toHaveBeenCalled();
		} finally {
			warning.mockRestore();
		}
	});

	test('receive queue rejects an oversized frame before crypto work', async () => {
		const pc = await join();
		await verify(pc);
		const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			pc.channels[0].onmessage?.({ data: 'x'.repeat(32 * 1024 * 1024 + 1) });
			expect(pc.connectionState).toBe('closed');
			expect(session.openMessage).not.toHaveBeenCalled();
		} finally {
			warning.mockRestore();
		}
	});

	test('a failed recipient does not prevent broadcast delivery to healthy peers', async () => {
		await socket.receive({ type: 'room-joined', yourId: 'local', peers: ['first', 'second'] });
		const [first, second] = FakePeerConnection.instances;
		session.acceptHello.mockResolvedValueOnce({ ...hello, deviceId: 'first-device' });
		await verify(first);
		session.acceptHello.mockResolvedValueOnce({ ...hello, deviceId: 'second-device' });
		await verify(second);
		second.channels[0].send.mockClear();
		first.channels[0].send.mockImplementationOnce(() => {
			throw new Error('send buffer full');
		});
		const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			connection.broadcast({ type: 'chat' } as TypedP2PMessage);
			await vi.advanceTimersByTimeAsync(0);
			expect(second.channels[0].send).toHaveBeenCalledExactlyOnceWith('{"type":"chat"}');
		} finally {
			warning.mockRestore();
		}
	});

	test('awaiting reliable sends preserves every page of a 500-page history', async () => {
		const pc = await join();
		await verify(pc);
		pc.channels[0].send.mockClear();
		const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			for (let page = 0; page < 500; page++) {
				await connection.sendToPeer('remote-device', {
					type: 'sync-response',
					roomId: 'room',
					messages: [],
					timestamp: page
				});
			}
			await vi.advanceTimersByTimeAsync(0);
			expect(pc.channels[0].send).toHaveBeenCalledTimes(500);
			expect(warning).not.toHaveBeenCalled();
		} finally {
			warning.mockRestore();
		}
	});

	test('real crypto consumes a delayed grant before its media body and still rejects replay', async () => {
		vi.useRealTimers();
		vi.stubGlobal('indexedDB', new IDBFactory());
		const key = createRoomKey();
		const sender = await CryptoSession.create('real-crypto', key);
		const receiver = await CryptoSession.create('real-crypto', key);
		const binding = { label: 'hello-v4' as const, fields: ['', ''] };
		await sender.acceptHello(await receiver.makeHello('Receiver', binding), binding);
		connection.disconnect();
		connection = new P2PConnection(receiver, {}, () => 'Receiver');
		const connecting = connection.connect();
		socket = FakeSocket.instance;
		socket.onopen?.();
		await connecting;
		socket.onmessage?.({
			data: JSON.stringify({ type: 'room-joined', yourId: 'local', peers: ['remote'] })
		});
		await vi.waitFor(() => expect(FakePeerConnection.instances).toHaveLength(1));
		const pc = FakePeerConnection.instances.at(-1)!;
		const connected = vi.fn();
		connection.onPeerConnected(connected);
		pc.channels[0].onmessage?.({ data: await sender.makeHello('Sender', binding) });
		await vi.waitFor(() => expect(connected).toHaveBeenCalled());
		await sender.mintGeneration();
		const grant = await sender.grantWireFor(receiver.deviceId, 0);
		const wire = await sender.sealMessage({ type: 'media-offer', transferId: 'real-transfer' });
		let release!: () => void;
		const gate = new Promise<void>((resolve) => (release = resolve));
		const adopt = receiver.handleRekeyGrant.bind(receiver);
		vi.spyOn(receiver, 'handleRekeyGrant').mockImplementationOnce(async (body) => {
			await gate;
			return adopt(body);
		});
		const message = vi.fn();
		connection.onMessage(message);
		pc.channels[0].onmessage?.({ data: grant });
		pc.channels[0].onmessage?.({ data: wire });
		await vi.waitFor(() => expect(receiver.handleRekeyGrant).toHaveBeenCalled());
		expect(message).not.toHaveBeenCalled();
		release();
		await vi.waitFor(() => expect(message).toHaveBeenCalledTimes(1));
		expect(message).toHaveBeenCalledWith(
			expect.objectContaining({ type: 'media-offer', transferId: 'real-transfer' }),
			sender.deviceId
		);
		const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			pc.channels[0].onmessage?.({ data: wire });
			await vi.waitFor(() => expect(warning).toHaveBeenCalled());
			expect(String(warning.mock.calls[0][1])).toMatch(/replayed envelope/);
			expect(message).toHaveBeenCalledTimes(1);
		} finally {
			warning.mockRestore();
		}
	});

	test('a slow receiver retains a full 500-page history burst until crypto catches up', async () => {
		const pc = await join();
		await verify(pc);
		const message = vi.fn();
		connection.onMessage(message);
		let finish!: (body: { type: string; text: string }) => void;
		session.openMessage.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
		pc.channels[0].onmessage?.({ data: '{}' });
		const page = JSON.stringify({ t: 'msg', g: 1, c: 'x'.repeat(48 * 1024) });
		for (let i = 0; i < 500; i++) pc.channels[0].onmessage?.({ data: page });
		expect(connection.getDirectPeers()).toEqual(['remote-device']);
		finish({ type: 'sync-response', text: 'first page' });
		await vi.advanceTimersByTimeAsync(0);
		expect(message).toHaveBeenCalledTimes(501);
	});

	test.each(['closed', 'send error'])(
		'eligible chat still uses a verified relay when direct has %s',
		async (failure) => {
			const pc = await join();
			await verify(pc);
			await socket.receive({ type: 'relay', fromId: 'remote', data: { hello: '{}' } });
			socket.send.mockClear();
			if (failure === 'closed') pc.channels[0].close();
			else
				pc.channels[0].send.mockImplementationOnce(() => {
					throw new Error('send buffer full');
				});
			const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
			try {
				await connection.sendToPeer('remote-device', { type: 'chat' } as TypedP2PMessage);
				expect(socket.send).toHaveBeenCalledTimes(1);
				expect(JSON.parse(socket.send.mock.calls[0][0])).toMatchObject({
					type: 'relay',
					targetId: 'remote'
				});
			} finally {
				warning.mockRestore();
			}
		}
	);

	test('direct send failure never relays a media offer', async () => {
		const pc = await join();
		await verify(pc);
		await socket.receive({ type: 'relay', fromId: 'remote', data: { hello: '{}' } });
		socket.send.mockClear();
		pc.channels[0].send.mockImplementationOnce(() => {
			throw new Error('send buffer full');
		});
		const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			await connection.sendToPeer('remote-device', { type: 'media-offer' } as TypedP2PMessage);
			expect(socket.send).not.toHaveBeenCalled();
		} finally {
			warning.mockRestore();
		}
	});

	test('a candidate cannot overtake authentication of the preceding offer', async () => {
		let finish!: (valid: boolean) => void;
		session.verifySignalingAuth.mockImplementationOnce(
			() => new Promise((resolve) => (finish = resolve))
		);
		const auth = { deviceId: 'remote-device', hmac: 'valid' };
		await socket.receive({
			type: 'offer',
			fromId: 'remote',
			data: { auth, description: { type: 'offer', sdp: '' } }
		});
		await socket.receive({
			type: 'ice-candidate',
			fromId: 'remote',
			data: { auth, candidate: { candidate: 'host-candidate' } }
		});
		finish(true);
		await vi.advanceTimersByTimeAsync(0);
		expect(FakePeerConnection.instances).toHaveLength(1);
		expect(FakePeerConnection.instances[0].addIceCandidate).toHaveBeenCalledExactlyOnceWith({
			candidate: 'host-candidate'
		});
	});

	test('same-device tabs have complementary roles when their local offers collide', async () => {
		const left = await join();
		left.signalingState = 'have-local-offer';
		const other = new P2PConnection(session as unknown as CryptoSession, {}, () => 'Other tab');
		const opening = other.connect();
		const otherSocket = FakeSocket.instance;
		otherSocket.onopen?.();
		await opening;
		try {
			await otherSocket.receive({ type: 'room-joined', yourId: 'remote', peers: ['local'] });
			const right = FakePeerConnection.instances.at(-1)!;
			right.signalingState = 'have-local-offer';
			const data = {
				auth: { deviceId: session.deviceId, hmac: 'valid' },
				description: { type: 'offer', sdp: '' }
			};
			await socket.receive({ type: 'offer', fromId: 'remote', data });
			await otherSocket.receive({ type: 'offer', fromId: 'local', data });
			expect(
				left.setRemoteDescription.mock.calls.length + right.setRemoteDescription.mock.calls.length
			).toBe(1);
			expect(session.verifySignalingAuth).toHaveBeenCalledTimes(2);
		} finally {
			other.disconnect();
		}
	});

	test('disconnect cancels authentication and signaling queued behind it', async () => {
		let finish!: (valid: boolean) => void;
		session.verifySignalingAuth.mockImplementationOnce(
			() => new Promise((resolve) => (finish = resolve))
		);
		const data = {
			auth: { deviceId: 'remote-device', hmac: 'valid' },
			description: { type: 'offer', sdp: '' }
		};
		await socket.receive({ type: 'offer', fromId: 'remote', data });
		await socket.receive({ type: 'offer', fromId: 'another', data });
		connection.disconnect();
		finish(true);
		await vi.advanceTimersByTimeAsync(0);
		expect(FakePeerConnection.instances).toHaveLength(0);
		expect(session.verifySignalingAuth).toHaveBeenCalledTimes(1);
	});

	test('authentication from an obsolete socket cannot act on a newly joined peer', async () => {
		let finish!: (valid: boolean) => void;
		session.verifySignalingAuth.mockImplementationOnce(
			() => new Promise((resolve) => (finish = resolve))
		);
		await socket.receive({
			type: 'offer',
			fromId: 'remote',
			data: {
				auth: { deviceId: 'remote-device', hmac: 'valid' },
				description: { type: 'offer', sdp: '' }
			}
		});
		socket.close();
		const reconnecting = connection.reconnectSignaling();
		socket = FakeSocket.instance;
		socket.onopen?.();
		await reconnecting;
		const replacement = await join();
		finish(true);
		await vi.advanceTimersByTimeAsync(0);
		expect(FakePeerConnection.instances).toHaveLength(1);
		expect(replacement.setRemoteDescription).not.toHaveBeenCalled();
	});

	test('queued candidates still require authentication', async () => {
		const pc = await join();
		const data = {
			auth: { deviceId: 'remote-device', hmac: 'valid' },
			candidate: { candidate: 'host-candidate' }
		};
		session.verifySignalingAuth.mockResolvedValueOnce(false);
		await socket.receive({ type: 'ice-candidate', fromId: 'remote', data });
		expect(pc.addIceCandidate).not.toHaveBeenCalled();
		await socket.receive({ type: 'ice-candidate', fromId: 'remote', data });
		expect(pc.addIceCandidate).toHaveBeenCalledExactlyOnceWith(data.candidate);
		expect(session.verifySignalingAuth).toHaveBeenCalledTimes(2);
	});

	test('signaling overflow closes its socket without disrupting an established direct peer', async () => {
		const pc = await join();
		await verify(pc);
		let finish!: (valid: boolean) => void;
		session.verifySignalingAuth.mockImplementationOnce(
			() => new Promise((resolve) => (finish = resolve))
		);
		const data = {
			auth: { deviceId: 'new-device', hmac: 'valid' },
			description: { type: 'offer', sdp: '' }
		};
		await socket.receive({ type: 'offer', fromId: 'new-remote', data });
		const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			for (let i = 0; i < 128; i++)
				socket.onmessage?.({ data: JSON.stringify({ type: 'offer', fromId: 'new-remote', data }) });
			expect(connection.isWebSocketConnected()).toBe(false);
			expect(connection.getDirectPeers()).toEqual(['remote-device']);
			finish(true);
			await vi.advanceTimersByTimeAsync(0);
			expect(FakePeerConnection.instances).toHaveLength(1);
		} finally {
			warning.mockRestore();
		}
	});

	test('outgoing candidate authentication cannot put ICE ahead of its local offer', async () => {
		const pc = await join();
		socket.send.mockClear();
		let finish!: (auth: string) => void;
		session.signalingAuth.mockImplementationOnce(
			() => new Promise((resolve) => (finish = resolve))
		);
		const offer = pc.onnegotiationneeded?.();
		await vi.advanceTimersByTimeAsync(0);
		const candidate = pc.onicecandidate?.({
			candidate: { toJSON: () => ({ candidate: 'host-candidate' }) }
		});
		await vi.advanceTimersByTimeAsync(0);
		finish('auth');
		await Promise.all([offer, candidate]);
		await vi.advanceTimersByTimeAsync(100);
		expect(socket.send.mock.calls.map(([wire]) => JSON.parse(wire).type)).toEqual([
			'offer',
			'ice-candidate'
		]);
	});

	test('different device IDs keep their original collision ordering', async () => {
		session.deviceId = 'z-device';
		const pc = await join();
		pc.signalingState = 'have-local-offer';
		await socket.receive({
			type: 'offer',
			fromId: 'remote',
			data: {
				auth: { deviceId: 'a-device', hmac: 'valid' },
				description: { type: 'offer', sdp: '' }
			}
		});
		// Our clientId sorts first, but the distinct deviceId remains the authority.
		expect(pc.setRemoteDescription).not.toHaveBeenCalled();
		expect(session.verifySignalingAuth).toHaveBeenCalledExactlyOnceWith(
			'a-device',
			'remote',
			'valid'
		);
	});

	test('a rejected offer cannot create a peer or poison later authenticated signaling', async () => {
		session.verifySignalingAuth.mockResolvedValueOnce(false);
		const offer = {
			type: 'offer',
			fromId: 'remote',
			data: {
				auth: { deviceId: 'remote-device', hmac: 'valid' },
				description: { type: 'offer', sdp: '' }
			}
		};
		const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			await socket.receive(offer);
			expect(FakePeerConnection.instances).toHaveLength(0);
			await socket.receive(offer);
			expect(FakePeerConnection.instances).toHaveLength(1);
			expect(FakePeerConnection.instances[0].setRemoteDescription).toHaveBeenCalledTimes(1);
		} finally {
			warning.mockRestore();
		}
	});

	test('oversized signaling is rejected before authentication', async () => {
		const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			socket.onmessage?.({ data: 'x'.repeat(2 * 1024 * 1024 + 1) });
			await vi.advanceTimersByTimeAsync(0);
			expect(connection.isWebSocketConnected()).toBe(false);
			expect(session.verifySignalingAuth).not.toHaveBeenCalled();
		} finally {
			warning.mockRestore();
		}
	});
});
