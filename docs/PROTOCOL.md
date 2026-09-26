# Mindline Protocol v4

This is the portable, implementation-defining spec for Mindline's E2E
encryption, P2P wire protocol, and media transfer. TypeScript + WebCrypto,
plus exactly one pure-JS post-quantum library (§1.3) — no WASM. If code
and this document disagree, one of them is a bug.

Revision 2: incorporates an adversarial review pass — media nonce-salt
fix, seq epochs, defined channel binding, sync caps, platform corrections.

Revision 3: key generations with a signed, gid-identified grant
certificate and a `g == g+1` adoption invariant (wire forward secrecy,
§1.4); handshake subkey + envelope `g` field and version-bound AAD (§2);
replay multi-epoch window over a device-identity-scoped monotonic epoch
high-water that survives burn — no peer-side reset, so no reopened replay
window (§2); canonical `lp()` in every binding and media-key derivation
(§0 violations removed). v3 is a hard wire cutover from v2 — pre-launch,
no install base: deployed v2 sessions stop interoperating and must
reload. v3 receivers drop `v: 2` envelopes.

Revision 4: per-device **hybrid post-quantum
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
and the material then dropped. The raw key is persisted only
AES-256-GCM-wrapped inside the room's keystore record (same protection
class as the KEM seed, §1.3), so a fragment-less rejoin can still copy the
invite; burn deletes it with the record. It is not kept in localStorage.
The fragment stays in the address bar by design: people copy invites from
it, and a keyless URL would lock the recipient out. After a burn, the device
keeps a hashed tombstone of the room ID so that going Back into the old URL
asks before re-creating the room.

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

**One key per room per device.** The room ID is public to the operator and
anyone who saw the path, so a link carrying a *different* key for a room
this device already holds is refused, never adopted: adopting would
re-encrypt the stored history under the newcomer's `k_storage` and serve it
through sync to whoever minted that link. The check compares
`HMAC(k_auth, lp("mindline/v2/key-commit", roomId))` under the stored and
the offered `k_auth` (the keys are non-extractable, so a MAC under one key
verified under the other is the comparison). On mismatch the stored keys,
ratchet state, and Recent rooms entry stay untouched and the UI says so;
to switch keys the user burns the room first.

### 1.3 Device identity

