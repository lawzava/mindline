import { describe, expect, test } from 'vitest';
import { bundleDigest, referencedAssets } from '../../scripts/bundle-digest-lib.mjs';

describe('bundle verification (docs/BUNDLE_VERIFICATION.md)', () => {
	test('finds immutable assets referenced from HTML, JS imports, and CSS urls', () => {
		const html = `<link href="/_app/immutable/assets/0.abc.css" rel="stylesheet">
			<script>import("/_app/immutable/entry/start.X1.js")</script>`;
		expect(referencedAssets(html, 'https://m.example/')).toEqual([
			'/_app/immutable/assets/0.abc.css',
			'/_app/immutable/entry/start.X1.js'
		]);

		const js = `import{a}from"../chunks/Ab-c.js";const n=()=>import("../nodes/3.Zz.js");`;
		expect(referencedAssets(js, 'https://m.example/_app/immutable/entry/app.Q.js')).toEqual([
			'/_app/immutable/chunks/Ab-c.js',
			'/_app/immutable/nodes/3.Zz.js'
		]);

		const css = `@font-face{src:url(./inter.D1.woff2) format("woff2")}`;
		expect(referencedAssets(css, 'https://m.example/_app/immutable/assets/0.abc.css')).toEqual([
			'/_app/immutable/assets/inter.D1.woff2'
		]);
	});

	test('ignores anything outside the immutable bundle', () => {
		const js = `fetch("/api/x");import("https://evil.example/x.js");const u="./not-immutable.js"`;
		expect(referencedAssets(js, 'https://m.example/other/page.js')).toEqual([]);
	});

	test('the digest is order-independent and changes with any byte', async () => {
		const enc = (s: string) => new TextEncoder().encode(s);
		const a = await bundleDigest(
			new Map([
				['/_app/immutable/a.js', enc('one')],
				['/_app/immutable/b.js', enc('two')]
			])
		);
		const b = await bundleDigest(
			new Map([
				['/_app/immutable/b.js', enc('two')],
				['/_app/immutable/a.js', enc('one')]
			])
		);
		const c = await bundleDigest(
			new Map([
				['/_app/immutable/a.js', enc('one')],
				['/_app/immutable/b.js', enc('tw0')]
			])
		);
		expect(a).toBe(b);
		expect(a).not.toBe(c);
		expect(a).toMatch(/^[0-9a-f]{64}$/);
	});
});
