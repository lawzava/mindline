#!/usr/bin/env node
// Bundle verification (docs/BUNDLE_VERIFICATION.md).
//
//   node scripts/bundle-digest.mjs --dir=.svelte-kit/cloudflare [--json=<version>]
//     Digest of every file under _app/immutable/ in a local build. With
//     --json, print {version, digest, files: {path: sha256}} instead: the list
//     CI publishes for the in-browser check (src/lib/verify-build.ts).
//
//   node scripts/bundle-digest.mjs --url=https://mindline.chat [--dir=<build>]
//     Crawl what the live site serves (entry HTML, then every bundle file it
//     references, transitively) and print its digest and build version. With
//     --dir, compare every served file byte for byte against that local build
//     of the same commit; exit 1 on any difference.

import { readFile, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { bundleDigest, fileHashes, referencedAssets } from './bundle-digest-lib.mjs';

const MAX_FILES = 1000;

function arg(name) {
	const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
	return raw ? raw.slice(name.length + 3) : undefined;
}

async function walk(dir) {
	const out = [];
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) out.push(...(await walk(path)));
		else out.push(path);
	}
	return out;
}

async function localBundle(dir) {
	const files = new Map();
	for (const path of await walk(join(dir, '_app', 'immutable'))) {
		files.set('/' + relative(dir, path).split(sep).join('/'), await readFile(path));
	}
	return files;
}

async function fetchBytes(url) {
	const response = await fetch(url, { cache: 'no-store' });
	if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
	return new Uint8Array(await response.arrayBuffer());
}

async function liveBundle(origin) {
	const files = new Map();
	const html = new TextDecoder().decode(await fetchBytes(new URL('/', origin)));
	const queue = referencedAssets(html, origin);
	while (queue.length > 0) {
		const path = queue.shift();
		if (files.has(path)) continue;
		if (files.size >= MAX_FILES)
			throw new Error('bundle larger than expected; refusing to continue');
		const url = new URL(path, origin);
		const bytes = await fetchBytes(url);
		files.set(path, bytes);
		if (/\.(js|css)$/.test(path)) {
			for (const ref of referencedAssets(new TextDecoder().decode(bytes), url.href)) {
				if (!files.has(ref)) queue.push(ref);
			}
		}
	}
	let version = 'unknown';
	try {
		version = JSON.parse(
			new TextDecoder().decode(await fetchBytes(new URL('/_app/version.json', origin)))
		).version;
	} catch {
		/* older builds may not expose it */
	}
	return { files, version };
}

async function main() {
	const url = arg('url');
	const dir = arg('dir');
	if (!url && !dir) {
		console.error('usage: bundle-digest.mjs --dir=<build> | --url=<origin> [--dir=<build>]');
		process.exit(2);
	}
	if (!url) {
		const files = await localBundle(dir);
		const version = arg('json');
		if (version) {
			const hashes = Object.fromEntries(await fileHashes(files));
			console.log(JSON.stringify({ version, digest: await bundleDigest(files), files: hashes }));
			return;
		}
		console.log(`files   ${files.size}`);
		console.log(`digest  ${await bundleDigest(files)}`);
		return;
	}

	const live = await liveBundle(url);
	console.log(`version ${live.version}`);
	console.log(`served  ${live.files.size} files`);
	console.log(`digest  ${await bundleDigest(live.files)}`);
	if (!dir) return;

	const local = await localBundle(dir);
	const localHashes = new Map(await fileHashes(local));
	let mismatches = 0;
	for (const [path, hash] of await fileHashes(live.files)) {
		const expected = localHashes.get(path);
		if (expected !== hash) {
			mismatches++;
			console.log(`${expected ? 'DIFFERS' : 'UNKNOWN'} ${path}`);
		}
	}
	if (mismatches > 0) {
		console.log(`FAIL    ${mismatches} served file(s) do not match the local build`);
		process.exit(1);
	}
	console.log('OK      every served bundle file matches the local build');
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exit(2);
});
