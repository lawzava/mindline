# Bundle verification — the served-code trust ceiling

Mindline is a web app: every page load runs whatever JavaScript the
origin and CDN deliver. End-to-end encryption stops the infrastructure
from *reading* your messages; it cannot stop a malicious *build* of the
app from using your keys in place. This document is the honest evaluation
of what can and cannot raise that ceiling — the Phase-1 §1.7 follow-up to
the README "Honest limits" disclosure.

## Why Subresource Integrity (SRI) does not raise this ceiling

SRI (`<script integrity="sha384-…">`) makes a browser refuse a subresource
whose bytes don't match a hash **written in the referencing document**. It
defends one thing: a CDN or network tampering with a chunk *while the
entry HTML is trusted*.

That is not this threat. The adversary here is a malicious build — the
party that serves the **entry HTML itself**. Such an adversary writes the
integrity hashes, so it simply ships malicious chunks with matching
hashes. SRI between an untrusted entry document and its chunks is
self-referential: it proves the bytes match a value chosen by the same
untrusted party. It would be security theater to advertise it as a
defense against a malicious build.

(Concretely: SvelteKit + `adapter-cloudflare` emits a dynamic ES-module
import graph of hashed-filename chunks under `_app/immutable/` and writes
no `integrity` attributes. Even if it did, the point above holds — and
the dynamic `import()` graph isn't covered by HTML-level SRI anyway;
`importmap` integrity has thin browser support.)

The only thing SRI would buy is detecting CDN-level tampering *against a
build you already trust* — a strictly weaker property than the one the
disclosure is about, and one already covered by HTTPS + Cloudflare's own
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
   build, *provided the user checks*. It does not protect a user who
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
   load; defends only against *later* tampering).

3. **Signed, installed application.** The endpoint of the above: ship the
   client as a signed, installable artifact whose updates are
   signature-checked. Trust reduces to the signing key and the platform's
   update integrity. This is outside a pure-web deployment.

## Recommendation and decision boundary

- **In scope now (doc-only, this file):** state the SRI assessment
  plainly so the project never advertises a guarantee it lacks, and name
  the genuine mechanisms.
- **Small, owner-optional next step:** reproducible build + a
  `bundle-manifest.json` digest published per release, linked from the
  release notes. This is a small build/CI change, not heavy infra.
- **Owner sign-off required (heavier infra):** a verification pipeline,
  a pinned-verifier extension, or an installed signed client. These are
  real engineering efforts with their own threat models and maintenance
  cost; they are flagged here, not built, per the Phase-1 brief.

The README "Honest limits" served-code bullet links here; CLAIMS.md row
"You don't have to trust the server with content" remains
TRUE-WITH-CAVEATS, with this document as the detailed ceiling analysis.

## Owner decision (Phase 3, 2026-06-13)

**Do nothing beyond this documented assessment, for now.** Pre-launch,
with no install base to protect, building reproducible-build/digest
infrastructure (Option 1) or a pinned verifier (Option 2) is not yet
worth the engineering and ongoing maintenance: the served-code ceiling
is the ceiling of every web-delivered E2EE app and is already disclosed
honestly in the README and CLAIMS.md, so no user-facing claim overstates
what the deployment provides. Revisit at launch — Option 1 (reproducible
build + per-release `bundle-manifest.json` digest) is the natural first
step if/when a verifiable supply chain becomes a launch requirement. No
infrastructure is built under this decision.
