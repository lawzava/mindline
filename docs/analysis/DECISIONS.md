# Architecture Decision Record: P2P overhaul (2026-06-10)

Inputs: 8-agent subsystem analysis (`deep-analysis-2026-06-10.json`), hands-on
two-browser testing, 3-lens adversarial review of the plan
(`design-decisions-partial.json`). All three attack lenses returned
refuted=false (high confidence) with amendments, incorporated below.

## D1. Remove the Rust/WASM layer entirely

Pure TypeScript + WebCrypto. Evidence: zero cryptography executes in Rust
(it calls back into JS WebCrypto via `window.webcryptoEncrypt`); ~59 of 74
exports dead; 1.05 MB wasm gates first paint; the "native port" door is
painted on (nothing in src-rust is portable; the portable asset is the
protocol spec, now `docs/PROTOCOL.md`). Blast radius owned: package.json
gates (`verify:rust` dropped, `verify:web` loses build-wasm), CI workflows,
CLAUDE.md / AGENTS.md / README architecture sections rewritten.

## D2. Real E2E encryption, key in the URL fragment

Room link = `/{roomId}#k={base64url 256-bit key}`. Fragment never reaches any
server (HTTP, Referer, SSR). Precedent: Excalidraw, CryptPad, Firefox Send.
Full spec in `docs/PROTOCOL.md`. Amendments adopted:

- **At rest too**: history and media blobs encrypted with an HKDF-derived
  storage subkey; room keys held as non-extractable CryptoKeys in IndexedDB.
  Plaintext localStorage history is removed.
- **AAD binding** of every ciphertext to {room, sender, type, id/chunk} to
  kill cross-context replay/reflection.
- **Key-confirmation handshake** after DataChannel open; peers that cannot
  prove key knowledge appear as blocked/unverified, never as participants.
  History sync only to key-confirmed peers.
- **Fragment persistence decision**: keep `#k=` in the URL (refresh and
  share-from-address-bar work; seconds-to-talking). Residual risk —
  browser-history sync to Google/iCloud — disclosed in UI copy and PRIVACY.
- **CSP hardening is a prerequisite**: self-hosted fonts (no Google Fonts at
  runtime), strict CSP, Referrer-Policy, stale `_headers` rules removed.
- **Sender authenticity**: per-device ECDSA P-256 keypair (non-extractable,
  IndexedDB), pubkey bound at handshake, envelopes signed, TOFU. Residual
  (documented, capability-model limit): a key-holder can mint new fake-named
  identities; they cannot impersonate an existing one.

## D3. Connection layer rewritten around perfect negotiation

connection.ts rewritten: perfect negotiation with polite/impolite roles from
**stable client-generated device IDs** (HMAC-authenticated with a key derived
from the room key) mapped onto ephemeral signaling IDs — survives signaling
reconnects without ghost peers. Real ICE restart. Signaling drop no longer
tears down healthy DataChannels. Teardown guards on all timers. Channels:

- `chat`: ordered, fully reliable (the maxRetransmits:3 silent-drop bug dies)
  for messages, edits, reactions, control, sync.
- `ephemeral`: unordered, maxRetransmits 0, for live drafts and presence.
- per-transfer media channels (D5) so files never head-of-line-block chat.

Sync becomes cursor-paginated pages instead of one O(history) JSON blob.

## D4. Relay fallback: keep as encrypted last resort; TURN fixed

Amended from "drop it" after the availability attack: today the only TURN is
discontinued free openrelay with static creds, and `forceRelay` funnels all
cellular traffic into it. So: (a) remove `forceRelay`-on-cellular and the
dead openrelay entries; TURN servers become env-configurable
(`PUBLIC_TURN_*`), provisioning documented as a deploy task (coturn or paid,
ephemeral HMAC creds); (b) the WS relay stays as transport of last resort but
carries only the same E2E envelopes as DataChannels — the separate
unauthenticated ECDH layer and the plaintext "backward compatibility" path
are deleted. The signaling operator relays ciphertext it cannot read. Media
transfers require a direct/TURN path (16 KB relay cap); UI says so honestly.

## D5. P2P media, phased

Files + photos first, voice notes second, video messages last. Chunked
encrypted transfer over dedicated DataChannels with backpressure
(bufferedAmountLow), receiver consent before bytes, per-transfer HKDF subkey
with counter nonces, EXIF stripped via canvas re-encode, IndexedDB blob
store (encrypted) with object-URL lifecycle. Spec in `docs/PROTOCOL.md`.

## D6. Design: "Iron Gall" (light-primary, paper/ink)

Adopted from the design panel (sole surviving concept; verified against the
product register laws). Warm paper neutrals (hue 84) + iron-gall ink (hue
272), Restrained strategy with one Committed surface: the live draft.
Newsreader (human words) + Inter (system chrome), self-hosted. The remote
draft becomes a first-class wet-ink block in the message stream that "dries"
in place into the sent message. Light is authored; dark ("Inkwell") is its
translation. Full tokens in the panel output JSON; landing card deleted in
favor of a type-only specimen.

## D7. Honesty pass

README / PRIVACY / TERMS / CLAUDE.md rewritten to match the code exactly:
what is encrypted, what the signaling server sees (room IDs, presence
metadata, ciphertext when relaying), what a link-holder can do, what history
sync means. No claim ships before the code that makes it true.

## Phasing (each phase ends with green gates + a commit)

A. `docs/PROTOCOL.md` + crypto module + unit tests (vitest)
B. WASM removal: port ~15 live call sites to TS, delete src-rust/pkg/bridge,
   rewire verify gates, keep all 40 required E2E green
C. Connection rewrite per D3 + envelope encryption per D2 + relay per D4
D. Media per D5 with E2E tests (two-browser transfer, hash + EXIF assertions)
E. Iron Gall UI + mobile foundation (dvh, visualViewport, viewport-fit, real
   PWA: served manifest, icons, service worker) + a11y fixes
F. Test hardening: live-typing becomes blocking coverage with progressive
   assertion; wire-level ciphertext assertion on the primary path; honest docs
G. CodeRabbit review, fixes, final verification
