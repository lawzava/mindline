# Security Policy

Mindline is an end-to-end-encrypted, peer-to-peer chat application. Its
security claims are documented and enforced against the code — see
[`docs/PROTOCOL.md`](docs/PROTOCOL.md) (the implementation-defining spec and
threat model). If the code and that document disagree, that is a bug, and we
want to hear about it.

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
detail: `docs/PROTOCOL.md` §6.)

- **A malicious or compromised build of the app is game-over.** Like any
  web-delivered messenger, every page load runs the JavaScript the server/CDN
  delivers; encryption cannot defend against a backdoored build of the app
  itself. SRI does not fix this. See
  [`docs/BUNDLE_VERIFICATION.md`](docs/BUNDLE_VERIFICATION.md).
- **XSS / malicious browser extension is game-over.** Keys are non-extractable
  CryptoKeys, so an attacker cannot exfiltrate the key bytes — but same-origin
  script can *use* the keys in place. The strict CSP is the mitigation.
- **The invite link is a bearer capability.** Anyone who obtains the full link
  (`#k=…`) can reach the room. In a room that asks before letting people in
  (the default for new rooms), the room's host must let them in before they
  receive anything; in an open room they can read and write, including history.
  Leaking the link is not a vulnerability in Mindline.
- **Rendezvous metadata is visible to the operator.** The signaling server sees a
  key-derived rendezvous name; Cloudflare also sees room IDs in page URLs.
  Both see per-device identifiers, IP addresses, and timing —
  and, on the last-resort relay path, the sending device id plus ciphertext
  size and timing. They never see content or the link key.
- **Peers see each other's IP addresses** when connecting directly (no TURN).
- **History at rest is encrypted under a link-derived key (`k_storage`)** that
  does not ratchet; it is not forward-secret against later link disclosure.
  Rooms with a disappearing-messages timer keep only what has not expired.
  With the optional passkey lock on, no room opens without the passkey,
  except through a room link still in the browser's own history (links
  opened before the lock, or from outside the app); metadata such as the
  Recent rooms list stays readable.
- **Disappearing messages rely on every member's device.** A member can keep
  what it saw (screenshots, an older or modified client). Deletion happens by
  each device's clock when Mindline runs on it (`docs/PROTOCOL.md` §4).
- **Classical signatures (ECDSA P-256) are quantum-forgeable.** This is an
  authenticity risk against link-holders only, not a confidentiality break, and
  has no harvest-now-decrypt-later exposure (`docs/PROTOCOL.md` §1.3).

## Supported versions

Security fixes target the current `main` branch and the hosted instance.
Mindline is pre-1.0; there is no long-term-support branch yet.
