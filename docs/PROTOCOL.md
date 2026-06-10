# Mindline Protocol v2

This is the portable, implementation-defining spec for Mindline's E2E
encryption, P2P wire protocol, and media transfer. TypeScript + WebCrypto
only. If code and this document disagree, one of them is a bug.

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

The raw fragment key is imported once as HKDF material, then immediately
discarded in favor of non-extractable subkeys (salt: `utf8("mindline-v2")`,
info strings below):

| Subkey      | info                  | Use                                  |
| ----------- | --------------------- | ------------------------------------ |
| `k_msg`     | `mindline/v2/msg`     | AES-256-GCM for chat/control/sync    |
| `k_eph`     | `mindline/v2/eph`     | AES-256-GCM for drafts/presence      |
| `k_storage` | `mindline/v2/storage` | AES-256-GCM at-rest (history, blobs) |
| `k_auth`    | `mindline/v2/auth`    | HMAC-SHA-256 for handshake/signaling |
| `k_media`   | `mindline/v2/media/{transferId}` | per-transfer chunk key    |

All AES subkeys are imported non-extractable. `k_msg`/`k_eph`/`k_storage`/
`k_auth` are persisted as non-extractable CryptoKeys in IndexedDB
(`mindline-keys` store, keyed by roomId) so revisiting `/{roomId}` without
the fragment still opens local history on the same device. The raw fragment
key is never persisted.

### 1.3 Device identity

- Per-device ECDSA P-256 keypair, generated non-extractable, stored in
  IndexedDB. (P-256 over Ed25519: universal WebCrypto support.)
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
  sig?: string;               // base64url ECDSA P-256/SHA-256 over c (t='msg' only)
}
```

- Body (plaintext before encryption) is the existing `TypedP2PMessage`
  discriminated union (`chat`, `typing`, `edit`, `delete`, `reaction`,
  `sync-*`, `delivery-ack`, control messages), plus a `seq` field:
  per-sender monotonic counter for replay rejection.
- **Nonces**: random 96-bit per envelope. Per-sender random nonces at chat
  volume are far below GCM collision bounds; media uses counters (§5).
- **AAD**: length-prefixed encoding (`u32be(len) ‖ utf8(field)` per field) of
  `[roomId, s, t]` — exactly the external context a receiver knows before
  decrypting. A ciphertext cannot be replayed in another room, as another
  sender, or under the other key class; attacker-chosen ids cannot play
  delimiter games. Body type, messageId, and `seq` live inside the
  authenticated plaintext, so they need no separate binding; same-context
  replay is rejected by the `seq` high-water mark.
- **Signatures**: `t='msg'` envelopes are signed over `AAD ‖ nonce ‖
  ciphertext` (~100 µs); receivers verify against the TOFU pubkey for `s`. Edit/delete/reaction authorization =
  same deviceId as the original message. `t='eph'` (drafts ~per keystroke)
  skips signatures; drafts are transient UI.
- Receivers maintain per-sender `seq` high-water marks (with a small
  reorder window for `eph`) and drop replays; `chat` dedupe by messageId
  stays as today.

## 3. Connection lifecycle

### 3.1 Signaling (discovery only)

Unchanged server (`signaling-server.js`): join/offer/answer/ice/relay with
server-assigned ephemeral `clientId`. Two client-side changes:

- Every signaling payload a client sends includes its stable `deviceId` plus
  `hmac: HMAC(k_auth, deviceId + '|' + clientId + '|' + roomId)`. Peers
  ignore signaling from senders whose HMAC fails (the operator can still see
  metadata; it can no longer inject offers/ICE as a fake room member).
- On signaling reconnect, clients re-announce; peers remap deviceId →
  new ephemeral clientId. Healthy DataChannels are never torn down by
  signaling loss.

### 3.2 Perfect negotiation

Polite/impolite role per pair: `polite = deviceId_self < deviceId_peer`
(lexicographic, stable across reconnects). Standard perfect-negotiation
pattern (rollback on collision), `restartIce()` on `connectionState:
'failed'` with re-signaling, exponential backoff, and full teardown guards
(every timer/listener registered in a per-peer AbortController).

### 3.3 Channels

| Label   | Options                          | Carries                       |
| ------- | -------------------------------- | ----------------------------- |
| `chat`  | ordered, reliable (no maxRetransmits) | msg envelopes: chat/edit/delete/reaction/sync/control/ack |
| `eph`   | unordered, `maxRetransmits: 0`   | eph envelopes: drafts, presence pings |
| `media-{transferId}` | ordered, reliable, per transfer | media manifests + chunks (§5) |

### 3.4 Key confirmation (replaces `ready`)

On `chat` channel open, both sides send
`hello { deviceId, name, spki, proof: HMAC(k_auth, 'hello|' + deviceId + '|' + channelFingerprint) }`
encrypted as a normal `msg` envelope. A peer that cannot produce a valid
envelope+proof is marked **unverified**: no sync, no messages accepted,
surfaced in UI as "knocking without the key". Only key-confirmed peers count
as participants.

### 3.5 Sync

Cursor-paginated: `sync-request {since, cursor}` →
`sync-response {messages[≤50], nextCursor?}` (each page ≤ 48 KB before
encryption; ordered `chat` channel). Edits reconcile by
`(messageId, editTimestamp)` last-writer-wins; reaction state syncs as the
full per-message reaction map, not deltas (fixes resurrection). Only to
key-confirmed peers.

### 3.6 Relay of last resort

If ICE fails (no direct, no TURN), `msg` envelopes (only) may transit the
signaling relay, same bytes as the DataChannel would carry. The v1 ECDH
relay crypto and the plaintext compatibility path are deleted. Media never
relays (16 KB server cap); UI degrades honestly ("direct connection needed
for files").

## 4. Storage at rest

- `mindline-messages` (IndexedDB): per room, AES-GCM blobs of message pages
  encrypted with `k_storage` (nonce random, AAD `roomId|storage|page`).
  localStorage history (plaintext) is migrated then deleted.
- `mindline-blobs`: media blobs encrypted with `k_storage`, keyed
  `{roomId}/{transferId}`; object URLs created on demand and revoked on
  room leave; "burn room" deletes keys + messages + blobs.
- Quota: `navigator.storage.estimate()` before accepting media; refuse at
  <2× incoming size headroom. `persist()` requested on first media receipt.

## 5. Media transfer

### 5.1 Flow

```
offer    →  { transferId, kind: file|image|voice|video, name, mime, size,
              sha256, thumb?: base64 (≤12 KB webp), duration? }   // chat ch.
