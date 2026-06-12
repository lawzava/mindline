# Mindline Protocol v4

This is the portable, implementation-defining spec for Mindline's E2E
encryption, P2P wire protocol, and media transfer. TypeScript + WebCrypto,
plus exactly one pure-JS post-quantum library (§1.3) — no WASM. If code
and this document disagree, one of them is a bug.

Revision 2: incorporates adversarial review (docs/analysis/
protocol-verification.json) — media nonce-salt fix, seq epochs, defined
channel binding, sync caps, platform corrections.

Revision 3: key generations with a signed, gid-identified grant
certificate and a `g == g+1` adoption invariant (wire forward secrecy,
§1.4); handshake subkey + envelope `g` field and version-bound AAD (§2);
replay multi-epoch window over a device-identity-scoped monotonic epoch
high-water that survives burn — no peer-side reset, so no reopened replay
window (§2); canonical `lp()` in every binding and media-key derivation
(§0 violations removed). v3 is a hard wire cutover from v2 — pre-launch,
no install base: deployed v2 sessions stop interoperating and must
reload. v3 receivers drop `v: 2` envelopes.

Revision 4 (owner-decided, 2026-06-12): per-device **hybrid post-quantum
wrapping of generation secrets**. Every device adds an X-Wing
(X25519 + ML-KEM-768) KEM keypair beside its ECDSA identity (§1.3),
advertised and TOFU-pinned in the hello (§3.4); a rekey-grant carries
`rk_g` only wrapped to one recipient's KEM key (§1.4). This closes the
former residual 4 (endpoint-captured grants were link-readable) and the
one genuine harvest-now-decrypt-later path to content. Same hard-cutover
rule as v3→v2: envelope `v: 4`, hello labels `hello-v4`/`hello-relay-v4`,
v4 receivers drop `v: 3` envelopes; pre-launch, no install base.

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

Subkeys split into two families. **Link-static keys** derive from the
fragment key and never rotate — they are what "holding the link" means
(membership bootstrap, at-rest access). **Generation keys** derive from
the current generation secret `rk_g` (§1.4) and rotate with it. The raw
fragment key is imported once as HKDF material (salt:
`utf8("mindline-v2")`, info strings below), the static subkeys derived,
and the material then dropped — it is never persisted.

Link-static (from the fragment key):

| Subkey        | info                     | Use                               |
| ------------- | ------------------------ | --------------------------------- |
| `k_storage`   | `mindline/v2/storage`    | AES-256-GCM at-rest               |
| `k_auth`      | `mindline/v2/auth`       | HMAC-SHA-256 handshake/signaling  |
| `k_hs`        | `mindline/v3/handshake`  | AES-256-GCM for hello + rekey-grant bodies (§3.4, §1.4) |
| `k_mediaBase` | `mindline/v2/media-base` | HMAC-SHA-256 base for media keys  |

Generation-keyed (from `rk_g`, §1.4; same salt):

| Subkey        | info                     | Use                               |
| ------------- | ------------------------ | --------------------------------- |
| `k_msg(g)`    | `mindline/v3/msg`        | AES-256-GCM for chat/control/sync |
| `k_eph(g)`    | `mindline/v3/eph`        | AES-256-GCM for drafts/presence   |

`k_mediaBase` stays static deliberately: media chunks travel only over
direct DTLS channels (§3.6 — never relay), so there is no capturable
ciphertext for a leaked link to retro-decrypt; rotating it would buy
nothing and break fragment-less revisit playback. `k_hs` is static
because it is the membership bootstrap: a hello must be decryptable by
members regardless of how far the room has ratcheted past the joiner.
Note the consequence: `k_hs` is derivable from the link, so it provides
no confidentiality against a link holder. For hellos that is fine (they
carry identity metadata a link holder could learn by joining). For
rekey-grants, `k_hs` is only the **outer membership gate**: the secret
inside is additionally wrapped to the recipient device's KEM key
(§1.4 v4), so a captured grant is unreadable to a link holder. The
carrier restriction — grants travel only over direct DTLS channels whose
operator-MITM is detectable via the §3.4 binding, and never relay (§1.4,
§3.6) — remains as defense in depth and metadata hygiene, no longer as
the sole confidentiality boundary.

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
- Per-device **X-Wing KEM keypair** (X25519 + ML-KEM-768,
  draft-connolly-cfrg-xwing-kem-10; implementation `@noble/post-quantum`
  0.6.1, exact-pinned, pure JS — **not independently audited**, the caveat
  is named in CLAIMS.md). It receives the hybrid grant wraps of §1.4. The
  keypair is deterministic from a 32-byte seed; because no native WebCrypto
  PQC exists, the seed cannot be a non-extractable CryptoKey — it is
  persisted only AES-256-GCM-wrapped under a non-extractable wrapping key
  stored beside it (the same at-rest protection class as the WebCrypto
  keys; no raw key bytes in any record), and the public key is re-derived
  from the seed on load. The public key rides the hello beside the ECDSA
  SPKI and is TOFU-pinned with it (§3.4); `deviceId` remains a fingerprint
  of the ECDSA SPKI alone.
