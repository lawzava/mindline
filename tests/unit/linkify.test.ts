import { describe, it, expect } from 'vitest';
import { linkify } from '../../src/lib/linkify';

describe('linkify', () => {
	it('returns plain text untouched when there are no links', () => {
		expect(linkify('hello there, no links here.')).toEqual([
			{ type: 'text', text: 'hello there, no links here.' }
		]);
		expect(linkify('')).toEqual([]);
	});

	it('links http and https URLs between text', () => {
		expect(linkify('see https://example.com/a?b=1#c now')).toEqual([
			{ type: 'text', text: 'see ' },
			{ type: 'link', text: 'https://example.com/a?b=1#c', href: 'https://example.com/a?b=1#c' },
			{ type: 'text', text: ' now' }
		]);
		expect(linkify('http://example.org')).toEqual([
			{ type: 'link', text: 'http://example.org', href: 'http://example.org/' }
		]);
	});

	it('prefixes bare www. hosts with https://', () => {
		expect(linkify('go to www.example.com')).toEqual([
			{ type: 'text', text: 'go to ' },
			{ type: 'link', text: 'www.example.com', href: 'https://www.example.com/' }
		]);
	});

	it('never links javascript: or data: URLs', () => {
		for (const text of [
			'javascript:alert(1)',
			'click javascript:alert(document.cookie)',
			'data:text/html,<script>alert(1)</script>',
			'JaVaScRiPt:alert(1)'
		]) {
			expect(linkify(text)).toEqual([{ type: 'text', text }]);
		}
	});

	it('only ever produces http(s) hrefs', () => {
		const segments = linkify('javascript:https://example.com x');
		const links = segments.filter((s) => s.type === 'link');
		expect(links).toEqual([
			{ type: 'link', text: 'https://example.com', href: 'https://example.com/' }
		]);
	});

	it('trims trailing sentence punctuation', () => {
		for (const tail of ['.', ',', '!', '?', ':', ';', '...', '!?']) {
			expect(linkify(`look https://example.com/x${tail}`)).toEqual([
				{ type: 'text', text: 'look ' },
				{ type: 'link', text: 'https://example.com/x', href: 'https://example.com/x' },
				{ type: 'text', text: tail }
			]);
		}
	});

	it('trims an unbalanced closing paren but keeps balanced ones', () => {
		expect(linkify('(see https://example.com/x).')).toEqual([
			{ type: 'text', text: '(see ' },
			{ type: 'link', text: 'https://example.com/x', href: 'https://example.com/x' },
			{ type: 'text', text: ').' }
		]);
		expect(linkify('https://en.wikipedia.org/wiki/Foo_(bar)')).toEqual([
			{
				type: 'link',
				text: 'https://en.wikipedia.org/wiki/Foo_(bar)',
				href: 'https://en.wikipedia.org/wiki/Foo_(bar)'
			}
		]);
	});

	it('handles several links and leaves bare schemes as text', () => {
		expect(linkify('a https://a.io and www.b.io; https:// alone')).toEqual([
			{ type: 'text', text: 'a ' },
			{ type: 'link', text: 'https://a.io', href: 'https://a.io/' },
			{ type: 'text', text: ' and ' },
			{ type: 'link', text: 'www.b.io', href: 'https://www.b.io/' },
			{ type: 'text', text: '; https:// alone' }
		]);
	});

	it('does not match schemes glued to a preceding word', () => {
		expect(linkify('xhttps://example.com')).toEqual([
			{ type: 'text', text: 'xhttps://example.com' }
		]);
	});

	it('stays linear on a URL followed by many closing brackets', () => {
		const hostile = 'https://a.example/' + ')'.repeat(200_000);
		const started = performance.now();
		const segments = linkify(hostile);
		expect(performance.now() - started).toBeLessThan(500);
		expect(segments.map((s) => s.text).join('')).toBe(hostile);
	});
});