accept   ←  { transferId }            // receiver consent; auto-accept ≤ 5 MB
            (sender opens media-{transferId} channel)
chunks   →  binary frames             // media channel
complete →  { transferId }            // media channel, after last chunk
abort    ⇄  { transferId, reason }    // chat channel, either side
```

- Caps: image 25 MB, file 100 MB, voice 10 min, video 90 s / 50 MB.
  Multi-peer fan-out is sender-pays: send queue processes peers
  sequentially on mobile, 2-way parallel on desktop.

### 5.2 Chunk framing (binary, not JSON)

`k_t = HKDF(fragment key, info='mindline/v2/media/'+transferId)`.
Chunk plaintext = 15 KB (safe under the 16 KB cross-browser floor after
+28 B framing overhead). Frame layout:

```
u32 chunkIndex (BE) | 12 B nonce | ciphertext+tag
nonce = u32(chunkIndex) ‖ 8 zero bytes   (deterministic, per-transfer key)
AAD   = utf8(transferId + '|' + chunkIndex)
```

- Backpressure: `bufferedAmountLowThreshold = 256 KB`; sender pauses above
  1 MB buffered, resumes on `bufferedamountlow`. No reads ahead of consent.
- Integrity: GCM per chunk + whole-file SHA-256 verified against the offer
  before the blob is committed; mismatch → abort + UI error.
- Failure: peer loss or refresh mid-transfer aborts (no resume in v1);
  receiver discards partial buffers. Deferred explicitly: resume,
  multi-source, relay media.

### 5.3 Capture paths

- **Photos**: `<input type=file accept=image/*>` (+ `capture` on mobile).
  Re-encode via `createImageBitmap` → canvas → WebP q0.82, max edge 2048 px
  (strips EXIF/GPS by construction); skip re-encode for already-small
  non-JPEG files. Thumbnail 32 px longest edge → base64 webp in the offer.
- **Voice**: MediaRecorder, `audio/webm;codecs=opus` where supported, else
  `audio/mp4` (Safari). Store mime with blob; `<audio>` handles playback.
  Waveform: 64 normalized peaks sampled during recording, sent in the offer.
- **Video**: MediaRecorder camera capture, `video/webm;codecs=vp8,opus` or
  `video/mp4` (Safari), hard 90 s timer.

## 6. Threat model (honest version)

| Adversary                  | What they get                                                  |
| -------------------------- | -------------------------------------------------------------- |
| Network observer           | Traffic shape only (DTLS/WSS everywhere)                       |
| Signaling operator         | Room IDs, deviceIds, presence times, ciphertext when relaying. No content, no names. Cannot inject (HMAC) or MITM relayed content (no key) |
| TURN operator              | Encrypted SCTP/DTLS packets, peer IPs                           |
| Link-holder (intended or leaked) | Everything: history sync + live room. The link is the key — share sheet says so |
| Past participant           | Keeps everything already synced; static room key (no rotation in v1, documented) |
| Device thief / forensics   | Needs the device profile; at-rest data is AES-GCM, keys non-extractable in IndexedDB |
| XSS / malicious extension  | Game over (can use keys in place). Mitigation: strict CSP, zero third-party runtime origins, self-hosted fonts |

Claims forbidden until true, everywhere in README/PRIVACY/UI: "messages
never leave your devices" (false when relaying: ciphertext transits the
server), "no metadata" (server sees rendezvous metadata), "forward secrecy"
(none in v1).

## 7. Test contract

Unit (vitest): HKDF vectors + cross-room key independence; AAD tamper
rejection (room/sender/type swap); nonce uniqueness under 10k concurrent
sends; seq replay rejection incl. reorder window; signature verify/forge;
edit/delete authorization; sync page reconciliation (edit LWW, reaction
maps); media frame round-trip + chunk reorder/corruption rejection; storage
encrypt/decrypt + migration from v1 plaintext.

E2E (Playwright, blocking tier): two-browser live-typing progressive
assertion (substring grows across ≥3 snapshots before send); wire-level
ciphertext assertion on the **DataChannel** path (hook
`RTCDataChannel.prototype.send` in an init script, assert no plaintext
leaves on chat/eph/media channels); unverified-joiner lockout (no fragment →
no sync, marked knocking); two-browser file transfer with SHA-256 equality;
photo EXIF-stripped assertion (send GPS-tagged JPEG, received blob has no
EXIF); reload → key-from-IndexedDB → history opens without fragment.