- Residual limit (documented, inherent to capability URLs): a key-holder can
  mint new identities; they cannot impersonate an existing deviceId.

**Quantum-signature posture (Phase-2 item 9, owner-decided 2026-06-12).**
Signatures stay classical ECDSA P-256, deliberately. The reasoning, in
full, because it bounds what a quantum adversary gets:

- Against **non-members**, authentication never rested on ECDSA. Envelope
  validity requires the symmetric room/generation keys (AES-256-GCM with
  bound AAD, §2), membership proof is the symmetric `k_auth` HMAC (§3.4)
  — both quantum-adequate. An outsider with a CRQC and a recovered device
  key still cannot mint a single valid envelope.
- ECDSA defends **attribution against link holders**: member↔member
  non-impersonation (§2 signatures, §3.7 authorization), the §3.4
  defense against a link-holding operator MITM, and grant-cert minter
  authenticity (§1.4). Against a link holder, confidentiality is already
  conceded by the capability model — what signatures protect is who said
  what, and forging that requires a **live CRQC at message time**. There
  is nothing to harvest: a recorded signature does not become a forgery
  later; recorded *content* is what harvest-now-decrypt-later threatens,
  and that is symmetric (plus hybrid-wrapped grants, §1.4 v4).
- Device keys are rotatable: TOFU re-pin, and the project has already
  executed two hard wire cutovers. A signature-algorithm migration before
  CRQCs exist loses nothing.
- Precedent and guidance: every production E2EE messenger that deployed
  post-quantum cryptography (Signal PQXDH/SPQR, iMessage PQ3, Tuta, the
  MLS PQ ciphersuites draft) ships hybrid PQ key agreement with
  **classical** signatures, for exactly this asymmetry; NIST IR 8547
  (draft) deprecates ECDSA after 2030 and disallows it after 2035.
- The cost side, measured against this protocol: hybrid ML-DSA-65 would
  grow every signed envelope by ~4.4 KB (a typical chat envelope is
  ~380 B), push a MAX_CHAIN grant chain past the 64 KiB DataChannel
  budget, and put an unaudited PQC implementation on the *integrity*
  path, where a bug forges rather than merely fails to add protection.

**Named residual** (CLAIMS.md): a link-holding adversary with a live
CRQC could impersonate existing members and minters until rotation —
an attribution break, not a confidentiality one.

**Rotation trigger**: hybridize signatures (LAMPS composite pattern —
domain-separated payload naming the algorithm pair, both signatures
must verify) when WebCrypto ML-DSA reaches cross-engine availability,
or earlier on credible CRQC acceleration. Until then this section is
re-evaluated whenever the threat model is revisited.

### 1.4 Key generations (wire forward secrecy)

The room runs at an integer **generation** `g ≥ 0`, carried on every
envelope (§2). Generation 0's secret is the fragment key itself
(`rk_0 = link key`); every later secret is **32 fresh random bytes**
minted by the ratcheting member — deliberately *not* an HKDF chain from
`rk_{g-1}`: any deterministic chain rooted in the link would let a
leaked link derive every future generation, which is precisely the
property being removed. `k_msg(g)`/`k_eph(g)` derive from `rk_g` (§1.2).

**What this buys (exact claim — CLAIMS.md must not exceed it).** Wire
ciphertext a **passive** adversary captured — in practice the signaling
operator archiving relay frames, the only party that ever sees envelope
ciphertext (§3.6; direct paths are DTLS) — becomes undecryptable with a
later-leaked link for every generation `g ≥ 1`, because `rk_g` never
derives from the link and never transits a relay. Once members destroy a
generation's keys (retention policy below), it is gone on their side too.

**What it does not buy** (each a named CLAIMS residual). (1) A leaked
link still grants *entry* — join, then history-by-sync. That is the
capability-URL membership model, unchanged and visible: a joiner appears
as a peer, runs §3.4, and is TOFU-pinned. (2) At-rest history stays
under static `k_storage` (§4): link + a copy of a member device's
IndexedDB still decrypts stored pages. At-rest generation re-keying is
explicitly deferred (§4). (3) Members hold the current generation by
definition; forward secrecy is about *captures*, not about revoking
members. (4) **Recipient-device compromise.** Since v4, grant ciphertext
captured anywhere — relay archive (never happens, grants never relay),
endpoint debug log, browser extension, disk forensics, or a
future-quantum decryption of recorded DTLS — is unreadable without the
*recipient device's* KEM key: `rk_g` is wrapped per recipient (below),
and the wrap is hybrid, so a quantum break of X25519 alone does not open
it. What remains is the adversary who has the recipient device's KEM
seed — i.e. its IndexedDB plus the wrapping key — and that adversary
class already reads the device's at-rest history (§4/§6); the wrap
cannot defend against the endpoint it terminates on. (5) An **active**
adversary holding the link at grant time is simply a member (capability
model) and reads the room live; the §3.4 binding detects a *keyless*
operator MITM, not a link-holding one. The claim is
passive-and-later-leak, never active.

