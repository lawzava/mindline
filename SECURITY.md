# Security Policy

Mindline is an end-to-end-encrypted, peer-to-peer chat application. Its
security claims are documented and enforced against the code — see
[`docs/PROTOCOL.md`](docs/PROTOCOL.md) (the implementation-defining spec and
threat model) and [`docs/CLAIMS.md`](docs/CLAIMS.md) (every user-facing claim,
graded, with the code/test that enforces it). If the code and those documents
disagree, that is a bug, and we want to hear about it.

## Reporting a vulnerability

**Please do not open a public issue for a security vulnerability.**

Report privately through **GitHub's private vulnerability reporting**:
on this repository, go to the **Security** tab → **Report a vulnerability**
(or [open an advisory directly](https://github.com/lawzava/mindline/security/advisories/new)).
This keeps the report confidential until a fix is available.

When reporting, please include:

- A description of the issue and the security property it breaks (confidentiality,
  integrity, authenticity, availability, metadata exposure).
- Steps to reproduce, a proof of concept, or the relevant code path.
- The affected version/commit and environment (browser, hosted vs. self-hosted).

## Our commitment

- We acknowledge reports within **72 hours**.
- We aim to provide an initial assessment within **7 days**.
- We coordinate a disclosure timeline with you and credit you in the advisory
  and changelog unless you prefer to remain anonymous.

## Scope

In scope:

- The web application (`src/`) and its cryptography (`src/lib/crypto/`,
  `src/lib/p2p/`, `src/lib/media/`, `src/lib/storage/`).
- The signaling server (`signaling-server.js`).
- The hosted instance at `mindline.chat` / `signal.mindline.chat`.

## Out of scope — known and accepted limits

These are documented properties of the design, not undiscovered bugs. Reports
that restate them will be closed as "by design" with a pointer here. (Full
detail: `docs/PROTOCOL.md` §6 and `docs/CLAIMS.md`.)

- **A malicious or compromised build of the app is game-over.** Like any
  web-delivered messenger, every page load runs the JavaScript the server/CDN
  delivers; encryption cannot defend against a backdoored build of the app
  itself. SRI does not fix this. See
  [`docs/BUNDLE_VERIFICATION.md`](docs/BUNDLE_VERIFICATION.md).
- **XSS / malicious browser extension is game-over.** Keys are non-extractable
  CryptoKeys, so an attacker cannot exfiltrate the key bytes — but same-origin
  script can *use* the keys in place. The strict CSP is the mitigation.
- **The invite link is a bearer capability.** Anyone who obtains the full link
  (`#k=…`) can read and write the room, including history. Leaking the link is
  not a vulnerability in Mindline.
- **Rendezvous metadata is visible to the operator.** The signaling server and
  Cloudflare see room IDs, per-device identifiers, IP addresses, and timing —
  and, on the last-resort relay path, the sending device id plus ciphertext
  size and timing. They never see content or the link key.
- **Peers see each other's IP addresses** when connecting directly (no TURN).
- **History at rest is encrypted under a link-derived key (`k_storage`)** that
  does not ratchet; it is not forward-secret against later link disclosure.
- **Classical signatures (ECDSA P-256) are quantum-forgeable.** This is an
  authenticity risk against link-holders only, not a confidentiality break, and
  has no harvest-now-decrypt-later exposure (`docs/PROTOCOL.md` §1.3).

## Supported versions

Security fixes target the current `main` branch and the hosted instance.
Mindline is pre-1.0; there is no long-term-support branch yet.
