# Mindline Protocol v2

This is the portable, implementation-defining spec for Mindline's E2E
encryption, P2P wire protocol, and media transfer. TypeScript + WebCrypto
only. If code and this document disagree, one of them is a bug.

Revision 2: incorporates adversarial review (docs/analysis/
protocol-verification.json) — media nonce-salt fix, seq epochs, defined
channel binding, sync caps, platform corrections.

## 0. Canonical encoding

Every keyed-MAC input and every AAD in this protocol uses **length-prefixed
field encoding**: `u32be(byteLen(field)) ‖ utf8(field)` per field, fields
concatenated in the order written as `lp(a, b, ...)`. No delimiter strings
anywhere; attacker-influenced values (roomIds, ids) cannot play delimiter
games.

## 1. Keys

### 1.1 Room key (the capability)

- Created by the room creator: 32 random bytes (`crypto.getRandomValues`).
- Carried only in the URL fragment: `/{roomId}#k={base64url(key)}`.
  The fragment never reaches any server (not in HTTP requests, not in
  `Referer`, not in SvelteKit SSR). The room ID in the path is rendezvous
  only and grants nothing without the key.
- Holding the link = full membership: read, write, and (v1) history sync.
  This is a capability-URL model; the UI share sheet discloses it.

### 1.2 Subkeys (HKDF-SHA-256, domain-separated)

The raw fragment key is imported once as HKDF material (salt:
`utf8("mindline-v2")`, info strings below), subkeys derived, and the
material then dropped — it is never persisted.

| Subkey        | info                     | Use                               |
| ------------- | ------------------------ | --------------------------------- |
| `k_msg`       | `mindline/v2/msg`        | AES-256-GCM for chat/control/sync |
| `k_eph`       | `mindline/v2/eph`        | AES-256-GCM for drafts/presence   |
| `k_storage`   | `mindline/v2/storage`    | AES-256-GCM at-rest               |
| `k_auth`      | `mindline/v2/auth`       | HMAC-SHA-256 handshake/signaling  |
| `k_mediaBase` | `mindline/v2/media-base` | HMAC-SHA-256 base for media keys  |

Per-transfer media keys are `importKey(HMAC(k_mediaBase, lp('media',
transferId)))` as AES-256-GCM — an HMAC-based KDF rather than direct HKDF
so that every persisted key is a plain AES/HMAC CryptoKey, which survives
IndexedDB structured clone in all engines (HKDF material does not,
reliably). This also keeps media usable in fragment-less revisit sessions.

All subkeys are derived non-extractable and persisted as CryptoKeys in
IndexedDB (`mindline-keys`, keyed by roomId) so revisiting `/{roomId}`
without the fragment still opens local history on the same device.
`navigator.storage.persist()` is requested when room keys are first
persisted (not later): without it, Safari ITP evicts all script-writable
storage after 7 days without interaction, wiping keys, history, and device
identity. That eviction risk is documented user-facing (§6).

### 1.3 Device identity

- Per-device ECDSA P-256 keypair, generated non-extractable, stored in
  IndexedDB. (P-256 over Ed25519 for installed-base reach: Ed25519 WebCrypto
  is Baseline only since mid-2025.)
- `deviceId` = base64url(SHA-256(raw SPKI pubkey))[0..16). Stable across
  reloads; names remain self-asserted and bind to deviceId via TOFU.
- Residual limit (documented, inherent to capability URLs): a key-holder can
  mint new identities; they cannot impersonate an existing deviceId.

## 2. Envelope (everything on the wire)

Every DataChannel payload and every relayed payload is exactly one JSON
envelope; there is no plaintext message path.

```ts
interface Envelope {
  v: 2;
  t: 'msg' | 'eph';          // which subkey class encrypted the body
  s: string;                  // sender deviceId
  n: string;                  // base64url 96-bit nonce
  c: string;                  // base64url ciphertext (includes GCM tag)
  sig?: string;               // base64url ECDSA P-256/SHA-256, 'msg' only
}
```

- Body (plaintext before encryption) is the `TypedP2PMessage` discriminated
  union plus replay fields `epoch` and `seq` (below).
- **Nonces**: random 96-bit per envelope. All participants encrypt under the
  same room-wide `k_msg`/`k_eph`, so the GCM collision bound is over the
  room-wide total of encryptions per key — still negligible at chat volume
  (q²/2⁹⁷), and per-keystroke draft traffic burns `k_eph`, not `k_msg`.
  Note AAD does not mitigate an IV collision; GCM keystream depends only on
  key+nonce. Media volume uses salted counter nonces instead (§5.2).
