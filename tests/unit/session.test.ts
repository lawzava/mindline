import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, test } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { CryptoSession } from '$lib/p2p/crypto-session';
import { createRoomKey } from '$lib/crypto/keys';

beforeEach(() => {
	indexedDB = new IDBFactory();
});

async function twoSessions(roomId = 'room-1') {
	const key = createRoomKey();
	const a = await CryptoSession.create(roomId, key);
	const b = await CryptoSession.create(roomId, key);
	return { a, b };
}

describe('CryptoSession', () => {
	test('hello exchange verifies and registers the peer', async () => {
		const { a, b } = await twoSessions();
		const binding = 'AA:BB::CC:DD';
		const hello = await a.makeHello('Alice', binding);
		const result = await b.acceptHello(hello, binding);
		expect(result).not.toBeNull();
		expect(result!.deviceId).toBe(a.deviceId);
		expect(result!.name).toBe('Alice');
		expect(b.isVerified(a.deviceId)).toBe(true);
	});

	test('hello replayed onto a different channel binding is rejected', async () => {
		const { a, b } = await twoSessions();
		const hello = await a.makeHello('Alice', 'binding-one');
		expect(await b.acceptHello(hello, 'binding-two')).toBeNull();
		expect(b.isVerified(a.deviceId)).toBe(false);
	});

	test('hello from a different room key is rejected', async () => {
		const a = await CryptoSession.create('room-1', createRoomKey());
		const b = await CryptoSession.create('room-1', createRoomKey());
		const hello = await a.makeHello('Alice', 'bind');
		expect(await b.acceptHello(hello, 'bind')).toBeNull();
	});

	test('messages round-trip between verified peers', async () => {
		const { a, b } = await twoSessions();
		await b.acceptHello(await a.makeHello('Alice', 'bind'), 'bind');
		const wire = await a.sealMessage({ type: 'chat', content: 'hi', messageId: 'm1' });
		const body = await b.openMessage(JSON.parse(wire));
		expect(body).toMatchObject({ type: 'chat', content: 'hi', messageId: 'm1' });
	});

	test('messages from unverified senders are rejected', async () => {
		const { a, b } = await twoSessions();
		const wire = await a.sealMessage({ type: 'chat', content: 'hi', messageId: 'm1' });
		await expect(b.openMessage(JSON.parse(wire))).rejects.toThrow(/unverified/i);
	});

	test('replayed message envelopes are rejected', async () => {
		const { a, b } = await twoSessions();
		await b.acceptHello(await a.makeHello('Alice', 'bind'), 'bind');
		const wire = await a.sealMessage({ type: 'chat', content: 'hi', messageId: 'm1' });
		await b.openMessage(JSON.parse(wire));
		await expect(b.openMessage(JSON.parse(wire))).rejects.toThrow(/replay/i);
	});

	test('drafts seal under eph class and round-trip without verification', async () => {
		const { a, b } = await twoSessions();
		// drafts arrive before hello sometimes; they carry no authority
		const wire = await a.sealDraft({ type: 'typing', content: 'par' });
		const body = await b.openMessage(JSON.parse(wire));
		expect(body).toMatchObject({ type: 'typing', content: 'par' });
	});

	test('signaling auth tags verify per sender and clientId', async () => {
		const { a, b } = await twoSessions();
		const tag = await a.signalingAuth('client-123');
		expect(await b.verifySignalingAuth(a.deviceId, 'client-123', tag)).toBe(true);
		expect(await b.verifySignalingAuth(a.deviceId, 'client-999', tag)).toBe(false);
		expect(await b.verifySignalingAuth('other-device', 'client-123', tag)).toBe(false);
	});

	test('session persists keys; a second create for the same room reuses them', async () => {
		const key = createRoomKey();
		const s1 = await CryptoSession.create('room-1', key);
		// no fragment this time: loads from keystore
		const s2 = await CryptoSession.create('room-1', null);
		expect(s2).not.toBeNull();
		// same room keys: s2 can decrypt s1's envelopes once verified
		await s2!.acceptHello(await s1.makeHello('A', 'bind'), 'bind');
		const wire = await s1.sealMessage({ type: 'chat', content: 'x', messageId: 'm1' });
		const body = await s2!.openMessage(JSON.parse(wire));
		expect(body).toMatchObject({ content: 'x' });
	});

	test('create returns null when no fragment and no stored keys (knocking)', async () => {
		expect(await CryptoSession.create('unknown-room', null)).toBeNull();
	});
});
