# Bundle verification — the served-code trust ceiling

Mindline is a web app: every page load runs whatever JavaScript the
origin and CDN deliver. End-to-end encryption stops the infrastructure
from _reading_ your messages; it cannot stop a malicious _build_ of the
app from using your keys in place. This document is the honest evaluation
of what can and cannot raise that ceiling.

## Why Subresource Integrity (SRI) does not raise this ceiling

SRI (`<script integrity="sha384-…">`) makes a browser refuse a subresource
whose bytes don't match a hash **written in the referencing document**. It
defends one thing: a CDN or network tampering with a chunk _while the
entry HTML is trusted_.

That is not this threat. The adversary here is a malicious build — the
party that serves the **entry HTML itself**. Such an adversary writes the
integrity hashes, so it simply ships malicious chunks with matching
hashes. SRI between an untrusted entry document and its chunks is
self-referential: it proves the bytes match a value chosen by the same
untrusted party. It would be security theater to advertise it as a
defense against a malicious build.

(Concretely: SvelteKit + `adapter-node` emits a dynamic ES-module
import graph of hashed-filename chunks under `_app/immutable/` and writes
no `integrity` attributes. Even if it did, the point above holds — and
the dynamic `import()` graph isn't covered by HTML-level SRI anyway;
`importmap` integrity has thin browser support.)

The only thing SRI would buy is detecting CDN-level tampering _against a
build you already trust_ — a strictly weaker property than the one the
disclosure is about, and one already covered by HTTPS + the CDN's own
integrity to the origin. We do not ship it, to avoid implying a guarantee
it doesn't provide.

## What actually raises the ceiling

The trust ceiling moves only when the user can verify the running code
**out of band** — against something the serving infrastructure cannot
forge. Three mechanisms, in increasing strength:

1. **Reproducible build + published bundle digest (lightweight, recommended
   first step).** Make the production build byte-reproducible from a
   tagged commit, and publish a single digest over the immutable assets
   (e.g. `sha256` of a sorted manifest of `_app/immutable/**`). A
   technically capable user — or a CI job, or a watchdog — can fetch the
   live bundle, recompute the digest, and compare it to the digest the
   release published. This detects a server that quietly swapped the
   build, _provided the user checks_. It does not protect a user who
   doesn't, and a malicious origin can still serve the good bundle to
   checkers and a bad one to targets (selective targeting) — so it is a
   transparency/accountability mechanism, not a hard guarantee.

2. **Pinned verifier (browser extension or installed client).** A small
   verifier installed **once** from a signed channel (extension store,
   app store) can, on every load, hash the served bundle and refuse to
   run anything not matching a signed release manifest. This is the
   genuine fix and matches the README line "an installed, signed client
   would raise this ceiling": trust moves from "every page load" to "one
   audited install + the signing key." A service worker pinned on first
   visit is a weaker variant (TOFU on the first, possibly-malicious,
   load; defends only against _later_ tampering).

3. **Signed, installed application.** The endpoint of the above: ship the
   client as a signed, installable artifact whose updates are
   signature-checked. Trust reduces to the signing key and the platform's
   update integrity. This is outside a pure-web deployment.

## Shipped: reproducible build and a public check (2026-09-26)

Option 1 is now in place, because the product is live and an install base
now exists to protect.

- **Reproducible build.** SvelteKit's version name is the commit hash
  (`BUILD_VERSION`, else `CF_PAGES_COMMIT_SHA`, else `GITHUB_SHA`) instead of
  the build time, so two builds of one commit are byte-identical. CI builds
  every commit twice and fails if the bundle digests differ, and writes the
  digest to the job summary.
- **A check anyone can run.** `scripts/bundle-digest.mjs` crawls what a site
  actually serves (the entry HTML, then every `/_app/immutable/` file it
  references, transitively) and compares each file byte for byte with a
  local build of the commit the site names in `/_app/version.json`:

  ```bash
  version=$(curl -fsS https://mindline.chat/_app/version.json | jq -r .version)
  git checkout "$version" && pnpm install --frozen-lockfile
  BUILD_VERSION="$version" ADAPTER=cloudflare pnpm build
  node scripts/bundle-digest.mjs --url=https://mindline.chat --dir=.svelte-kit/cloudflare
  ```

- **A watchdog.** `.github/workflows/verify-live.yml` runs those steps daily
  and on demand; anyone can run it from a fork.
- **The build is named in the app.** The landing page shows the build's
  commit and links here.

What this does not change: a check proves what was served to the checker at
that moment. A malicious origin can still serve the published bundle to
checkers and something else to a target. That limit ends only with a pinned
verifier or an installed, signed client (options 2 and 3), which remain
unbuilt. A service worker that pins the first bundle it sees was considered
and not shipped: it trusts that first load, and a bad update path can strand
every client on a broken build.

## Shipped: published digests and an in-page check

- **Published digests.** `.github/workflows/publish-digest.yml` builds every
  main commit as the site does and publishes its per-file SHA-256 list to
  the `bundle-digests` branch as `<commit>.json`
  (`node scripts/bundle-digest.mjs --dir=<build> --json=<commit>`). Any
  verifier, including one outside the page, can compare against it without
  building.
- **"Check it now".** The start page's build line can run the same crawl in
  the browser (`src/lib/verify-build.ts`, sharing
  `scripts/bundle-digest-lib.mjs`) and compare every served file with the
  published list for the commit the site names. It runs only when asked:
  fetching the list from `raw.githubusercontent.com` tells GitHub this
  address uses Mindline (PRIVACY.md), and the CSP allows that one origin
  for it.
- **What it proves, and what not.** A page cannot vouch for itself: a
  tampered build could show "match" regardless. The in-page check catches a
  swapped or corrupted file when the page's own code is honest (a bad edge
  cache, a partial deploy, a changed chunk the checker does not load), and
  makes the published list easy to reach. It covers the `/_app/immutable/`
  bundle only, as the command does: not the entry HTML's inline scripts,
  `/js/env-config.js` (rewritten at deploy), `/js/reading-boot.js`, or
  `/service-worker.js`. With the service worker installed, it reads the
  bundle files this device runs, from the worker's cache. The independent
  check stays the command above and the watchdog.
- **Offline and updates.** The service worker serves the build's files from
  a per-version cache and fetches pages from the network first, keeping the
  last 20 visited pages only as an offline fallback. It pins nothing, so
  updates arrive as they would without it (PROTOCOL.md §4).

Remaining: a verifier outside the page (a browser extension that checks
each loaded file against the published list, or an installed, signed
client). Distributing one needs a store listing under the project's account.
