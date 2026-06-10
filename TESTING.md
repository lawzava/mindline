# Testing

Two tiers, honestly separated: a **blocking** tier that gates merges and a
**best-effort** tier for breadth that may flake in CI without failing it.

## Unit tests (vitest, blocking)

```bash
pnpm run test:unit
```

Covers the protocol core against PROTOCOL.md §7: key derivation and
domain separation, envelope seal/open with AAD context binding, sender
spoof/tamper/signature rejection, (epoch, seq) replay rejection incl.
reload epochs and serialize/hydrate, session hello verification and
channel-binding replay rejection, keystore round-trips (fake-indexeddb),
media frame round-trip/reorder/corruption/salt rules, encrypted blob
store, message storage merge semantics + legacy format.

## E2E tests (Playwright, blocking tier)

```bash
pnpm run test:e2e:ci
```

Real two-browser-context WebRTC against a local signaling server:

- `required-typing.spec.ts` — the flagship: a peer's draft grows
  progressively across three mid-flight assertions, holds without
  vanishing, and resolves into the sent message; a DataChannel send hook
  asserts every frame on `chat`/`eph` is a v2 envelope and no plaintext
  marker ever leaves the device; key-less visitors land in the knocking
  state and see nothing; fragment-less revisits open history from stored
  keys.
- `required-p2p.spec.ts` — message exchange and rejoin sync.
- `required-network.spec.ts` — WebRTC disabled entirely → ciphertext
  relay fallback delivers, asserted at the WebSocket frame level; offline/
  online recovery (CDP).
- `required-persistence.spec.ts`, `room-page`, `landing-page`,
  `messaging`, `connection-status` — core flows.

## Best-effort tier (non-blocking)

```bash
pnpm run test:e2e:with-signaling:best-effort
```

Edit/delete, reactions, peer list, typing indicators breadth, mobile
viewport flows, multi-user (3+) scenarios. These run real P2P and may
skip when the environment can't establish it; they never silently pass
without asserting.

## Known gaps (deliberate, tracked)

- Media blobs transfer only through live offers: late joiners and fresh
  devices see the message with a thumbnail and an honest "stored copy
  unavailable" note (no re-offer protocol in v1).

- Media transfer E2E (two-browser file hash equality, EXIF strip) is
  verified manually and via unit tests; a CI spec needs fake-device flags.
- Mobile projects emulate viewports, not real devices or touch firmware.
- Cross-engine voice playback (Chromium-recorded webm on WebKit) untested
  in CI.
- PR CI is Chromium-only; the staging workflow runs the wider matrix.

## Conventions

- Helpers in `tests/e2e/helpers/test-utils.ts` mint a per-room key
  fragment; every room navigation must carry `#k=...` or the app
  (correctly) locks you out.
- `?fastConnect=true` shortens connection timers in test mode.
- The signaling server rate-limits per IP; helpers throttle room
  navigations to stay under it.
