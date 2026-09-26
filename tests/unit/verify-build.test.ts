import { describe, expect, test } from 'vitest';
import { fileHashes } from '../../scripts/bundle-digest-lib.mjs';
import { checkServedBuild, publishedDigestUrl } from '$lib/verify-build';

const ORIGIN = 'https://m.example';
const enc = (s: string) => new TextEncoder().encode(s);

// A tiny site: the entry HTML names one script, which imports a chunk.
const SITE: Record<string, string> = {
	'/': '<script type="module">import("/_app/immutable/entry/app.A.js")</script>',
	'/_app/immutable/entry/app.A.js': 'import"../chunks/c.B.js";',
	'/_app/immutable/chunks/c.B.js': 'export const x=1;'
};

function fakeFetch(site: Record<string, string>) {
	return async (input: string | URL) => {
		const path = new URL(String(input), ORIGIN).pathname;
		if (!(path in site)) return new Response('missing', { status: 404 });
		return new Response(enc(site[path]));
	};
}

async function published(site: Record<string, string>) {
	const files = new Map(
		Object.entries(site)
			.filter(([p]) => p.startsWith('/_app/immutable/'))
			.map(([p, s]) => [p, enc(s)])
	);
	return { version: 'abc123', files: Object.fromEntries(await fileHashes(files)) };
}

describe('checking the served build against its published digest', () => {
	test('every served file matching the published build passes', async () => {
		const result = await checkServedBuild({
			origin: ORIGIN,
			fetch: fakeFetch(SITE),
			published: await published(SITE)
		});
		expect(result).toEqual({ ok: true, checked: 2, mismatches: [] });
	});

	test('a changed file, or one the build never had, fails and is named', async () => {
		const tampered = { ...SITE, '/_app/immutable/chunks/c.B.js': 'export const x=2;' };
		const result = await checkServedBuild({
			origin: ORIGIN,
			fetch: fakeFetch(tampered),
			published: await published(SITE)
		});
		expect(result.ok).toBe(false);
		expect(result.mismatches).toEqual(['/_app/immutable/chunks/c.B.js']);

		const extra = {
			...SITE,
			'/_app/immutable/entry/app.A.js': 'import"../chunks/c.B.js";import"../chunks/evil.C.js";',
			'/_app/immutable/chunks/evil.C.js': 'steal()'
		};
		const second = await checkServedBuild({
			origin: ORIGIN,
			fetch: fakeFetch(extra),
			published: await published(SITE)
		});
		expect(second.ok).toBe(false);
		expect(second.mismatches).toContain('/_app/immutable/chunks/evil.C.js');
	});

	test('the digest for a version comes from the repository, by exact commit', () => {
		expect(publishedDigestUrl('0123abcd'.repeat(5))).toBe(
			'https://raw.githubusercontent.com/lawzava/mindline/bundle-digests/' +
				'0123abcd'.repeat(5) +
				'.json'
		);
		expect(() => publishedDigestUrl('../../etc')).toThrow();
		expect(() => publishedDigestUrl('dev')).toThrow();
	});
});