- **AAD**: `lp(roomId, s, t)` — exactly the external context a receiver
  knows before decrypting. A ciphertext cannot be replayed in another room,
  as another sender, or under the other key class. Body type and ids live
  inside the authenticated plaintext.
- **Signatures**: `t='msg'` envelopes are signed over `AAD ‖ nonce ‖
  ciphertext`; receivers verify against the TOFU pubkey for `s`.
  `t='eph'` skips signatures: drafts/presence are transient UI. Accepted
  residual: any room member can spoof another member's draft or presence
  ping (not their chat messages).
- **Replay**: senders maintain `(epoch, seq)` — `epoch` is a persisted
  per-device counter incremented each session start; when no counter is
  persisted (first run, or after a burn) it seeds from the wall clock,
  which exceeds any prior increment count and any earlier clock seed
  (barring clock regression), so a device that cleared local state is
  not censored by peers' persisted high-water state; `seq` restarts at 0
  per session. Receivers persist per `(roomId, senderDeviceId)` high-water
  `(epoch, seq)` in IndexedDB and accept only `epoch > last` or
  `epoch == last && seq > seqHigh` (eph: within a 64-entry reorder window,
  duplicates rejected). A reloaded sender is never censored; replayed old
  envelopes are never accepted, across reloads too.

## 3. Connection lifecycle

### 3.1 Signaling (discovery only)

Unchanged server (`signaling-server.js`): join/offer/answer/ice/relay with
server-assigned ephemeral `clientId`. The server rebuilds relayed messages
keeping only `{type, data, fromId}` — so authentication fields ride
**inside `data`**, never top-level. Every offer/answer/ice/relay `data` a
client sends carries `auth: { deviceId, hmac: HMAC(k_auth, lp(deviceId,
clientId_sender, roomId)) }`. Peers ignore signaling whose HMAC fails (the
operator still sees metadata; it can no longer inject offers/ICE as a fake
member). `join` carries no client auth (the server strips it anyway);
deviceId↔clientId binding is established by the first authenticated
offer/answer or relay broadcast, including after signaling reconnects.
Healthy DataChannels are never torn down by signaling loss.

### 3.2 Perfect negotiation

Polite/impolite role per pair: `polite = deviceId_self < deviceId_peer`
(lexicographic, stable across reconnects). Standard perfect-negotiation
pattern (rollback on collision), `restartIce()` on `connectionState:
'failed'` with re-signaling, exponential backoff, full teardown guards
(every timer/listener registered in a per-peer AbortController).

### 3.3 Channels

| Label   | Options                               | Carries                     |
| ------- | ------------------------------------- | --------------------------- |
| `chat`  | ordered, reliable (no maxRetransmits) | msg envelopes: chat/edit/delete/reaction/sync/control/ack |
| `eph`   | unordered, `maxRetransmits: 0`        | eph envelopes: drafts, presence |
| `media-{transferId}` | ordered, reliable, in-band (DCEP, no renegotiation) | media chunks (§5) |

Media channels MUST be closed by both sides after complete/abort; SCTP
stream ids are recycled only after the close handshake, and close
discipline is what prevents id exhaustion in long-lived rooms.

### 3.4 Key confirmation (replaces `ready`)

On `chat` channel open, both sides send, as a normal `msg` envelope:

```
hello { deviceId, name, spki, proof }
proof = HMAC(k_auth, lp('hello', deviceId, channelBinding))
```

`channelBinding` = `lp(sortedPair(localDtlsFingerprint,
remoteDtlsFingerprint))` — the `a=fingerprint` values from the negotiated
SDP, sorted lexicographically. The receiver **recomputes** the binding from
its own view of the connection and verifies the proof; a captured hello
replayed onto any other connection fails. A peer that cannot produce a
valid envelope+proof is **unverified**: no sync, no messages accepted,
surfaced as "knocking without the key". Only key-confirmed peers count as
participants.

Relay variant (§3.6): no DTLS exists, so
`proof = HMAC(k_auth, lp('hello-relay', deviceId, clientId_self,
clientId_peer, roomId))`. Weaker binding (clientIds are server-assigned),
acceptable because envelope signatures + persisted replay state still hold;
the operator can replay a stale hello but cannot mint traffic with it.