**Generation identity.** A generation is identified not by `g` alone but
by `gid = base64url(SHA-256(rk_g))[0..16]`. `gid` is unforgeable without
`rk_g` and unpredictable, so it both names the generation instance and
proves the namer holds the key. Two members that independently mint at
the same `g` produce different `rk_g` and therefore different `gid` —
the wire distinguishes them (below), which `g` alone cannot.

**Grant certificate (chained).** The original minter signs a certificate
`cert = ECDSA(minterDeviceKey, lp('rekey-grant', roomId, str(g), minterDeviceId, gid, prevGid))`
where `prevGid` is the `gid` of the generation this one succeeds
(`prevGid = ''` only for `g = 1` succeeding the link generation, whose
`gid` is fixed `gid_0 = SHA-256(rk_0)[0..16]`). The grant body is
`rekey-grant { g, minter, minterSpki, gid, prevGid, wrap, cert }` where
`wrap = { ct, n, wrapped }` carries `rk_g` **wrapped to one recipient**
(v4): `ct` is an X-Wing encapsulation against the recipient's
hello-pinned KEM key (§1.3/§3.4), and `wrapped` is `rk_g` sealed
AES-256-GCM under the encapsulated shared secret with fresh nonce `n`
and AAD `lp('grant-wrap', roomId, str(g), gid, recipientDeviceId)` — a
wrap cannot be replayed across rooms, generations, or recipients, and
only the addressed device can open it. A recipient verifies
`SHA-256(minterSpki)==minter` and `cert` against `minterSpki`, unwraps,
and checks `H(rk)==gid` before considering the grant — so a forwarder
cannot claim a forged low `minter` to win a tie-break (F2), nor
substitute its own `rk` under an honest member's identity (the signed
`gid` commits to the secret; the wrap layer cannot smuggle a different
one past that check). The `prevGid` link makes
the generation line a **hash chain**: minting generation `g` requires
naming `gid_{g-1}`, which a member only knows if it actually held
generation `g-1` (or was served its certificate, below — still members
only), so no member can fabricate a far-ahead `g` to wedge the room (F1)
— the chain, not a numeric `< 2³²` bound alone, is what forecloses leaps.

Members retain the **certificate log** of their line — the rk-free part
of each grant (`{g, minter, minterSpki, gid, prevGid, cert}`). Certs
contain no secrets, so the log persists (unlike raw `rk`, which never
does) and is what lets a member serve lineage to a behind peer long
after the old generations' keys — and their raw secrets — are gone.

**Distribution (rekey-grant).** The minter sends each verified **direct**
peer the grant as a signed `hs` envelope (§2), `rk_g` wrapped to that
peer (above) — grants are inherently per-recipient wires. A recipient
that *adopts* re-grants the certificate **verbatim** (same `cert`, same
`minter`) to its own verified direct peers, **re-wrapping** the secret
it now holds for each of them — gossip, so meshes and partitions
converge without the minter reaching everyone. The transport `hs`
envelope is re-signed by each forwarder (envelope `s` = forwarder); the
inner `cert` is never re-signed. Grants never relay (§3.6) — since v4 a
defense-in-depth and metadata rule (§1.2), with the wrap as the
confidentiality boundary. A member that sees an envelope it cannot decrypt at a known
`g`, or a hello advertising a `gid` it lacks, sends
`rekey-request { g, gid?, haveG, haveGid }` direct-only; the answer is a
grant for the responder's **current** generation carrying the rk-free
ancestor certificates linking it back to the requester's stated
position. At most `MAX_CHAIN` ancestor certs ride one grant — the cap
bounds per-message wire size and verification work. A member behind by
more than `MAX_CHAIN` generations (the room rotated 32+ times while it
was away) cannot chain-verify that far and **re-enters through the
link** — leave and rejoin, which is the same members-only trust its
position already implies (see Bootstrap below) and loses nothing:
identity persists and history re-syncs (§3.5).

**Convergence (chained total order on `(g, gid)`).** A grant is
*admissible* only if its `cert` verifies and `g` is a non-negative
integer `< 2³²`. Among admissible grants:
- `g == g_current + 1` and `prevGid == currentGid`: adopt (the normal
  forward step). Forward steps chain **only from the established line**
  — a `prevGid` naming a retained *losing* sibling is not adopted (the
  line is final); the stranded sibling-minter converges later through
  the fork-heal rule below.
- `g > g_current + 1`: do not adopt on the grant alone — the receiver is
  behind. The gap is crossed by the grant's accompanying rk-free
  ancestor certs (or a `rekey-request` round to fetch them): the receiver
  verifies each cert's signature and `prevGid` linkage as one consecutive
  run from its own line up to the tip, then adopts the tip (only the tip
  carries `rk` — old keys are neither needed nor obtainable; missed
  content re-syncs at the current generation, §3.5). This lets a member
  arbitrarily far behind **catch up** without ever honouring an unchained
  leap (closes the strict-`+1` liveness gap while keeping F1's wedge
  defence).
