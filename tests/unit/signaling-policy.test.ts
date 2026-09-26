import { describe, expect, test } from 'vitest';
// Plain ESM module imported by the signaling server (signaling-server.js).
import {
	clientLimitKey,
	createConnectionCounter,
	normalizeIp,
	parseTrustedProxyConfig,
	resolveClientIp,
	roomHasSpace,
	turnCredentialRecipients
} from '../../signaling-policy.js';

describe('normalizeIp', () => {
	test('accepts IPv4/IPv6 and unwraps IPv4-mapped IPv6', () => {
		expect(normalizeIp(' 203.0.113.7 ')).toBe('203.0.113.7');
		expect(normalizeIp('::ffff:203.0.113.7')).toBe('203.0.113.7');
		expect(normalizeIp('[2001:db8::1]')).toBe('2001:db8::1');
	});

	test('rejects anything that is not an address', () => {
		expect(normalizeIp('evil\nlog line')).toBeNull();
		expect(normalizeIp('')).toBeNull();
		expect(normalizeIp(undefined)).toBeNull();
	});
});

describe('resolveClientIp', () => {
	const legacy = parseTrustedProxyConfig(undefined, undefined);

	test('unset config keeps the legacy cf-connecting-ip → x-forwarded-for chain', () => {
		expect(legacy.headers).toEqual(['cf-connecting-ip', 'x-forwarded-for']);
		expect(legacy.trustAnyPeer).toBe(true);
		expect(
			resolveClientIp(
				{ 'cf-connecting-ip': '198.51.100.1', 'x-forwarded-for': '192.0.2.9' },
				'10.0.0.1',
				legacy
			)
		).toBe('198.51.100.1');
		expect(resolveClientIp({ 'x-forwarded-for': '192.0.2.9, 10.0.0.2' }, '10.0.0.1', legacy)).toBe(
			'192.0.2.9'
		);
		expect(resolveClientIp({}, '::ffff:10.0.0.1', legacy)).toBe('10.0.0.1');
	});

	test('a malformed header value falls back instead of becoming a limit key', () => {
		expect(resolveClientIp({ 'cf-connecting-ip': 'not-an-ip' }, '10.0.0.1', legacy)).toBe(
			'10.0.0.1'
		);
	});

	test('none ignores every header', () => {
		const config = parseTrustedProxyConfig('none', undefined);
		expect(config.headers).toEqual([]);
		expect(resolveClientIp({ 'cf-connecting-ip': '198.51.100.1' }, '10.0.0.1', config)).toBe(
			'10.0.0.1'
		);
	});

	test('only the configured header is trusted', () => {
		const config = parseTrustedProxyConfig('CF-Connecting-IP', undefined);
		expect(config.headers).toEqual(['cf-connecting-ip']);
		expect(resolveClientIp({ 'x-forwarded-for': '192.0.2.9' }, '10.0.0.1', config)).toBe(
			'10.0.0.1'
		);
	});

	test('with CIDRs, the header is honored only from peers inside them', () => {
		const config = parseTrustedProxyConfig('cf-connecting-ip', '173.245.48.0/20, 2400:cb00::/32');
		expect(config.cidrs).toEqual(['173.245.48.0/20', '2400:cb00::/32']);
		const headers = { 'cf-connecting-ip': '198.51.100.1' };
		expect(resolveClientIp(headers, '173.245.48.10', config)).toBe('198.51.100.1');
		expect(resolveClientIp(headers, '::ffff:173.245.48.10', config)).toBe('198.51.100.1');
		expect(resolveClientIp(headers, '2400:cb00::5', config)).toBe('198.51.100.1');
		// A direct connection spoofing the header gets its socket address.
		expect(resolveClientIp(headers, '192.0.2.50', config)).toBe('192.0.2.50');
	});

	test('with CIDRs, x-forwarded-for yields the right-most untrusted hop', () => {
		const config = parseTrustedProxyConfig('x-forwarded-for', '10.0.0.0/8');
		// Client-supplied first entry is ignored; the proxy appended the real one.
		expect(
			resolveClientIp({ 'x-forwarded-for': '1.1.1.1, 192.0.2.9, 10.0.0.3' }, '10.0.0.1', config)
		).toBe('192.0.2.9');
		expect(resolveClientIp({ 'x-forwarded-for': '10.0.0.3' }, '10.0.0.1', config)).toBe('10.0.0.3');
		expect(resolveClientIp({ 'x-forwarded-for': 'junk, 10.0.0.3' }, '10.0.0.1', config)).toBe(
			'10.0.0.1'
		);
	});

	test('CIDRs set but all invalid trusts no peer (fail closed)', () => {
		const config = parseTrustedProxyConfig('cf-connecting-ip', 'nonsense, 10.0.0.0/99');
		expect(config.trustAnyPeer).toBe(false);
		expect(config.invalidCidrs).toEqual(['nonsense', '10.0.0.0/99']);
		expect(resolveClientIp({ 'cf-connecting-ip': '198.51.100.1' }, '10.0.0.1', config)).toBe(
			'10.0.0.1'
		);
	});

	test('a bare address in CIDRs is a single host', () => {
		const config = parseTrustedProxyConfig('cf-connecting-ip', '127.0.0.1');
		const headers = { 'cf-connecting-ip': '198.51.100.1' };
		expect(resolveClientIp(headers, '127.0.0.1', config)).toBe('198.51.100.1');
		expect(resolveClientIp(headers, '127.0.0.2', config)).toBe('127.0.0.2');
	});
});

