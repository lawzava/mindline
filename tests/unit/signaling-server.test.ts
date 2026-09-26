import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';
import WebSocket from 'ws';

// Runs the real signaling-server.js in a child process, with Cloudflare's TURN
// API stubbed through a preloaded fetch, to pin the wire-level behavior the
// deployed client (src/lib/p2p/connection.ts) depends on.

const TURN = [{ urls: ['turn:turn.test:3478'], username: 'u', credential: 'c' }];
const FETCH_STUB = `data:text/javascript,globalThis.fetch=async()=>new Response(${encodeURIComponent(
	JSON.stringify(JSON.stringify({ iceServers: TURN }))
)},{status:201});`;

type Message = { type: string; [key: string]: unknown };

let server: ChildProcess;
let serverOutput = ''; // stdout + stderr, i.e. what an operator's logs hold
let url = '';
let nextIp = 1;
const sockets: WebSocket[] = [];

async function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const probe = createServer();
		probe.once('error', reject);
		probe.listen(0, '127.0.0.1', () => {
			const address = probe.address();
			probe.close(() => resolve(typeof address === 'object' && address ? address.port : 0));
		});
	});
}

/** A client with its own (legacy-trusted) cf-connecting-ip unless one is given. */
function connect(ip = `198.51.100.${nextIp++}`) {
	const ws = new WebSocket(url, { headers: { 'cf-connecting-ip': ip } });
	sockets.push(ws);
	const received: Message[] = [];
	const log: Message[] = []; // everything, in arrival order (never consumed)
	const waiters: Array<() => void> = [];
	ws.on('message', (raw) => {
		const message = JSON.parse(raw.toString());
		received.push(message);
		log.push(message);
		waiters.splice(0).forEach((wake) => wake());
	});
	const opened = new Promise<void>((resolve) => ws.once('open', () => resolve()));
	const closed = new Promise<number>((resolve) => ws.on('close', (code) => resolve(code)));

	async function next(type: string): Promise<Message> {
		for (;;) {
			const index = received.findIndex((m) => m.type === type);
			if (index >= 0) return received.splice(0, index + 1).pop()!;
			await new Promise<void>((resolve) => waiters.push(resolve));
		}
	}

	return {
		ws,
		received,
		log,
		closed,
		next,
		send: async (message: object) => {
			await opened;
			ws.send(JSON.stringify(message));
		}
	};
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

beforeAll(async () => {
	const port = await freePort();
	url = `ws://127.0.0.1:${port}/ws`;
	server = spawn(process.execPath, ['--import', FETCH_STUB, 'signaling-server.js'], {
		cwd: path.resolve(__dirname, '../..'),
		env: {
			...process.env,
			PORT: String(port),
			HOST: '127.0.0.1',
			NODE_ENV: 'test',
			CF_TURN_TOKEN_ID: 'stub-id',
			CF_TURN_API_TOKEN: 'stub-token',
			MAX_CONNECTIONS_PER_IP: '3',
			MAX_ROOM_MEMBERS: '2',
			RATE_LIMIT_CONNECTION_ATTEMPTS_PER_MINUTE: '1000',
			TRUSTED_PROXY_HEADER: '',
			TRUSTED_PROXY_CIDRS: ''
		},
		stdio: ['ignore', 'pipe', 'pipe']
	});
	server.stdout!.on('data', (chunk) => (serverOutput += String(chunk)));
	server.stderr!.on('data', (chunk) => (serverOutput += String(chunk)));
	await new Promise<void>((resolve, reject) => {
		server.once('exit', (code) => reject(new Error(`signaling server exited: ${code}`)));
		server.stdout!.on('data', (chunk) => {
			if (String(chunk).includes('Ready for connections')) resolve();
		});
	});
	await settle(); // let the stubbed startup TURN mint land
});

afterAll(() => {
	sockets.forEach((ws) => ws.terminate());
	server?.kill();
});

describe('signaling server', () => {
	test('TURN credentials go only to sockets that share a room with a peer', async () => {
		const alice = connect();
		expect(await alice.next('client-id')).toMatchObject({ iceServers: [] });
		alice.send({ type: 'join', roomId: 'turn-room' });
		await alice.next('room-joined');

		const bob = connect();
		const bobWelcome = await bob.next('client-id');
		expect(bobWelcome.iceServers).toEqual([]);
		bob.send({ type: 'join', roomId: 'turn-room' });
		await bob.next('room-joined');
		await alice.next('peer-joined');

		// Joiner: credentials arrive before room-joined, which builds its peers.
		expect(bob.log.map((m) => m.type)).toEqual(['client-id', 'client-id', 'room-joined']);
		expect(bob.log[1]).toEqual({
			type: 'client-id',
			clientId: bobWelcome.clientId,
			iceServers: TURN
		});
		// Existing member: credentials arrive before peer-joined; its id is unchanged.
		expect(alice.log.map((m) => m.type)).toEqual([
			'client-id',
			'room-joined',
			'client-id',
			'peer-joined'
		]);
		expect(alice.log[2]).toEqual({
			type: 'client-id',
			clientId: alice.log[0].clientId,
			iceServers: TURN
		});
	});

	test('a lone joiner never receives TURN', async () => {
		const solo = connect();
		await solo.next('client-id');
		solo.send({ type: 'join', roomId: 'solo-room' });
		await solo.next('room-joined');
		await settle();
		expect(solo.received.some((m) => m.type === 'client-id')).toBe(false);
	});

	test('a full room rejects newcomers with the existing error shape', async () => {
		const members = [connect(), connect()];
		for (const member of members) {
			member.send({ type: 'join', roomId: 'full-room' });
			await member.next('room-joined');
		}
		const late = connect();
		late.send({ type: 'join', roomId: 'full-room' });
		expect(await late.next('error')).toEqual({ type: 'error', message: 'Room is full.' });
		await settle();
		// The first member saw the second arrive, and nobody else.
		expect(members[0].log.filter((m) => m.type === 'peer-joined')).toHaveLength(1);
	});

	test('one IP cannot exceed its concurrent connection cap', async () => {
		const ip = '203.0.113.77';
		const allowed = [connect(ip), connect(ip), connect(ip)];
		await Promise.all(allowed.map((client) => client.next('client-id')));
		const rejected = connect(ip);
		expect(await rejected.closed).toBe(1013);

		// Closing one frees a slot.
		allowed[0].ws.close();
		await allowed[0].closed;
		await settle();
		expect(await connect(ip).next('client-id')).toMatchObject({ type: 'client-id' });
	});

	test('after leave, a socket can no longer relay into the room', async () => {
		const stay = connect();
		const leaver = connect();
		stay.send({ type: 'join', roomId: 'leave-room' });
		await stay.next('room-joined');
		leaver.send({ type: 'join', roomId: 'leave-room' });
		await leaver.next('room-joined');

		await leaver.send({ type: 'leave' });
		await stay.next('peer-left');
		await leaver.send({ type: 'relay', data: { probe: true } });
		await settle();
		leaver.ws.close();
		await leaver.closed;
		await settle();
		expect(stay.received.filter((m) => m.type === 'relay')).toEqual([]);
		// Closing after leave does not announce the departure twice.
		expect(stay.received.filter((m) => m.type === 'peer-left')).toEqual([]);
	});

	test('malformed frames count against the message rate limit', async () => {
		const flooder = connect();
		await flooder.next('client-id');
		for (let i = 0; i < 60; i++) flooder.ws.send('not json');
		await settle();
		const errors = flooder.received.filter((m) => m.type === 'error');
		expect(errors.some((m) => String(m.message).startsWith('Rate limit exceeded'))).toBe(true);
	});

	// The rendezvous id is the only thing a socket needs to join a signaling
	// room, so a log reader holding it could watch presence and fill the
	// member cap. Logs may say that a join happened, never which room.
	test('joining never writes the room id to the logs', async () => {
		const roomId = 'rv-7f3a9c2e5b1d4f60a8e2c9b7d3f1a5e4';
		const member = connect();
		member.send({ type: 'join', roomId });
		await member.next('room-joined');
		await settle();
		expect(serverOutput).toContain('joined');
		expect(serverOutput).not.toContain(roomId);
		expect(serverOutput).not.toContain(roomId.slice(0, 12));
	});

	// The legacy XSS auditor it switches on is gone from current browsers and
	// was itself a cross-site leak vector; CSP default-src 'none' covers this.
	test('HTTP responses do not enable the legacy XSS auditor', async () => {
		const response = await fetch(url.replace('ws://', 'http://').replace(/\/ws$/, '/health'));
		expect(response.status).toBe(200);
		expect(response.headers.get('x-xss-protection')).toBeNull();
		expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
	});
});

/**
 * A second server as a production deploy that set nothing beyond
 * NODE_ENV runs it. Resolves ready=false if it refuses to start.
 */
async function startBareProduction(extra: Record<string, string> = {}) {
	const port = await freePort();
	const env: NodeJS.ProcessEnv = { ...process.env, PORT: String(port), HOST: '127.0.0.1' };
	for (const name of ['ALLOWED_ORIGINS', 'TRUSTED_PROXY_HEADER', 'TRUSTED_PROXY_CIDRS']) {
		delete env[name];
	}
	Object.assign(
		env,
		{ NODE_ENV: 'production', CF_TURN_TOKEN_ID: '', CF_TURN_API_TOKEN: '' },
		extra
	);
	const child = spawn(process.execPath, ['signaling-server.js'], {
		cwd: path.resolve(__dirname, '../..'),
		env,
		stdio: ['ignore', 'pipe', 'pipe']
	});
	const ready = await new Promise<boolean>((resolve) => {
		child.once('exit', () => resolve(false));
		child.stdout!.on('data', (chunk) => {
			if (String(chunk).includes('Ready for connections')) resolve(true);
		});
	});
	return { child, ready, url: `ws://127.0.0.1:${port}/ws` };
}

/** Close code, or 'refused' when the upgrade itself is rejected. */
function outcome(ws: WebSocket, windowMs = 400): Promise<number | 'open' | 'refused'> {
	return new Promise((resolve) => {
		ws.once('unexpected-response', () => resolve('refused'));
		ws.once('error', () => resolve('refused'));
		ws.once('close', (code) => resolve(code));
		ws.once('open', () => setTimeout(() => resolve('open'), windowMs));
	});
}

describe('signaling server, production with defaults', () => {
	// OPEN (audit D56/H07): with ALLOWED_ORIGINS unset the allowlist falls
	// back to localhost dev origins even under NODE_ENV=production. Flip to
	// test() once production defaults to no origins or refuses to start.
	test.fails('a localhost page cannot open a socket', async () => {
		const prod = await startBareProduction({ ALLOWED_ORIGINS: '' });
		try {
			if (!prod.ready) return; // refusing to start is an acceptable fix
			const ws = new WebSocket(prod.url, { headers: { origin: 'http://localhost:5173' } });
			const result = await outcome(ws);
			ws.terminate();
			expect(result).toBe('refused');
		} finally {
			prod.child.kill();
		}
	});

	// OPEN (audit D51/H11/P09): with no trusted-proxy settings the server
	// believes cf-connecting-ip / x-forwarded-for from any peer, so one host
	// that reaches the origin directly rotates a fake header per socket and
	// never meets the per-IP cap. Flip to test() once production falls back
	// to the socket address unless TRUSTED_PROXY_CIDRS is set.
	test.fails('spoofed client-IP headers do not lift the per-IP cap', async () => {
		const prod = await startBareProduction({
			ALLOWED_ORIGINS: 'https://mindline.chat',
			MAX_CONNECTIONS_PER_IP: '3'
		});
		const opened: WebSocket[] = [];
		try {
			if (!prod.ready) return;
			const results = [];
			for (let i = 1; i <= 4; i++) {
				const ws = new WebSocket(prod.url, { headers: { 'cf-connecting-ip': `203.0.113.${i}` } });
				opened.push(ws);
				results.push(await outcome(ws));
			}
			expect(results.slice(0, 3)).toEqual(['open', 'open', 'open']);
			expect(results[3]).toBe(1013);
		} finally {
			opened.forEach((ws) => ws.terminate());
			prod.child.kill();
		}
	});
});
