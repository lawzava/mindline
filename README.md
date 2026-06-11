# Mindline

Private peer-to-peer chat where you see each other's messages **as they are
typed**, character by character. Open a link, you're in a room. No accounts,
no message servers: messages travel browser-to-browser over WebRTC,
end-to-end encrypted with a key that lives only in the invite link.

## How it works

- **The invite link is the key.** Creating a room generates a random 256-bit
  key carried in the URL fragment (`/room-id#k=...`). Fragments never reach
  any server. Whoever holds the link can read and write the room; nobody
  else can, including the people running the infrastructure.
- **Everything on the wire is ciphertext.** Every message, live draft,
  history sync, and media chunk is AES-256-GCM encrypted with keys derived
  from the link key, signed with a per-device P-256 key. The signaling
  server arranges introductions and, as a last resort, relays ciphertext it
  cannot read.
- **Live typing is the point.** Drafts stream over a dedicated lossy channel
  and form in the message stream as wet ink that dries into the sent
  message.
- **Media is P2P too.** Files, photos (EXIF/GPS stripped by re-encode), and
  voice notes transfer directly between browsers in encrypted 15 KiB chunks
  with receiver consent. Nothing transits a server.
- **History stays on devices.** Messages persist locally; new participants
  receive history from peers, encrypted. There is no server copy.

The full wire protocol, key schedule, and threat model live in
[`docs/PROTOCOL.md`](docs/PROTOCOL.md). If code and that document disagree,
one of them is a bug.

## Honest limits

- **The link is a bearer capability.** Anyone who obtains it (including via
  a leaked chat where it was shared, or browser history sync to a cloud
  account without E2E sync enabled) gets full access, including history.
- **No forward secrecy in v1.** The room key is static for the room's life.
- **Rendezvous metadata exists.** The signaling server sees room IDs, device
  identifiers, IP addresses, and timing — not content, not names. Peers
  connect directly, so room members see each other's IP addresses; on the
  relay path the operator additionally sees the sending device id and the
  size and timing of each ciphertext. Cloudflare fronts the app and the
  signaling host and sees the same connection metadata.
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

## Architecture

Pure TypeScript + WebCrypto. No accounts, no databases, no WASM.

```
src/lib/crypto/    key schedule, envelopes, identity, replay, keystore
src/lib/p2p/       WebRTC perfect negotiation, crypto session, signaling
src/lib/media/     chunked encrypted transfer, blob store, image, recorder
src/lib/stores/    Svelte stores (messages, drafts, connection, transfers)
src/routes/        SvelteKit pages
signaling-server.js  discovery + ciphertext relay of last resort
```

## Development

```bash
pnpm install
pnpm dev              # app on :5173
pnpm run signaling    # signaling server on :3000 (separate terminal)
```

### Verification

```bash
pnpm run test:unit    # crypto/protocol unit tests (vitest)
pnpm run verify:web   # typecheck + production build
pnpm run test:e2e:ci  # blocking Playwright suite (real two-browser P2P)
pnpm run verify:ai    # all of the above
```

### Deployment

- App: Cloudflare (adapter-cloudflare), `pnpm run build`.
- Signaling: `node signaling-server.js` anywhere WebSockets work.
- TURN (recommended for reliability across carrier NATs): provision coturn
  or a paid service and set `VITE_TURN_URLS`, `VITE_TURN_USERNAME`,
  `VITE_TURN_CREDENTIAL` (or runtime `MINDLINE_ENV.TURN_SERVERS`). Without
  TURN, peers behind symmetric NATs fall back to the ciphertext relay for
  text and cannot transfer media.

## License

MIT
