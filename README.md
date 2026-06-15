# Mindline

Private peer-to-peer chat where you see each other's messages **as they are
typed**, character by character. Open a link, you're in a room. No accounts,
no message servers: messages travel browser-to-browser over WebRTC,
end-to-end encrypted with a key that lives only in the invite link.

[![CI](https://github.com/lawzava/mindline/actions/workflows/ci.yml/badge.svg)](https://github.com/lawzava/mindline/actions/workflows/ci.yml)
[![License: AGPL v3](https://img.shields.io/badge/license-AGPL--3.0--only-blue.svg)](LICENSE)
[![No tracking](https://img.shields.io/badge/tracking-none-success.svg)](PRIVACY.md)

> **[Try it live →](https://mindline.chat)** — open two windows and watch the
> draft form in real time.

<!-- Add a demo here: drop `docs/demo.gif` in the repo and uncomment.
![Mindline live-typing demo](docs/demo.gif) -->

## How it works

- **The invite link is the key.** Creating a room generates a random 256-bit
  key carried in the URL fragment (`/room-id#k=...`). Fragments never reach
  any server. Whoever holds the link can read and write the room; nobody
  else can, including the people running the infrastructure.
- **Everything on the wire is ciphertext.** Every message, live draft,
  history sync, and media chunk is AES-256-GCM encrypted with keys derived
  from the link key, signed with a per-device P-256 key. Room keys are
  distributed with a hybrid **post-quantum** key exchange (X-Wing:
  X25519 + ML-KEM-768), so recorded traffic stays confidential against a
  future quantum computer. The signaling server arranges introductions and,
  as a last resort, relays ciphertext it cannot read.
- **Live typing is the point.** Drafts stream over a dedicated lossy channel
  and form in the message stream as wet ink that dries into the sent
  message.
- **Media is P2P too.** Files, photos (EXIF/GPS stripped by re-encode), and
  voice notes transfer directly between browsers in encrypted 15 KiB chunks
  with receiver consent. Nothing transits a server.
- **History stays on devices.** Messages persist locally, encrypted at rest;
  new participants receive history from peers, encrypted. There is no server
  copy.

The full wire protocol, key schedule, and threat model live in
[`docs/PROTOCOL.md`](docs/PROTOCOL.md). If code and that document disagree,
one of them is a bug.

## Honest limits

- **The link is a bearer capability.** Anyone who obtains it (including via
  a leaked chat where it was shared, or browser history sync to a cloud
  account without E2E sync enabled) gets full access, including history.
- **Forward secrecy is scoped, not absolute.** Room keys rotate on joins
  and leaves (fresh random generations, PROTOCOL.md §1.4), so ciphertext
  the signaling operator archived while relaying stays unreadable even if
  the link later leaks. What rotation does *not* change: the link itself
  still grants entry and history-by-sync to whoever holds it, history at
  rest on your device stays under a link-derived key, and peers stuck on
  the relay can't receive rotations (the UI says so).
- **Rendezvous metadata exists.** The signaling server sees room IDs, device
  identifiers, IP addresses, and timing — not content, not names. Peers
  connect directly, so room members see each other's IP addresses; on the
  relay path the operator additionally sees the sending device id and the
  size and timing of each ciphertext. Any CDN or reverse proxy fronting the
  app or the signaling host sees the same connection metadata.
- **Classical signatures.** Message authenticity uses ECDSA P-256, which is
  quantum-forgeable in principle — an authenticity risk against link-holders
  only, with no harvest-now-decrypt-later exposure (content confidentiality
  is post-quantum). See PROTOCOL.md §1.3.
- **Presence-centric.** Both peers online is the normal mode; media
  transfers require a direct or TURN connection (the relay can't carry
  them).
- **Safari storage eviction.** Without the "persist" permission, Safari can
  evict keys and history after 7 days of inactivity.
- **You re-trust the served code on every load.** Like any web app, each
  page load runs whatever JavaScript the server and CDN deliver. The
  encryption stops the infrastructure from reading your messages; it
  cannot stop a malicious build of the app itself. An installed, signed
  client would raise this ceiling. Subresource Integrity does **not** —
  it can't defend against the party that serves the entry HTML, which is
  exactly this adversary; [`docs/BUNDLE_VERIFICATION.md`](docs/BUNDLE_VERIFICATION.md)
  is the full analysis and the genuine (reproducible-build / pinned-verifier)
  paths.

## Run with Docker

The fastest way to self-host the whole thing (app + signaling):

```bash
git clone https://github.com/lawzava/mindline.git
cd mindline
docker compose up --build
```

Open <http://localhost:8080> — signaling runs alongside on `:9210`. Localhost
works over plain `ws://` because browsers treat localhost as a secure context.

For a real domain (cross-device needs HTTPS), build the app against your public
signaling origin and put a TLS reverse proxy in front of both services:

```bash
VITE_SIGNALING_SERVER=wss://signal.example.com docker compose up --build
```

## Development

Two processes: the app and the signaling server.

```bash
pnpm install
pnpm dev              # app on :5173
pnpm run signaling    # signaling server on :3000 (separate terminal)
```

### Tests & checks

```bash
pnpm run test:unit            # fast: crypto/protocol unit tests (vitest)
pnpm run check                # types + svelte-check
pnpm run lint                 # prettier + eslint
pnpm exec playwright install  # one-time: browsers for the e2e suite
pnpm run test:e2e:ci          # blocking Playwright suite (real two-browser P2P)
pnpm run verify:ai            # unit + web build + e2e (the full gate)
```

## Self-hosting

The app is a standard SvelteKit (`adapter-node`) build: `pnpm build` emits
`build/`, run it with `node build`. It runs anywhere Node runs — there is no
platform lock-in. [`.env.example`](.env.example) documents every variable.

- **The signaling origin is baked in at build time.** The strict CSP pins
  `connect-src` to `self` + your signaling origin, so set `VITE_SIGNALING_SERVER`
  (a host, or a full `wss://` origin) before building, and rebuild to change it.
  A runtime override cannot loosen the CSP (that scheme-wide `ws:` allowance was
  an any-host exfil channel for any script that ran).
- **TURN (recommended across carrier NATs):** set `VITE_TURN_URLS`,
  `VITE_TURN_USERNAME`, `VITE_TURN_CREDENTIAL` at build time. Without TURN,
  peers behind symmetric NATs fall back to the encrypted relay for text and
  cannot transfer media.
- **The signaling server** (`node signaling-server.js`) is stateless and never
  sees plaintext; set `ALLOWED_ORIGINS` to your app origin.

## Architecture

Pure TypeScript + WebCrypto. No accounts, no databases, no WASM.

```
src/lib/crypto/      key schedule, envelopes, identity, replay, keystore
src/lib/p2p/         WebRTC perfect negotiation, crypto session, signaling
src/lib/media/       chunked encrypted transfer, blob store, image, recorder
src/lib/stores/      Svelte stores (messages, drafts, connection, transfers)
src/routes/          SvelteKit pages
signaling-server.js  discovery + ciphertext relay of last resort
```

New here? [`ARCHITECTURE.md`](ARCHITECTURE.md) is the one-page orientation.
[`docs/PROTOCOL.md`](docs/PROTOCOL.md) is the full wire protocol and threat
model, and [`docs/CLAIMS.md`](docs/CLAIMS.md) grades every security claim
against the code that enforces it.

## Contributing

Contributions are welcome — see [`CONTRIBUTING.md`](CONTRIBUTING.md) and
[`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md). For security issues, please follow
the private disclosure process in [`SECURITY.md`](SECURITY.md) rather than
opening a public issue.

## License

[AGPL-3.0-only](LICENSE). © 2025–2026 Law Zava and Mindline contributors.

Mindline is network-use copyleft: if you run a modified version as a service,
the AGPL requires you to offer your users the corresponding source. That is
deliberate — the product's promise is that the code you run is the code you
can audit.