### 3.5 Sync

Cursor-paginated over the `chat` DataChannel **only — sync never relays**;
relay-only sessions get live messages without history, and the UI says so.
`sync-request {since, cursor}` → `sync-response {messages[≤40],
nextCursor?}` with page plaintext capped at 32 KB (wire envelope ≈ 44 KB
after base64, safely under the 64 KiB SDP-default maxMessageSize). Edits
reconcile by `(messageId, editTimestamp)` last-writer-wins; reaction state
syncs as the full per-message reaction map (fixes removal resurrection).
Only to key-confirmed peers.

### 3.6 Relay of last resort

If ICE fails (no direct, no TURN), `msg` envelopes (only) may transit the
signaling relay, same bytes as the DataChannel would carry, after a
relay-hello (§3.4). The v1 ECDH relay crypto and the plaintext
compatibility path are deleted. Media and sync never relay (16 KB server
cap); UI degrades honestly ("direct connection needed for files").

## 4. Storage at rest

- `mindline-messages` (IndexedDB): per room, AES-GCM blobs of message pages
  encrypted with `k_storage`, nonce random, AAD `lp(roomId, 'storage',
  pageIndex)`. localStorage plaintext history is migrated then deleted —
  deletion only after the encrypted write durably commits; on a failed
  write the plaintext is kept and migration retries on the next load.
  Plaintext for rooms whose keys were never persisted on the device cannot
  be encrypted; the start-up migration sweep deletes it instead of leaving
  it readable at rest (history re-syncs from peers on the next keyed
  visit). Storage operations are serialized per room, so a stale
  fire-and-forget save can neither overwrite a newer write nor resurrect
  a page deleted by burn.
- `mindline-blobs`: media blobs encrypted with `k_storage`, AAD
  `lp(roomId, 'blob', transferId)`, keyed `{roomId}/{transferId}`; object
  URLs created on demand, revoked on leave; "burn room" deletes keys +
  messages + blobs.
- Quota: `navigator.storage.estimate()` before accepting media; refuse at
  <2× incoming size headroom. `persist()` requested at key creation (§1.2).

## 5. Media transfer

### 5.1 Flow

```
offer    →  { transferId, kind: file|image|voice|video, name, mime, size,
              sha256, nonceSalt, thumb?, thumbMime?, duration?, waveform? }
accept   ←  { transferId }            // receiver consent; auto-accept ≤ 5 MB
            (sender opens media-{transferId} channel in-band)
chunks   →  binary frames             // media channel
complete →  { transferId }            // media channel, after last chunk
abort    ⇄  { transferId, reason }    // chat channel, either side
```

- **`transferId` is 128-bit `crypto.getRandomValues`, minted fresh per
  attempt.** A retry or re-offer of the same file MUST mint a new
  transferId (and therefore a new key and salt); ids are never reused.
- `nonceSalt`: 8 random bytes (base64url) minted with the offer, carried
  into every chunk nonce (§5.2) — belt-and-suspenders so nonce uniqueness
  never rests on transferId discipline alone.
- Caps: image 25 MB, file 100 MB, voice 10 min, video 90 s / 50 MB.
  Multi-peer fan-out is sender-pays: sequential per peer on mobile, 2-way
  parallel on desktop.

### 5.2 Chunk framing (binary, not JSON)

Key: `k_t = importKey(HMAC(k_mediaBase, lp('media', transferId)))` (§1.2).
Chunk plaintext = 15,360 B; framing overhead = 32 B (4 B index + 12 B nonce
+ 16 B GCM tag) → 15,392 B per frame, under the conservative 16 KiB floor
(engines negotiate 256 KiB via SDP today; 64 KiB when absent — we keep the
conservative size).

```
u32be chunkIndex | 12 B nonce | ciphertext+tag
nonce = u32be(chunkIndex) ‖ nonceSalt(8 B from the offer)
AAD   = lp(transferId, str(chunkIndex))
```

- Backpressure: attach a persistent `bufferedamountlow` listener
  (threshold 256 KB) **before** the first send; pause above 1 MB buffered;
  after attaching any waiter, re-check `bufferedAmount` before sleeping
  (the event only fires on downward crossings — re-check or deadlock).
  The 1 MB pause is also correctness: libwebrtc force-closes the channel
  near its ~16 MB internal buffer cap.