describe('clientLimitKey', () => {
	test('IPv4 is keyed per address', () => {
		expect(clientLimitKey('203.0.113.7')).toBe('203.0.113.7');
	});

	test('IPv6 is keyed per /64, so one host cannot rotate addresses past the cap', () => {
		const key = clientLimitKey('2001:db8:1:2::1');
		expect(key).toBe('2001:db8:1:2::/64');
		expect(clientLimitKey('2001:0db8:0001:0002:ffff:ffff:ffff:ffff')).toBe(key);
		expect(clientLimitKey('2001:db8:1:3::1')).not.toBe(key);
		expect(clientLimitKey('::1')).toBe('0:0:0:0::/64');
		expect(clientLimitKey('fe80::1%eth0')).toBe('fe80:0:0:0::/64');
	});

	test('non-address fallbacks pass through', () => {
		expect(clientLimitKey('unknown')).toBe('unknown');
	});
});

describe('createConnectionCounter', () => {
	test('caps concurrent slots per key and frees them on release', () => {
		const counter = createConnectionCounter(2);
		expect(counter.tryAcquire('a')).toBe(true);
		expect(counter.tryAcquire('a')).toBe(true);
		expect(counter.tryAcquire('a')).toBe(false);
		expect(counter.tryAcquire('b')).toBe(true);
		expect(counter.count('a')).toBe(2);

		counter.release('a');
		expect(counter.tryAcquire('a')).toBe(true);
	});

	test('drops keys with no live sockets, so the map stays bounded', () => {
		const counter = createConnectionCounter(5);
		counter.tryAcquire('a');
		counter.release('a');
		counter.release('a');
		expect(counter.size).toBe(0);
		expect(counter.count('a')).toBe(0);
	});
});

describe('roomHasSpace', () => {
	test('new rooms always have space', () => {
		expect(roomHasSpace(undefined, 'x', 1)).toBe(true);
	});

	test('full rooms reject newcomers but not existing members', () => {
		const room = new Set(['a', 'b']);
		expect(roomHasSpace(room, 'c', 2)).toBe(false);
		expect(roomHasSpace(room, 'a', 2)).toBe(true);
		expect(roomHasSpace(room, 'c', 3)).toBe(true);
	});
});

describe('turnCredentialRecipients', () => {
	test('a lone member gets no TURN credential', () => {
		expect(turnCredentialRecipients(new Set(['a']))).toEqual([]);
		expect(turnCredentialRecipients(undefined)).toEqual([]);
	});

	test('once a peer arrives, every member (re)receives it', () => {
		expect(turnCredentialRecipients(new Set(['a', 'b']))).toEqual(['a', 'b']);
	});
});
