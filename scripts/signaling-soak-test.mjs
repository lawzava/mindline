#!/usr/bin/env node

import WebSocket from 'ws';
import { randomUUID } from 'node:crypto';

function readArg(name, fallback) {
	const raw = process.argv.find((arg) => arg.startsWith(`--${name}=`));
	if (!raw) return fallback;
	return raw.slice(name.length + 3);
}

function readIntArg(name, fallback) {
	const value = Number.parseInt(readArg(name, `${fallback}`), 10);
	return Number.isFinite(value) ? value : fallback;
}

function readFloatArg(name, fallback) {
	const value = Number.parseFloat(readArg(name, `${fallback}`));
	return Number.isFinite(value) ? value : fallback;
}

const config = {
	url: readArg('url', 'ws://localhost:3000/ws'),
	clients: readIntArg('clients', 100),
	rooms: readIntArg('rooms', 10),
	durationSec: readIntArg('durationSec', 60),
	rampMs: readIntArg('rampMs', 75),
	sendEveryMs: readIntArg('sendEveryMs', 2000),
	minJoinRate: readFloatArg('minJoinRate', 0.9),
	minReceivedPerSent: readFloatArg('minReceivedPerSent', 0.9),
	maxSocketErrorRate: readFloatArg('maxSocketErrorRate', 0.05),
	maxServerErrors: readIntArg('maxServerErrors', 0)
};

const metrics = {
	opened: 0,
	joined: 0,
	joinErrors: 0,
	messagesSent: 0,
	messagesReceived: 0,
	serverErrors: 0,
	socketErrors: 0,
	closed: 0
};

const clients = [];
const sendTimers = [];

function newPayload(clientId, roomId) {
	return {
		type: 'chat',
		content: `soak-${clientId.slice(0, 6)}-${Date.now()}`,
		senderId: clientId,
		senderName: 'SoakBot',
		messageId: randomUUID(),
		timestamp: Date.now(),
		roomId
	};
}

function createClient(index) {
	const roomId = `soak-room-${index % config.rooms}`;
	const localClientId = randomUUID();
	const ws = new WebSocket(config.url);

	const state = {
		localClientId,
		roomId,
		joined: false,
		ws
	};
	clients.push(state);

	ws.on('open', () => {
		metrics.opened++;
		ws.send(
			JSON.stringify({
				type: 'join',
				roomId,
				clientId: localClientId
			})
		);
	});

	ws.on('message', (raw) => {
		try {
			const msg = JSON.parse(raw.toString());
			if (msg.type === 'room-joined') {
				if (!state.joined) {
					state.joined = true;
					metrics.joined++;
				}
				const timer = setInterval(() => {
					if (ws.readyState !== WebSocket.OPEN) return;
					ws.send(
						JSON.stringify({
							type: 'relay',
							data: newPayload(localClientId, roomId)
						})
					);
					metrics.messagesSent++;
				}, config.sendEveryMs);
				sendTimers.push(timer);
			} else if (msg.type === 'relay') {
				metrics.messagesReceived++;
			} else if (msg.type === 'error') {
				metrics.serverErrors++;
				if (typeof msg.message === 'string' && msg.message.toLowerCase().includes('join')) {
					metrics.joinErrors++;
				}
			}
		} catch {
			metrics.socketErrors++;
		}
	});

	ws.on('error', () => {
		metrics.socketErrors++;
	});

	ws.on('close', () => {
		metrics.closed++;
	});
}

async function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
	console.log('[soak] config:', JSON.stringify(config));

	for (let i = 0; i < config.clients; i++) {
		createClient(i);
		await sleep(config.rampMs);
	}

	await sleep(config.durationSec * 1000);

	sendTimers.forEach((timer) => clearInterval(timer));
	for (const client of clients) {
		if (client.ws.readyState === WebSocket.OPEN) {
			client.ws.close();
		}
	}

	await sleep(1000);

	const summary = {
		...metrics,
		joinRate: config.clients > 0 ? metrics.joined / config.clients : 0,
		receivedPerSent: metrics.messagesSent > 0 ? metrics.messagesReceived / metrics.messagesSent : 0,
		socketErrorRate: config.clients > 0 ? metrics.socketErrors / config.clients : 0
	};
	console.log('[soak] summary:', JSON.stringify(summary, null, 2));

	const failures = [];
	if (summary.joinRate < config.minJoinRate) {
		failures.push(
			`joinRate ${summary.joinRate.toFixed(4)} < minJoinRate ${config.minJoinRate.toFixed(4)}`
		);
	}
	if (summary.receivedPerSent < config.minReceivedPerSent) {
		failures.push(
			`receivedPerSent ${summary.receivedPerSent.toFixed(4)} < minReceivedPerSent ${config.minReceivedPerSent.toFixed(4)}`
		);
	}
	if (summary.socketErrorRate > config.maxSocketErrorRate) {
		failures.push(
			`socketErrorRate ${summary.socketErrorRate.toFixed(4)} > maxSocketErrorRate ${config.maxSocketErrorRate.toFixed(4)}`
		);
	}
	if (metrics.serverErrors > config.maxServerErrors) {
		failures.push(`serverErrors ${metrics.serverErrors} > maxServerErrors ${config.maxServerErrors}`);
	}

	if (failures.length > 0) {
		for (const failure of failures) {
			console.error(`[soak] FAIL: ${failure}`);
		}
		process.exit(1);
	}

	console.log('[soak] PASS');
}

main().catch((error) => {
	console.error('[soak] fatal error:', error);
	process.exit(1);
});