- Per-device ECDSA P-256 keypair, generated non-extractable, stored in
  IndexedDB. (P-256 over Ed25519 for installed-base reach: Ed25519 WebCrypto
  is Baseline only since mid-2025.) Identity creation is an **atomic
  get-or-create** (get + conditional put in one IndexedDB transaction,
  the same allocator pattern as the §2 epoch high-water and the KEM
  identity below): concurrent first tabs on a fresh device converge on
  one keypair/deviceId instead of racing onto two.
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
- **Safety numbers.** A device fingerprint is
  `SHA-256(lp("mindline/safety/v1/device", spki_b64, kem_b64))`, covering both
  hello keys. A pair's safety number is `SHA-512(lp("mindline/safety/v1/pair",
  hex(lo), hex(hi)))` over the byte-sorted fingerprints, shown as 12 groups of
  `uint40(5 bytes) mod 100000`; both sides see the same 60 digits. Comparing
  them out of band confirms nobody substituted keys between the two devices
  (the link alone proves membership, not identity). A person's verification
  is stored locally as `(deviceId → fingerprint, name)` and applies across
  rooms. The UI flags a verified device whose fingerprint changed, and a
  different device presenting a verified device's name. In person, one side
  can show the number as a QR code (`MINDLINE-SAFETY:1:` + the 60 digits)
  and the other scans it with the camera; the scanner compares it with its
  own number, marks the device verified on a match, and warns on a
  mismatch. Decoding stays on the device (the platform BarcodeDetector, or
  jsQR loaded only when a scan starts). The code holds public-key-derived
  digits only, nothing secret.

**Quantum-signature posture.**
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
confidentiality boundary.

Reliable direct-channel receives run in order, including asynchronous
hello verification and grant adoption. Reliable direct-channel sends serialize
sealing and sending with hellos and grants, preserving the shared replay sequence.
Minting and grant distribution use the same send queue. Before sending a
message under a new generation, the sender first sends that destination's
grant. Queues are bounded, and history sync awaits each page's send before
submitting the next page. Drafts remain on the independent lossy channel.

A member that sees an envelope it cannot decrypt at a known
`g`, or a hello advertising a `gid` it lacks, sends
`rekey-request { g, gid?, haveG, haveGid }` direct-only; the answer is a
grant for the responder's **current** generation carrying the rk-free
ancestor certificates linking it back to the requester's stated
position. At most `MAX_CHAIN` ancestor certs ride one grant — the cap
bounds per-message wire size and verification work.

A member behind by more than `MAX_CHAIN` generations **on the established
line** (a deep *gap* — it was offline/partitioned through 33+ membership
changes, same line) catches up by **segmented chain transfer**: it reports
its accumulation **frontier** in `haveG/haveGid`, the responder serves the
**first** `MAX_CHAIN` ancestor certs above that frontier (vs the tail-slice
that links a within-bound tip), the requester verifies that segment as a
consecutive run extending its frontier and accumulates it **decrypt-key-free**
(only the tip ever carries `rk`), then advances its frontier and asks for the
next segment. The current tip rides every round and is adopted only once the
accumulated run connects to it — so missed generations are never keyed,
only their rk-free lineage is verified, and the missed content re-syncs at
the current generation (§3.5). The accumulator is held only in memory (a
reload re-fetches it, which also denies a reloaded engine a fresh sibling
window). Each round costs at most `MAX_CHAIN` cert
verifications and is paced by the per-recipient request cooldown; total
speculative accumulation is bounded by `MAX_SEGMENTED_DEPTH`
(= 8·`MAX_CHAIN`), past which the member gives up to link re-entry. The
bound is the explicit ceiling on the member-grade cost of a peer feeding a
verified-but-fabricated parallel line: it commits nothing (no generation,
no keys) until a complete run to a real tip adopts.

A deep **fork** — two partitions each ratcheting more than `MAX_CHAIN` past
a shared fork below the receiver's current generation — is **not** healed by
segmented transfer (the winning line's served certs never anchor at the
receiver's frontier, which sits on the losing line; the receiver provably
fails to anchor rather than mis-converging). It keeps the documented
recovery: the losing side **re-enters through the link** — leave and rejoin,
which is the same members-only trust its position already implies (see
Bootstrap below) and loses nothing: identity persists and history re-syncs
(§3.5). A receiver detects this case after a bounded number of
non-anchoring rounds and stops re-requesting from that peer (so the futile
loop terminates), surfacing the stranded state.

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
  siblings to bloat retained keys and trial-decrypt. The
  window opens only when a generation *becomes* current (mint or adopt)
  and is **never re-opened by a reload**: a revived engine treats its
  current generation's window as closed — otherwise any member could
  wait out a peer's reload and plant a lone sibling that the rest of
  the room rejects, splitting that peer off.

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
`MAX_CHAIN` of `g_f` (the tip cert rides as the grant itself, so the
chain budget is spent entirely on ancestors). A partition that ratchets
deeper than that past the fork (33+ membership changes while split) is
**not** recovered by the segmented catch-up that heals a deep *gap*: the
winning line's served certs branch off below the losing receiver's
current generation, so they never anchor at its frontier (which sits on
the losing line) — the receiver fails to anchor rather than mis-converging,
detects the no-progress after a bounded number of rounds, and the losing
side **re-enters through the link** (leave + rejoin → bootstrap onto the
winning line; identity persists, history re-syncs §3.5). Availability-only,
like every fork. Forks are **availability**
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
**Periodic rotation.** Joins and leaves are not the only triggers: an active
generation is retired after 15 minutes or 200 chat messages, whichever comes
first (idle generations are left alone), through the same debounced,
minter-selected path. With retired keys destroyed two generations on, a
device compromise opens at most the current and previous generations of
captured traffic, about the last half hour of an active room. Per-message
forward secrecy (sender-key chains) is not built; see ROADMAP.md.

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
unaudited and would loosen CSP) is an accepted, stated
caveat. ECDSA signatures remain classical.

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
  duplicates. Concurrent tabs thus get **distinct, strictly
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
  property an earlier wall-clock seed delivered, now without the
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
member). `join` names the room by its **rendezvous id**,
`base64url(HMAC(k_auth, lp("mindline/v2/rendezvous", roomId))[0..24))`,
never the path roomId: the operator, and anyone who saw only the URL
path, cannot find or watch the room. `join` carries no client auth (the
server strips it anyway);
deviceId↔clientId binding is established by the first authenticated
offer/answer or relay broadcast, including after signaling reconnects.
Healthy DataChannels are never torn down by signaling loss.

Managed TURN credentials (when the operator configures Cloudflare TURN) ride
a repeated `client-id` message carrying the socket's own `clientId` plus
`iceServers`; clients replace their managed ICE servers on each one. The
welcome `client-id` carries none. The server sends credentials only once the
socket's room holds another member, to every member, ahead of the
`room-joined` / `peer-joined` that builds the new pair's connections. The
server also caps members per room and concurrent sockets per client IP; an
over-cap join gets an `error` message and an over-cap socket is closed
(1013), like the existing capacity limits.

Incoming signaling preserves event order through asynchronous authentication.
Outgoing offers, answers, and ICE candidates preserve order through signing
and dispatch. Both queues are bounded and discard work from obsolete sockets
or peers, so candidate authentication cannot overtake the offer creating a peer.

### 3.2 Perfect negotiation

Polite/impolite role per pair: `polite = deviceId_self < deviceId_peer`
(lexicographic, stable across reconnects). If device IDs match, as for two tabs
on one device, compare their server-assigned client IDs instead. Standard perfect-negotiation
pattern (rollback on collision), `restartIce()` on `connectionState:
'failed'` with re-signaling, exponential backoff, full teardown guards
(callbacks check peer and socket identity after asynchronous work).

Candidates are gathered on demand by default. An ICE attempt also has a
15-second deadline, so a browser stuck in `new`, `connecting`, or `disconnected`
without a `failed` event still enters recovery. Each restart gets a fresh
deadline; signaling progress does not replenish the five-restart budget.
Connected or removed peers cancel both deadlines and pending restarts.
Exhaustion uses the existing authenticated relay fallback when permitted;
strict-direct peers are removed instead.

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

**Session binding (all bodies).** A body's `roomId` is sender-chosen and
never selects storage: every handler files what it receives under the room
this session is keyed to and drops bodies that name another room.
Otherwise a member of one room could write into, or pull the in-memory
history of, any other room held by the same tab. Likewise the envelope's
signer must equal the verified device of the channel it arrived on
(forwarders re-sign, §1.4); a member cannot pass off another member's
signed envelope as its own or spend that member's replay slots.

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

**Origin signatures.** Every message carries its author's signature over its
current state: `ECDSA-P256(device key, lp("mindline/v1/origin", roomId, id,
sender_device, timestamp, kind, body, editedAt, replyTo))`, where `kind` is
`text | media | deleted`, `body` is the text, a media descriptor
(`transferId\nname\nsize`), or empty for a deletion, and `editedAt` is set only
for an edited text message; `replyTo` is the quoted message id or empty
(a deletion signs it empty). The message stores `{sig, spki}`; the SPKI must
hash to `sender_device`. The author signs on send, edit, and delete, and the
signature rides the live `chat`/`edit`/`delete` body; receivers keep it only
if it verifies over the state they stored. History therefore carries the
author's signature whichever member serves it.

A message with a lifetime (`ttl`) or a timer event (`timer`, §4) is signed
over `lp("mindline/v2/origin", <the eight v1 fields>, ttl, timer)`, each
empty when absent. Messages with neither keep the v1 form, which older
clients verify. Because the label differs, a served copy that keeps its
signature but has its lifetime stripped, stretched, or added verifies under
neither form and is dropped. A copy with the signature removed too is only
an unverified copy, and §4 dates it by the timer in force when it was sent.

On receipt of a sync page: a copy that carries a signature must verify or it
is dropped; a copy without one (older clients) is kept but marked unsigned
and shown as an "unverified copy"; copies dated more than 10 minutes in the
future are refused. Deletions and edits of a message this device already
holds apply through sync only when signed by the same device that authored
it. A synced message claiming the receiving user (by user id or device id) is
dropped unless already held, so no member can put words in your mouth; the
cost is that your own messages do not come back to you after a burn. Every
synced message is filed under the session room and marked as synced, so it
never counts as a new arrival for unread counts or notifications. Reaction
maps remain unsigned (§3.7).

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
only. Live chat is attributed to the verified device, never to the body's
`senderId`, so a member cannot render as another member or as "you".
Media offers may not reuse the message id or transfer id of an attachment
already in the room (that would swap a stored blob), and only the
transfer's counterparty may abort it.

Reaction state arriving via sync (§3.5) is the serving member's asserted
full map: a malicious member can misrepresent past reaction state to a
device that syncs from it. Deleted-state and edits through sync require the
author's origin signature (§3.5).

Delivery receipts count only acknowledgments from the original, deduplicated
recipient set. Disconnecting does not remove an intended recipient or prove
delivery; a later valid acknowledgment can still count. Messages sent without
recipients are labelled local ("Not delivered yet"). A receiver acknowledges a
synced message only when the member serving it is its author
(`sender_device`), and any verified member's acknowledgment turns a local
message delivered. The outcome is stored on the message (`status`), so it
survives reloads. Missing receipt history does not imply delivery.

### 3.8 Admission

The link proves membership in the cryptographic sense (it opens the hello);
admission decides whether members let a device in.

**Anchor.** A room made on the landing page gets an id that commits to its
founder: `roomId = "f_" ‖ base64url(SHA-256(lp("mindline/v1/founder",
spki_b64, salt))[0..16))`. The founding operation (an `approve` carrying the
salt) is valid only if it hashes to the room id, so any device can check who
founded the room without trusting whoever relays the operation, and a device
that merely holds the link cannot found, flip, or join the room by signing
operations of its own. Rooms whose ids carry no anchor (made before §3.8)
are always open: every hello-verified device is a member.

**Roster.** The roster is a single hash chain written by one device at a
time: the **host** (the founder, until it hands the role to a member). Each
operation is
`ECDSA-P256(signer, lp("mindline/v2/roster", roomId, seq, prev, device, action, by, salt))`
where `seq` is its position, `prev` is the SHA-256 of the previous
operation's signed content (not its signature, so re-encoded signatures
cannot fork the chain), and `action` is `admit | remove | host` for a device
or `approve | open` for the room (device `*`). An operation is accepted only
if it continues the chain and is signed by the host at that point; the host
cannot remove itself without handing the role on. There are no clocks: a
removed member cannot backdate its way back, a device that is not the host
cannot store anything, and there are no concurrent writers to reconcile. A
complete chain replaces the one a device holds if it contains it and goes
further. Two valid operations at one position mean whoever was host there
signed both: the branch whose operation hands the host role on wins (an
ex-host cannot legitimately sign past its own handover); if both branches
hand it on, the host equivocated, admission freezes where it is, and the UI
says so. Merges are serialized, so peers sending the chain at once cannot
interleave appends. Until a device has seen the founding operation
it treats nobody as a member. A room opened by the host admits everyone; the
host can close it again. A device keeps its chain locally; burn deletes it.
The trade-off is availability: only the host lets people in or removes them,
so a room whose host is offline cannot admit anyone until the host returns.

**Enforcement** is on every member's side. A device that is not admitted is
**waiting**: the connection seals nothing for it under room keys (no chat,
drafts, sync, media, or generation grants), answers none of its generation
requests, adopts none of its grants, and drops every body it sends. Members
adopt only grants whose minter is a member, so a line minted by a device
that was never let in cannot enter anyone's history even when forwarded.
Every connection in an anchored room carries an `admission` notice on the
`hs` class (`pending | admitted | denied | removed`, readable with the
link-static handshake key, so no grant is needed) with the sender's roster
operations; the receiver merges them and derives its own standing from the
roster, never from the notice's claim (a `denied` counts only from the
host). Admitting welcomes the new member as usual
(names, history) and mints a new generation at once; every member that
learns of a removal (or of the room closing again) also mints at once, so the last generation anyone mints
postdates the removal everywhere and the removed device reads nothing sent
after it. Join requests show a device fingerprint and flag names that match
a current member; at most five wait for an answer at once, and a device
turned away is not shown again that session. Relay-only devices cannot
receive notices or grants and stay waiting until a direct path exists; members
also send their chain to every member they connect to, over any transport,
so a member that was offline learns of removals from whoever it meets. Each
peer may send at most 8 roster messages per 10 seconds (verifying a chain
costs signatures), and at most 20 waiting devices are tracked at once.

What admission does not change: the link still decrypts hellos and anything
sealed at the link generation (g = 0) — none of which is sent to a waiting
device; a removed device keeps what it already received; and whoever holds
the link can knock again, which a member must answer. A roster is sent whole
in each notice and caps at 512 operations (about 40 fit the relay's frame
limit); a full roster needs a new room. Names on join requests are
self-chosen: the request shows 8 characters of the device id and flags an
exact name match with someone present, but not look-alike names. A device
holding the link can keep knocking under fresh identities to crowd the
request list.

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
- **Passkey lock (optional, per device).** The start page offers "Lock
  Mindline with a passkey". A WebAuthn passkey with the PRF extension
  (user verification required) evaluates a random 32-byte salt; the output
  goes through HKDF-SHA-256 (salt, info `lp("mindline/v1/device-lock")`)
  to a non-extractable AES-256-GCM lock key held in the tab's memory only.
  With the lock on, each `mindline-keys` room record holds only
  `locked = AES-GCM(lock key, link key, AAD lp("mindline/v1/locked-room", roomId))`
  and no CryptoKeys; `k_storage`, `k_auth`, `k_hs` and the media base are derived
  again after each unlock. The device record `lock` keeps the credential id,
  the salt, and a known text under the lock key, which tells a wrong passkey
  from a right one. Turning the lock on converts every room and writes the
  lock record in one IndexedDB transaction; rooms whose link key this device
  never kept cannot be locked, so they are named and removed first (without
  a burn tombstone). While a lock record exists, the keystore refuses to
  write any room in the clear (`LockedError`), and each unlock locks or
  removes room records another tab wrote in the clear meanwhile. The app
  shows only the lock screen until the passkey is used; every full page
  load starts locked, and "Lock now" reloads. Losing the passkey leaves one
  way out: remove every room from the device (rejoin with the links).
  Turning the lock off (needs it open) restores ordinary records. Limits:
  a tab left open is open; history pages and media stay encrypted under
  `k_storage` as before, which the lock now keeps off the device; generation
  state (§1.4), device identity, and metadata stay readable (Recent rooms
  with their names and times, rosters, verified safety numbers); a synced
  passkey unlocks from any device where it is available, with that device
  also holding a copy of this one's data; a passkey provider without PRF
  cannot be used, and the option is hidden where WebAuthn is missing or
  the browser reports no PRF support.
  Link keys and browser history: with the lock on, a room made or joined
  from the start page gets its key handed over in memory, never through
  the address bar, and a link opened from elsewhere has its fragment
  replaced out of the address bar once the room is saved (invites still
  copy from the room menu). A link opened before the lock, or the original
  visit of an outside link, may remain in the browser's own history
  database; the confirmation says to clear it. Tabs: every lock write
  happens in one transaction that first checks the lock record is still
  the one it was prepared for (so a tab with a stale view cannot lock over
  an existing lock or write a room in the clear while another tab turns it
  on); an in-memory key is checked against the current record before use;
  sweeps skip rooms rewritten or burned since they were read; and tabs
  announce the lock going on or off over a BroadcastChannel. Forensics:
  IndexedDB engines may keep replaced values (including the pre-lock room
  records) on disk until they compact their files.
- **Disappearing messages.** Any member sets the room's timer (off, 5
  minutes, 1 hour, 1 day, 1 week) by sending a timer event: a `chat` body
  whose `timer` field is the new lifetime in ms (0 = off), shown as a line
  in the stream. Only trusted timer events count: signed ones, or live ones
  from the verified author. Sync refuses an unsigned timer event, and one
  already held is not shown and expires like any unsigned copy. The room's timer is the latest by `(timestamp, id)`; a new
  event is dated after the one it replaces, messages dated more than 10
  minutes ahead are refused live as in sync (so a future-dated event cannot
  freeze the setting), and a live timer event dated more than 10 minutes
  back is refused. Timestamps must be integers. Timer events never expire
  (one carrying `ttl` is refused), so a newcomer learns the setting through
  sync; trimming history to its 500-message cap keeps the event in force
  where the kept history starts. While the timer is on, every message and
  media offer carries `ttl` (30 s to 90 days; anything else is refused, not
  kept). An **unsigned** copy without `ttl` takes the timer in force at its
  timestamp: a member serving history can strip `ttl` and the signature
  with it, and the signed timer events still date the copy. A signed or
  live message without `ttl` is its author's word and is never shortened,
  so a backdated timer event cannot delete what others said. Every device
  deletes a message at `timestamp + lifetime` by its own clock: the room view drops
  it when due (waking at least hourly), every history load and save drops
  expired messages and deletes their media blobs (the save must filter, or
  merging with the page on disk would bring the message back), media that
  finishes arriving after its message went is deleted on arrival, sync
  never serves an expired message, and a receiver refuses one that is
  already expired. `ttl` and `timer` are covered by the origin signature
  (§3.5). Limits: a member can keep what it saw (screenshots, a modified or
  older client that ignores `ttl`); a copy backdated to before the timer
  was turned on is kept, as an unverified copy; the browser may keep
  overwritten IndexedDB bytes on disk until it compacts its files; a device
  that never reopens Mindline deletes nothing until it does (opening the
  start page purges recent rooms).
- `k_storage` is link-static and does **not** ratchet with §1.4: at-rest
  protection targets device theft/forensics, and the §1.4 forward-secrecy
  claim explicitly excludes it (a leaked link plus a copy of a member
  device's IndexedDB pages still decrypts them). Named in CLAIMS.md.
  **At-rest generation re-keying is not done, by design.** The only adversary any re-keying would defeat is
  one who captured the `mindline-messages` page ciphertext but **not** the
  `mindline-keys` key records, while also holding the link — because today
  `k_storage` is link-derived, that adversary needs no key DB at all.
  Decompose that capture: Chromium stores all of an origin's IndexedDB
  databases in **one LevelDB instance**, so there is no file boundary
  between the two to capture across — if the attacker has the pages, it
  has the keys; Firefox and Safari/WebKit keep one SQLite file per
  database, so a surgical single-file leak is *conceivable* there, but
  every adversary §6 actually names (device theft, disk forensics, XSS,
  malicious extension) obtains both databases or neither, and a
  non-extractable WebCrypto key is a script-API boundary a file-level
  adversary reads through regardless. Two constructions were evaluated and
  both rejected: (a) per-generation `k_storage(g)` re-encrypting pages on
  every ratchet — a third key-lifecycle class, a ratchet-aware storage
  layer, cross-tab churn, and an enlarged silent-history-loss surface
  exercised on every join/leave, for that near-fictional adversary; (b) a
  cheaper device-local random storage secret (`k_storage` off a wrapped
  per-device seed instead of the link) — it removes link-derivability with
  no churn, but it is the exact mirror of the gain: it also removes today's
  link-deterministic **recovery** of a keys-only storage loss (e.g. Safari
  ITP evicting the key DB, §6/§1.2), orphaning history permanently. Closing
  a near-fictional read-path by forfeiting a real recovery-path fails the
  project's honesty bar. **Revisit triggers:** at-rest pages moving out of
  same-origin IndexedDB into a separately-capturable store, or a platform
  shipping per-database isolation worth defending. CLAIMS.md's
  forward-secrecy at-rest exclusion stands unchanged.

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
  The sender uploads separately to each accepting peer; there is currently
  no device-specific limit on concurrent recipients.
- Offers serve each original recipient at most once. Pending acceptance
  expires after 10 minutes. Each session retains at most 64 pending offers;
  exceeding that limit expires the oldest offer. Expiration sends
  `media-abort` with reason `offer expired` to pending recipients. Transfers
  already accepted continue. Offers retain metadata; each accepted transfer
  reads its payload from encrypted local storage.

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
- Receivers process frames, completion, and channel closure in order,
  including asynchronous decryption. A storage failure aborts the transfer
  and produces a failed attachment instead of leaving progress stalled.
- Room teardown cancels pending media writes, including active IndexedDB
  transactions. Burn notifications also erase media in observing tabs, so
  a write committed before notification cannot survive their cleanup.
- Failure: peer loss or refresh mid-transfer aborts (no resume in v1);
  receiver discards partials. Deferred explicitly: resume, multi-source,
  relay media.

### 5.3 Capture paths

- **Photos**: `<input type=file accept="image/*,video/*">`; no forced
  capture, so mobile users can choose their gallery or camera.
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
  reasonably current Safari to play. Cross-engine playback remains
  unverified. Waveform: 64 normalized peaks sampled during recording,
  sent in the offer. The 10-minute limit stops capture and sends the
  completed recording. Cancel or room exit releases microphone tracks,
  including permission requests that complete after exit.
- **Video**: the composer sends selected video files, limited to 50 MB.
  The recorder supports a 90-second video limit, but the composer does not
  currently expose that capture path. Cross-engine playback remains unverified.

## 6. Threat model (honest version)

| Adversary                  | What they get                                                  |
| -------------------------- | -------------------------------------------------------------- |
| Network observer           | Traffic shape only (DTLS/WSS everywhere)                       |
| Signaling operator         | Room IDs, deviceIds, presence times, ciphertext when relaying. No content, no names. Cannot inject (HMAC) or read relayed content (no key). Archived relay ciphertext of generations ≥ 1 stays unreadable even given a later-leaked link (§1.4) |
| TURN operator              | Encrypted SCTP/DTLS packets, peer IPs                           |
| Link-holder (intended or leaked) | Entry + history-by-sync, as a visible peer (§1.1, §1.4). Passive + later leak: captured grant ciphertext — relay-archived (never happens), endpoint-captured, or future-quantum-recovered from recorded DTLS — stays unreadable: `rk_g` is hybrid-wrapped (X-Wing) to the recipient device's KEM key (§1.4 v4); only compromise of that device's key store opens it |
| Past participant           | Keeps everything already synced, and the link (can rejoin visibly). Loses passive read of post-departure traffic once the leave-triggered ratchet lands (§1.4) |
| Room member (malicious)    | Can spoof drafts/presence of others (eph unsigned); cannot forge, edit, delete, or react as others (signatures + §3.7 authorization); can misrepresent history it serves to a syncing device (§3.5); can grief the ratchet — fork a joiner, mint-flood, grind low gids to re-root lines (§1.4) — an availability nuisance, never a read of traffic it was not granted |
| Device thief / forensics   | Needs the device profile; at-rest data is AES-GCM, keys non-extractable in IndexedDB. With the passkey lock on, also needs the passkey (and its user verification) to open any room; without it, gets metadata, plus any room link the browser's own history still holds from before the lock or from an outside link (§4). In a room with a disappearing-messages timer, gets only what has not expired yet (§4) |
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
per-grant chain cap enforced; **segmented deep-gap catch-up** — a member
more than `MAX_CHAIN` behind on the established line converges across
multiple rounds in `⌈(tip−1−curG)/MAX_CHAIN⌉` segments, each ≤ `MAX_CHAIN`
certs, an `'extended'` round moving no key/generation, a non-anchoring
segment committing nothing, the `MAX_SEGMENTED_DEPTH` cap wedging to link
re-entry, and a reload dropping the in-memory accumulator yet still
converging), same-`g` tie-break by lower `gid` bounded
by the convergence window and the per-`g` instance cap (window closed
across reload — a revived engine rejects a lone same-`g` sibling), line
finality (a
sibling-rooted `+1` not adopted), newcomer bootstrap (first verified
grant at any `g`; normal rules thereafter), fork heal (window-free
lower-`gid` at the fork for a line extending past it; lone post-window
sibling stays rejected; heals at depth exactly `MAX_CHAIN`), trial-decrypt across retained `(g,gid)` keys,
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
