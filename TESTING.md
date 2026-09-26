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
store, connection lifecycle and reliable message ordering, signaling
authentication ordering, same-device offer collisions, delivery acknowledgments,
bounded recovery from stalled ICE attempts, duplicate presence announcements, message storage
merge semantics + legacy format.

## E2E tests (Playwright, blocking tier)

First time only, install the browsers: `pnpm exec playwright install`.

```bash
pnpm run test:e2e:ci
```

Real two-browser-context WebRTC against a local signaling server:

- `required-typing.spec.ts` — the flagship: a peer's draft grows
  progressively across three mid-flight assertions, holds without
  vanishing, and resolves into the sent message; a DataChannel send hook
  asserts every frame on `chat`/`eph` is a v4 envelope and no plaintext
  marker ever leaves the device; key-less visitors land in the knocking
  state and see nothing; fragment-less revisits open history from stored
  keys.
- `required-p2p.spec.ts` — message exchange and rejoin sync.
- `required-network.spec.ts` — WebRTC disabled entirely → ciphertext
  relay fallback delivers, asserted at the WebSocket frame level; offline/
  online recovery (CDP).
- `required-persistence.spec.ts`, `room-page`, `landing-page`,
  `messaging`, `connection-status` — core flows.
- `room-usability.spec.ts` covers keyboard and touch actions, long room
  lists, invite copying, share cancellation, cross-tab media cleanup, and honest
  local-message labels when nobody was connected.
- `composer-reliability.spec.ts` covers IME composition and capture
  cancellation with controlled media streams, including delayed permission
  and the recording duration limit.
- `media-transfer.spec.ts` checks file bytes after transfer and reload,
  large-file consent, delivery after a declined transfer, and delivery
  when encryption delays a key-rotation grant.

Message-delivery assertions target committed bubbles, not live drafts that
can remain in the DOM briefly during their outgoing animation. The media byte
test attaches bounded signaling and connection-state diagnostics on failure,
without SDP, room keys, authentication values, or encrypted message bodies.
CI retains failed-attempt traces and signaling logs for seven days, separately
for the required and best-effort suites.

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

- File byte equality and consent have browser coverage. Browser-level
  EXIF stripping and real microphone hardware remain outside CI coverage.
- Mobile projects emulate viewports, not real devices or touch firmware.
- Cross-engine voice playback (Chromium-recorded webm on WebKit) untested
  in CI.
- PR CI is Chromium-only; the staging workflow runs the wider matrix.

## Conventions

- Helpers in `tests/e2e/helpers/test-utils.ts` mint a per-room key
  fragment; every room navigation must carry `#k=...` or the app
  (correctly) locks you out.
- `?fastConnect=true` shortens the ICE attempt deadline to five seconds.
  Normal room visits use fifteen seconds before entering restart backoff.
- The signaling server rate-limits per IP. Helpers throttle room
  navigations, but reloads and reconnects also consume connection attempts.
  It also caps concurrent sockets per IP (`MAX_CONNECTIONS_PER_IP`, default
  20); raise it on the target server for single-machine load tests such as
  `pnpm run test:signaling:soak`.
