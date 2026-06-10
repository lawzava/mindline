# Privacy Policy

**Last Updated: June 2026**

## The short version

Your messages are end-to-end encrypted with a key that exists only in your
invite link. We cannot read them: not in transit, not at rest, not when our
server relays them. What we unavoidably see is rendezvous metadata: which
room IDs connect, when, and from which IP addresses.

## What is encrypted, and with what

- Every message, live draft, history sync page, and media chunk is
  AES-256-GCM encrypted using keys derived from the 256-bit key in your
  invite link's URL fragment (`#k=...`).
- URL fragments are never sent to any server by your browser.
- Messages are signed with a per-device key, so room members cannot forge
  each other's messages, edits, or deletions.
- Chat history and received media are also encrypted at rest in your
  browser's storage, using a key derived from the same link key.

The complete protocol and threat model: [docs/PROTOCOL.md](docs/PROTOCOL.md).

## What the signaling server sees

The signaling server introduces browsers to each other. It handles:

- Room IDs (random identifiers; they grant no access without the link key)
- Device identifiers (random per-device fingerprints, not names)
- IP addresses and connection timing
- Encrypted payloads when a direct connection cannot be established and
  traffic must relay: ciphertext only, which it cannot decrypt or forge

It stores none of this. There is no database. Logs, if enabled by the
operator, contain at most the metadata listed above.

## What stays on your device

- Chat history (encrypted), received media (encrypted)
- Your display name and theme preference
- Room keys (non-extractable browser CryptoKeys) and your device keypair

Leaving a room with "burn" removes the keys, history, and media for that
room from your device. Other participants keep their copies.

## Honest caveats

- **The invite link is the room.** Anyone who obtains the full link can
  read everything, including history. Share it the way you would share the
  secret itself.
- **Browser sync can copy your keys.** If your browser syncs history or
  open tabs to a cloud account without end-to-end-encrypted sync, the
  invite link (key included) may land on that provider's servers.
- **Whoever you talk to keeps what you sent.** Past participants retain
  everything already synced to them.
- **Safari may evict storage.** Without the persistence permission, Safari
  deletes site storage (your keys and history) after 7 days without a
  visit.
- **No forward secrecy.** The room key does not rotate in this version; a
  leaked link exposes the room's past and future content.

## What we never have

- Plaintext messages, drafts, or media, under any code path
- Accounts, emails, phone numbers, or names
- Analytics, tracking pixels, third-party scripts, or runtime CDN fonts

## Changes

This policy changes only alongside the open-source code that enforces it.