- `g == g_current` with a *different* `gid`, tip not extending further: a
  lone same-generation sibling (concurrent mint). Resolve to lower `gid`.
  To bound grind/flood, lone siblings are accepted **only within a short
  convergence window** (`SIBLING_WINDOW`, from first observing `g`) and
  at most a small fixed number of generation instances are retained per
  `g`; after the window the established `gid` is final within the
  connected partition and a later lone sibling is rejected (a
  genuinely-behind member instead requests the established generation).
  This stops a member from forcing unbounded ever-lower same-`g`
  siblings to bloat retained keys and trial-decrypt (review #3).

**Bootstrap (newcomer).** A member still at the link generation that has
never adopted or minted accepts its **first verified grant at any
admissible `g`**, chain or no chain: its anchor is `gid_0 = ''`, and a
chain down to that anchor proves nothing a fabricated one could not (any
link-holder can sign a complete parallel line from scratch), so the
joiner's actual trust anchor is the §3.4-verified member and channel the
grant arrived on. Certs served with the bootstrap grant seed the
joiner's log. Named residual: the granting member can hand a joiner a
*fork* — a fabricated line the rest of the room is not on. That is a
member-grade denial of service (the same member could refuse to grant,
serve garbage sync, or lie in history), not a confidentiality loss, and
it heals through fork-heal below once an honest line's chain reaches
the joiner.

**Fork heal (partitions).** Two partitions that each ratchet past the
sibling window would otherwise split permanently — each side's window
has closed against the other's line. Heal rule: a verified chain that
diverges from the receiver's line at some ancestor `g_f` **and extends
past it** is resolved by the same lower-`gid` tie-break applied at the
fork point, **window-free**: if the incoming line's `gid` at `g_f` is
lower, the receiver adopts the incoming line's tip (even when that tip's
`g` is at or below its own — re-minting forward resumes immediately);
otherwise it rejects, and the *winning* side converges the room by
minting past the loser's tip so the heal applies in the other direction
(a lone post-window sibling never heals — that is the flood bound; a
line must extend past the fork to claim it). **Depth bound** (same
`MAX_CHAIN` bound as catch-up, and for the same reason): the heal needs
the fork cert inside one admissible run, and runs end at the tip — so a
fork heals in-protocol only while the *winning* line's tip is within
`MAX_CHAIN` of `g_f`. A partition that ratchets deeper than that past
the fork (32+ membership changes while split) is recovered the same way
as a deeper-than-`MAX_CHAIN` gap: the losing side **re-enters through
the link** (leave + rejoin → bootstrap onto the winning line; identity
persists, history re-syncs §3.5). Availability-only, like every fork. Forks are **availability**
events, not confidentiality events — every line is minted by a member
and granted only to members — so a deterministic symmetric tie-break is
sufficient; a member abusing heal to repeatedly re-root the room (each
re-fork needs a strictly lower `gid` at the fork, i.e. hash-grinding
`rk` candidates) is the same member-grade DoS class as flooding, named
in §6.

The chain + lower-`gid` tie-break (live at the current `g`, window-free
at a fork) is a deterministic total order, so concurrent ratchets and
healed partitions converge on one winner (F3). `g` is never advanced
from a hello advertisement — only from a verified grant chain.

**Key retention and the FS horizon.** Encryption always uses the winning
current generation. The receiver retains *decrypt-only* keys for prior
and losing-sibling generations indexed by `(g, gid)`, and **trial-decrypts**
an incoming envelope across the retained keys for its `g` — so a winner
adopting `g` never silently drops a losing sibling's in-flight `g`
traffic (F3). Retention is an **availability** parameter, deliberately
separated from the FS horizon: a generation is *retired* (no longer used
to encrypt) the instant a successor is adopted — that is what bounds new
ciphertext — and its decrypt keys are destroyed once **two** further
generations have superseded it (generation `X` dies when `X+2` is
adopted, so a member holds the current and the immediately preceding
generation, plus any same-`g` siblings the convergence window retained). Destroying old wire keys does not lose *content* **as long
as a key-confirmed direct peer still holds the history to serve**:
history re-syncs re-encrypted under the current generation (§3.5), so a
member that missed a generation recovers those messages by sync, not by
hoarding old keys. The conditional matters — if the only reachable peers
are relay-only, offline, or have themselves dropped the history (and the
item was not a sync-excluded oversized one, §3.5), that content is not
recoverable; this is the same reachability dependency sync already has.
The FS guarantee is therefore "no new ciphertext under a retired
generation, and its keys are gone within two further ratchets"; backward
key recovery is impossible by design.