- Integrity: GCM per chunk + whole-file SHA-256 verified against the offer
  before the blob is committed; mismatch → abort + UI error.
- Failure: peer loss or refresh mid-transfer aborts (no resume in v1);
  receiver discards partials. Deferred explicitly: resume, multi-source,
  relay media.

### 5.3 Capture paths

- **Photos**: `<input type=file accept=image/*>` (+ `capture` on mobile).
  Re-encode **every** image — PNG (eXIf chunk) and WebP carry GPS metadata
  too, so no size-based skip: `createImageBitmap` (pass
  `imageOrientation: 'from-image'` where supported — feature-detect; it is
  the modern default but older Firefox throws on the option) → canvas →
  `toBlob('image/webp', 0.82)` with **feature detection on the resulting
  blob.type** and `image/jpeg` fallback (Safari and Firefox do not encode
  WebP). Max edge 2048 px. Thumbnail ≤ 32 px longest edge, same
  detect-and-fallback, mime sent explicitly as `thumbMime`.
- **Voice**: MediaRecorder, `audio/webm;codecs=opus` where supported, else
  `audio/mp4` (Safari/AAC). Honest cross-engine reality: Safari-recorded
  mp4 plays everywhere; Chrome/Firefox-recorded webm/opus requires a
  reasonably current Safari to play — verified by a cross-engine E2E test
  (record on Chromium, assert playback on WebKit), with a UI "can't play
  this voice note" fallback offering download. Waveform: 64 normalized
  peaks sampled during recording, sent in the offer.
- **Video**: MediaRecorder camera capture, `video/webm` or `video/mp4` by
  engine, hard 90 s timer, same cross-engine playback caveat and test.

## 6. Threat model (honest version)

| Adversary                  | What they get                                                  |
| -------------------------- | -------------------------------------------------------------- |
| Network observer           | Traffic shape only (DTLS/WSS everywhere)                       |
| Signaling operator         | Room IDs, deviceIds, presence times, ciphertext when relaying. No content, no names. Cannot inject (HMAC) or read relayed content (no key) |
| TURN operator              | Encrypted SCTP/DTLS packets, peer IPs                           |
| Link-holder (intended or leaked) | Everything: history sync + live room. The link is the key — share sheet says so |
| Past participant           | Keeps everything already synced; static room key (no rotation in v1, documented) |
| Room member (malicious)    | Can spoof drafts/presence of others (eph unsigned); cannot forge, edit, or delete others' messages (signatures) |
| Device thief / forensics   | Needs the device profile; at-rest data is AES-GCM, keys non-extractable in IndexedDB |
| XSS / malicious extension  | Game over (can use keys in place). Mitigation: strict CSP, zero third-party runtime origins, self-hosted fonts |

Platform residuals, documented user-facing: Safari evicts IndexedDB after
7 days without interaction unless `persist()` is granted — history and
device identity can vanish on rarely-used Safari profiles. Browser history
sync (Chrome/iCloud) can upload the room URL including the key fragment
unless the user's browser sync is E2E-encrypted.

Claims forbidden until true, everywhere in README/PRIVACY/UI: "messages
never leave your devices" (false when relaying: ciphertext transits the
server), "no metadata" (server sees rendezvous metadata), "forward secrecy"
(none in v1).

## 7. Test contract

Unit (vitest): HKDF subkey derivation + cross-room independence; AAD
context binding (room/sender/class swaps rejected); nonce uniqueness;
(epoch, seq) replay rejection incl. reorder window, reload-epoch
acceptance, and persisted high-water; signature verify/forge; edit/delete
authorization; sync page reconciliation (edit LWW, reaction maps); media
frame round-trip + reorder/corruption rejection + salt-distinct reuse;
storage encrypt/decrypt + v1 plaintext migration; IndexedDB CryptoKey
persistence round-trip.

E2E (Playwright, blocking tier): two-browser live-typing progressive
assertion (substring grows across ≥3 snapshots before send); wire-level
ciphertext assertion on the DataChannel path (hook
`RTCDataChannel.prototype.send` in an init script, assert no plaintext on
chat/eph/media channels); unverified-joiner lockout (no fragment → no sync,
"knocking" state); two-browser file transfer with SHA-256 equality; photo
EXIF/GPS stripped **and** orientation preserved for a rotation-tagged JPEG;
cross-engine voice-note playback (record Chromium → play WebKit); reload →
keys from IndexedDB → history opens without fragment.
