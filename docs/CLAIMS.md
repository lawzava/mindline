# Claims register

Every user-facing security claim, graded **TRUE**, **TRUE-WITH-CAVEATS**
(caveats named), or **NOT-MADE**. A claim may not appear in README,
PRIVACY, UI copy, or marketing unless it appears here with a grade and an
enforcing reference. If code and this register disagree, one of them is a
bug — same rule as PROTOCOL.md.

Permanently NOT-MADE, never to appear anywhere: "uncrackable",
"military-grade", "no metadata", "messages never leave your devices".

| Claim | Grade | Enforced by |
|-------|-------|-------------|
| Every message, draft, sync page, and media chunk on the wire is AES-256-GCM ciphertext under link-derived keys | TRUE | `src/lib/crypto/envelope.ts`, `keys.ts` (HKDF subkeys, §1.2); E2E wire assertion hooks `RTCDataChannel.send` and the relay frames (`required-typing.spec.ts`, `required-network.spec.ts`) |
| The link key never reaches any server | TRUE-WITH-CAVEATS — the browser can leak the URL: history sync to a non-E2E cloud account, share-sheet targets | URL-fragment design (§1.1; fragments are not sent in HTTP); caveat disclosed in PRIVACY.md and the share copy |
| Members cannot forge, edit, or delete each other's messages | TRUE-WITH-CAVEATS — drafts/presence are unsigned and spoofable by room members (§2); reactions are currently keyed to a self-asserted senderId (Phase 1 fix tracked) | ECDSA P-256 envelope signatures (§2); ownership checks in `handlers.ts` |
| Chat history and media are encrypted at rest | TRUE-WITH-CAVEATS — same-origin script (XSS, malicious extension) can use the non-extractable keys in place (§6); legacy plaintext for rooms whose keys were never persisted is deleted, not encrypted (§4) | `src/lib/storage/messages.ts`, `src/lib/media/blob-store.ts`; `message-storage.test.ts` (ciphertext-at-rest, AAD fail-closed, migration) |
| Leaving with burn removes the room's keys, history, and media from the device | TRUE-WITH-CAVEATS — peers keep their copies; the device keypair is per-device and survives; a message landing in another tab in the instant before the burn broadcast arrives can re-persist | `src/lib/storage/burn.ts` (+ BroadcastChannel evacuation); `burn.test.ts`; residue-free E2E in `room-page.spec.ts` |
| Live drafts, history sync, and media never transit the server | TRUE | `relayEligible` + inbound policy in `src/lib/p2p/connection.ts`; `relay-policy.test.ts`; E2E asserts zero `eph` envelopes reach the relay |
| Relay use is visible in the UI | TRUE | `ConnectionStatus.svelte` ("relayed via server", per-peer chips); asserted in `required-network.spec.ts` |
| The signaling operator cannot read or inject messages | TRUE-WITH-CAVEATS — it sees rendezvous metadata, relayed-SDP IPs, and on the relay path the sender deviceId + ciphertext size + timing (PRIVACY.md) | HMAC signaling auth (§3.1), envelope signatures + replay guard (§2), hello channel binding (§3.4) |
| Photos are stripped of EXIF/GPS before sending | TRUE | unconditional re-encode in `src/lib/media/image.ts` (§5.3); EXIF E2E test |
| Forward secrecy | NOT-MADE — v1 has none; a leaked link exposes past and future content. Phase 1 design work | Stated plainly in PRIVACY.md "Honest caveats" and README "Honest limits" |
| Post-quantum content confidentiality | TRUE-WITH-CAVEATS — holds because content keys are symmetric-only (no key agreement to harvest; Grover leaves ~128-bit effective strength). ECDSA signatures are quantum-forgeable — an authenticity risk, not confidentiality (Phase 2); the DTLS transport layer is classical ECDHE but only wraps already-E2E ciphertext and is browser-controlled | Key schedule PROTOCOL.md §1 (no asymmetric agreement protects content), threat model §6 |
| No accounts, analytics, tracking, third-party scripts, or runtime CDN | TRUE | CSP in `svelte.config.js` (self + hashed inlines); self-hosted fonts; zero third-party runtime origins |
| You don't have to trust the server with content | TRUE-WITH-CAVEATS — you re-trust the *served JavaScript* on every page load; a malicious build could exfiltrate keys. This is the ceiling of every web-delivered messenger vs an installed, signed app | E2E encryption design; ceiling disclosed in README "Honest limits"; bundle verification is tracked Phase-1 work |