**Triggers and minter selection.** Any member may ratchet. Mandatory
triggers: (a) a verified newcomer join; (b) an explicit member leave or
burn-on-leave. The minter is the **lowest-deviceId verified direct peer
that currently holds a grantable (non-reloaded) generation** — i.e. one
that still has raw `rk_g`. Concurrent mints converge by `(g, gid)`.
Join-triggered ratchets are debounced (one ratchet per burst of joins
within a short window) so a churning room does not ratchet per-join.
Raw generation secrets are **never persisted** — members persist only
the derived non-extractable `k_msg(g)`/`k_eph(g)` CryptoKeys (plus
retained generations, swept on startup). A reloaded member can read and
write but cannot grant. **Liveness rule (F2/F8):** a member asked for a
generation it can no longer grant (raw `rk` gone after reload, or the
generation is past retention) responds by **minting `g_current + 1`**
(fresh random — always possible without any prior secret) and granting
that; gossip propagates it room-wide. So the room can always make
forward progress even if every member has reloaded. Multi-tab: a tab
that ratchets or adopts persists the keys, then notifies siblings on
`BroadcastChannel('mindline_rekey')`; they re-read from the keystore.

**Relay-only members are stranded by a ratchet** (grants never relay):
they keep sending at their last generation — readable by others only
while that generation is still retained — and cannot read newer traffic
until a direct connection delivers a grant. The UI must say so
explicitly (extends the §3.6 relay honesty: "key rotation pending direct
connection"). Consistent with relay peers already having no sync and no
media.

**Quantum note (v4).** Generation secrets are distributed under
**hybrid** asymmetric wrapping — X-Wing per
draft-connolly-cfrg-xwing-kem-10 (pin: rev 10; the wire format is frozen
across recent revisions), secure while *either* X25519 *or* ML-KEM-768
holds — so the wrap never weakens the protocol below its classical
baseline and adds no harvestable surface. It closes the one genuine
harvest-now-decrypt-later chain this protocol had: an on-path recorder
of direct DTLS traffic + a future CRQC + a later link leak could have
recovered a v3 grant (DTLS is classical ECDHE in most engines; Chrome
142+ already hybrid-PQ-wraps WebRTC DTLS, other engines lag) and read
`rk_g` through link-derived `k_hs`. In v4 that chain dead-ends at the
recipient's KEM key. Content keys themselves remain symmetric-only
(§1.1/§1.2): AES-256-GCM under link- or generation-derived keys, already
quantum-adequate (Grover → ~128-bit effective, §6). The PQC
implementation choice (pure JS, unaudited — no independently audited
pure-JS PQC exists as of 2026-06; WASM alternatives are likewise
unaudited and would loosen CSP) is an owner-accepted, CLAIMS-named
caveat. ECDSA signatures remain classical (Phase-2 item 9: documented
argument, §1.3 posture — landing in the same change series).

## 2. Envelope (everything on the wire)

Every DataChannel payload and every relayed payload is exactly one JSON
envelope; there is no plaintext message path.

```ts
interface Envelope {
  v: 4;
  t: 'msg' | 'eph' | 'hs';   // which subkey class encrypted the body
  g: number;                  // key generation (§1.4); 0 for 'hs'
  s: string;                  // sender deviceId
  n: string;                  // base64url 96-bit nonce
  c: string;                  // base64url ciphertext (includes GCM tag)
  sig?: string;               // base64url ECDSA P-256/SHA-256, 'msg'+'hs'
}
```

- Key classes: `msg` → `k_msg(g)`, `eph` → `k_eph(g)`, `hs` → static
  `k_hs` with `g: 0` always (§1.2). `hs` carries only `hello`,
  `rekey-grant`, and `rekey-request` bodies; receivers reject other body
  types under `hs`, and reject those three under any other class.
- Body (plaintext before encryption) is the `TypedP2PMessage` discriminated
  union plus replay fields `epoch` and `seq` (below).
- **Nonces**: random 96-bit per envelope. All participants encrypt under the
  same room-wide `k_msg`/`k_eph`, so the GCM collision bound is over the
  room-wide total of encryptions per key — still negligible at chat volume
  (q²/2⁹⁷), and per-keystroke draft traffic burns `k_eph`, not `k_msg`.
  Note AAD does not mitigate an IV collision; GCM keystream depends only on
  key+nonce. Media volume uses salted counter nonces instead (§5.2).
- **AAD**: `lp(str(v), roomId, s, t, str(g))` — the protocol version plus
  exactly the external context a receiver knows before decrypting. A
  ciphertext cannot be replayed in another room, as another sender, under
  another key class, under another generation, or (cheap insurance for
  any future version interop) across a protocol version. Body type and
  ids live inside the authenticated plaintext.
- **Signatures**: `t='msg'` and `t='hs'` envelopes are signed over
  `AAD ‖ nonce ‖ ciphertext`; receivers verify against the TOFU pubkey
  for `s`. `t='eph'` skips signatures: drafts/presence are transient UI.
  Accepted residual: any room member can spoof another member's draft or
  presence ping (not their chat messages).
- **Replay — terminology**: the replay `epoch` below is a per-device
  *session counter*, unrelated to the key generation `g` (§1.4). The two
  advance independently.
- **Replay — sender (monotonic device high-water)**: senders stamp every
  body with `(epoch, seq)`. `epoch` is drawn from a **device-identity-scoped
  monotonic high-water** persisted alongside the device keypair (§1.3),
  *not* a room-scoped counter. On each session start the sender takes
  `epoch = max(Date.now(), highWater + 1)` and writes that back as the
  new high-water. The read-modify-write must be **atomic** so two tabs
  never draw the same epoch: serialize with the Web Locks API (lock name
  `mindline_epoch_{deviceId}`), and where Web Locks is unavailable use a
  single IndexedDB `readwrite` transaction as the allocator (read,
  increment, put in one transaction — IDB transactions are atomic) —
  **not** a plain read-increment-write, which races two tabs onto the
  same `(epoch, seq=0)` and gets the second tab's traffic rejected as
  duplicates (review #5). Concurrent tabs thus get **distinct, strictly
  increasing** epochs. `seq` restarts at 0 per session (per tab). The
  high-water never regresses, so the epoch a device presents always
  exceeds any value a peer persisted for it. Bound: the high-water is a
  safe integer; a one-time far-future clock leaves it permanently large
  but monotonic, which is harmless (it only ever needs to exceed peers'
  persisted values, never to be meaningful as a timestamp).
- **Replay — survives burn without self-censorship**: the high-water is
  scoped to the device identity, which a burn-on-leave preserves (burn
  clears room keys/history/replay and the *room*-scoped epoch markers,
  not the device keypair). So a burned device keeps a monotonic epoch
  line and is never censored by peers' persisted high-water — the
  property the Phase-0 wall-clock seed delivered, now without the
  regression hazard a corrected clock created. This **replaces** the
  channel-bound guard-reset the design first considered: because the
  epoch can no longer move backwards, no peer ever needs to reset its
  acceptance floor, which removes the reset's downgrade-replay window
  entirely (a reset would have re-admitted a sender's recently-captured
  signed control envelopes — edit/delete/reaction have no store-layer
  messageId dedupe — for a member or operator to replay; with no reset
  there is no such window). Only a device that loses its identity
  altogether reseeds, and that yields a new `deviceId` for which peers
  hold no high-water.
- **Replay — receiver**: per `(roomId, senderDeviceId, class)` the
  receiver retains up to `K = 4` concurrently-active epochs (a device
  legitimately runs several tabs, each its own epoch), each with its own
  seq state: `msg` requires strictly increasing seq within its epoch;
  `eph` accepts within a 64-entry reorder window, duplicates rejected.
  An envelope is accepted iff its epoch is in the retained set with
  fresh seq, or its epoch exceeds the largest retained (admitting it,
  evicting the smallest when over K). Epochs below the smallest retained
  are rejected. Eviction is one-way: an evicted epoch is rejected, never
  reopened, so epoch churn cannot manufacture a replay slot. State
  persists in IndexedDB across reloads. A reloaded sender is never
  censored; a delivered envelope is never accepted twice. The K cap also
  bounds concurrent tabs per device before the lowest-epoch tab
  self-censors — a self-inflicted, reload-healed limit.

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

On `chat` channel open, both sides send, as a signed `hs` envelope
(§2 — static `k_hs`, so members can verify a joiner regardless of how
far the room has ratcheted past it):

```
hello { deviceId, name, spki, kem, g, gid, proof }
proof = HMAC(k_auth, lp('hello-v4', deviceId, kem, fpLow, fpHigh))
```

`kem` is the device's X-Wing public key (§1.3, base64url), TOFU-pinned
together with the SPKI: a known deviceId presenting a changed SPKI *or*
a changed KEM key is rejected. The proof covers `kem`, so stripping or
substituting it fails the HMAC before the envelope signature is even
considered. A key that is well-sized but encapsulation-invalid (ML-KEM
modulus check) is rejected at the hello — accepting it would only
strand its presenter from every future grant. The `name` is a display
hint (§3.7) clamped to 64 characters in the hello, which bounds the
relay-hello frame under the §3.6 budget. `fpLow`/`fpHigh` are the two `a=fingerprint` values from the
negotiated SDP (local and remote), sorted lexicographically and fed to
`lp()` as separate fields — no delimiter joining (§0). The receiver
**recomputes** the binding from its own view of the connection and
verifies the proof; a captured hello replayed onto any other connection
fails. Because the hello is also ECDSA-signed under the device key (§2),
the binding it asserts cannot be re-forged by anyone lacking that key
even if they hold `k_auth` (a link holder): substituting fingerprints —
or the KEM key — requires re-signing the body, which a link-holding
operator MITM cannot do. The HMAC keeps a keyless operator out; the
signature keeps a link-holding one from impersonating the device. A peer
that cannot produce a valid envelope+proof is **unverified**: no sync,
no messages accepted, surfaced as "knocking without the key". Only
key-confirmed peers count as participants. `g`/`gid` advertise the
sender's current generation (§1.4): a verified hello whose `gid` the
receiver lacks at an equal or lower `g` prompts a `rekey-grant`; a
higher advertised `g` prompts a `rekey-request`. The hello never moves
the receiver's own generation — only a verified, sequential grant does
(§1.4, F1).

Relay variant (§3.6): no DTLS exists, so
`proof = HMAC(k_auth, lp('hello-relay-v4', deviceId, kem, clientIdLow,
clientIdHigh, roomId))` with the clientId pair sorted lexicographically
so both ends compute the same binding. Weaker (clientIds are
server-assigned),
acceptable because envelope signatures + the monotonic replay high-water
(§2) still hold; the operator can replay a stale hello but cannot mint
traffic with it — and, because the relay hello carries no rekey material
(grants never relay, §1.4/§3.6) and the replay high-water never regresses
(§2, so there is no acceptance floor to reopen), a replayed stale
relay-hello yields the operator nothing beyond a phantom presence entry.

### 3.5 Sync

Cursor-paginated over the `chat` DataChannel **only — sync never relays**;
relay-only sessions get live messages without history, and the UI says so.
`sync-request {since, cursor}` → `sync-response {messages[≤40],
nextCursor?}` with page plaintext capped at 32 KB (wire envelope ≈ 44 KB
after base64, safely under the 64 KiB SDP-default maxMessageSize). A
single history item whose serialized size exceeds the page cap is
excluded from sync entirely — it stays local and live-delivered only,
so no page can break the cap. Edits
reconcile by `(messageId, editTimestamp)` last-writer-wins; reaction state
syncs as the full per-message reaction map (fixes removal resurrection).
Only to key-confirmed peers. Sync pages are sealed under the **current**
`k_msg(g)` like any other `msg` envelope — history reaches a returning
member re-encrypted at the present generation, which is why catching up
never requires old generation keys (§1.4): grants restore live
readability, sync restores missed content.

### 3.6 Relay of last resort

If ICE fails (no direct, no TURN), live `msg` envelopes —
chat/edit/delete/reaction/delivery-ack/user-connected, plus the
relay-hello — may transit the signaling relay, same bytes as the
DataChannel would carry, after a relay-hello (§3.4). Each relayed frame
is size-guarded below the server's 16 KB `maxPayload` (oversized
envelopes are dropped instead of killing the socket). Drafts/presence
(`eph`), sync, media, and **rekey-grant/rekey-request** never relay —
since v4 the per-device wrap (§1.4) is the grant's confidentiality
boundary, and the relay ban stands as defense in depth plus metadata
hygiene (a relayed grant would hand the operator sender/size/timing for
the room's key-rotation events). Enforced outbound and inbound (a relayed `hs`
envelope other than the relay-hello is rejected). The connection
indicator shows relayed peers distinctly, including the post-ratchet
stranded state ("key rotation pending direct connection", §1.4), with
the relay-path metadata cost disclosed in PRIVACY.md. The v1 ECDH relay
crypto and the plaintext compatibility path are deleted. UI degrades
honestly ("direct connection needed for files").

### 3.7 Message authorization

Mutations of existing messages are authorized against the
envelope-verified sender deviceId (§2/§3.4) — never against ids carried
inside bodies, which any member can mint freely. For edit/delete: the
stored message's `sender_device` must equal the verified sender; a
message stored without `sender_device` (pre-v2.1 storage) is remotely
immutable — fail closed, no body-asserted fallback — though its owner
can still modify the local copy. For reactions: membership in a reaction
is the set of verified deviceIds that added it; a device can only add or
remove itself. Body fields (`senderId`, `senderName`) are display hints
only.

Reaction state arriving via sync (§3.5) is the serving member's asserted
full map: a malicious member can misrepresent past reaction state (and
deleted-state) to a device that syncs from it — the same trust extended
to all served history.

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
- `k_storage` is link-static and does **not** ratchet with §1.4: at-rest
  protection targets device theft/forensics, and the §1.4 forward-secrecy
  claim explicitly excludes it (a leaked link plus a copy of a member
  device's IndexedDB pages still decrypts them). At-rest generation
  re-keying (derive `k_storage(g)`, re-encrypt pages through the
  serialized per-room op queue on ratchet) is deferred: the
  partial-failure surface — a crash between deleting old-key pages and
  committing new ones — needs its own design pass, and the marginal
  adversary (link holder who also exfiltrated the ciphertext database
  but not the browser's key storage) is narrow. Named in CLAIMS.md.

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
| Signaling operator         | Room IDs, deviceIds, presence times, ciphertext when relaying. No content, no names. Cannot inject (HMAC) or read relayed content (no key). Archived relay ciphertext of generations ≥ 1 stays unreadable even given a later-leaked link (§1.4) |
| TURN operator              | Encrypted SCTP/DTLS packets, peer IPs                           |
| Link-holder (intended or leaked) | Entry + history-by-sync, as a visible peer (§1.1, §1.4). Passive + later leak: captured grant ciphertext — relay-archived (never happens), endpoint-captured, or future-quantum-recovered from recorded DTLS — stays unreadable: `rk_g` is hybrid-wrapped (X-Wing) to the recipient device's KEM key (§1.4 v4); only compromise of that device's key store opens it |
| Past participant           | Keeps everything already synced, and the link (can rejoin visibly). Loses passive read of post-departure traffic once the leave-triggered ratchet lands (§1.4) |
| Room member (malicious)    | Can spoof drafts/presence of others (eph unsigned); cannot forge, edit, delete, or react as others (signatures + §3.7 authorization); can misrepresent history it serves to a syncing device (§3.5); can grief the ratchet — fork a joiner, mint-flood, grind low gids to re-root lines (§1.4) — an availability nuisance, never a read of traffic it was not granted |
| Device thief / forensics   | Needs the device profile; at-rest data is AES-GCM, keys non-extractable in IndexedDB |
| XSS / malicious extension  | Game over (can use keys in place). Mitigation: strict CSP — `connect-src` pinned to self + the signaling origin (no any-host WebSocket exfil), zero third-party runtime origins, self-hosted fonts |

Platform residuals, documented user-facing: Safari evicts IndexedDB after
7 days without interaction unless `persist()` is granted — history and
device identity can vanish on rarely-used Safari profiles. Browser history
sync (Chrome/iCloud) can upload the room URL including the key fragment
unless the user's browser sync is E2E-encrypted.

Claims forbidden until true, everywhere in README/PRIVACY/UI: "messages
never leave your devices" (false when relaying: ciphertext transits the
server), "no metadata" (server sees rendezvous metadata). "Forward
secrecy" may be claimed only in the §1.4-scoped form — wire-capture
forward secrecy with capability-URL membership — never as an
unqualified property; at-rest and active-join exclusions must ride any
user-facing statement of it.

## 7. Test contract

Unit (vitest): HKDF subkey derivation + cross-room independence; AAD
context binding (version/room/sender/class/**generation** swaps
rejected); nonce uniqueness; (epoch, seq) replay rejection incl. reorder
window, the K-epoch multi-tab window (interleaved epochs accepted,
evicted-epoch rejection, delivered envelopes never re-accepted);
**monotonic device high-water** (epoch never regresses across reload,
clock-correction, or burn → never self-censored, with no peer-side
reset); generation machinery: `rk_g` subkey derivation + cross-generation
isolation, `gid = H(rk_g)`, chained grant-certificate verify/forge
(forged `minter` rejected; unchained `prevGid` rejected; far-ahead `g`
not adopted without a verified ancestor chain; multi-generation catch-up
via rk-free ancestor certs accepted, holes and tampered links rejected,
per-grant chain cap enforced), same-`g` tie-break by lower `gid` bounded
by the convergence window and the per-`g` instance cap, line finality (a
sibling-rooted `+1` not adopted), newcomer bootstrap (first verified
grant at any `g`; normal rules thereafter), fork heal (window-free
lower-`gid` at the fork for a line extending past it; lone post-window
sibling stays rejected), trial-decrypt across retained `(g,gid)` keys,
retention horizon (keys die two generations on), persisted ratchet state
round-trip without raw secrets, can't-grant → mint-next liveness
(including post-reload), unknown-generation drop, `hs`-class body-type
restriction both directions; signature
verify/forge; edit/delete
authorization; reaction membership transitions (verified-device keyed,
§3.7); sync page reconciliation (edit LWW, reaction maps); media
frame round-trip + reorder/corruption rejection + salt-distinct reuse;
storage encrypt/decrypt + v1 plaintext migration; IndexedDB CryptoKey
persistence round-trip; **v4 KEM wrapping**: X-Wing wrap/unwrap
round-trip with exact spec sizes, tampered-ciphertext and
wrong-recipient failure, per-field wrap-AAD binding
(room/generation/gid/recipient swaps all rejected), seed-deterministic
keypair, KEM identity persistence round-trip with no raw seed in any
stored record and burn-survival (device-scoped), hello KEM pinning
(changed KEM key for a known deviceId rejected), wire grants carry a
wrap and never raw `rk`, misdelivered grants (wrapped for another
device) fail closed without moving the receiver's generation, granting
to a peer with no pinned KEM key fails closed.

E2E (Playwright, blocking tier): two-browser live-typing progressive
assertion (substring grows across ≥3 snapshots before send); wire-level
ciphertext assertion on the DataChannel path (hook
`RTCDataChannel.prototype.send` in an init script, assert no plaintext on
chat/eph/media channels); unverified-joiner lockout (no fragment → no sync,
"knocking" state); two-browser file transfer with SHA-256 equality; photo
EXIF/GPS stripped **and** orientation preserved for a rotation-tagged JPEG;
cross-engine voice-note playback (record Chromium → play WebKit); reload →
keys from IndexedDB → history opens without fragment; ratchet E2E:
newcomer join triggers a generation bump, both sides converge on g and
keep chatting; two-tab same-room concurrent send (no replay
self-censorship); relay-only pair shows the stranded-rotation state
after a third member ratchets.
