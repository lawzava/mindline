# Positioning and roadmap

Written 2026-09-26 from a full pass: hands-on two-browser testing, a
security audit of `src/lib/{crypto,p2p,media,storage}` and the signaling
server, and market research. Evidence is cited; everything else is
inference and marked as such.

## Where Mindline can win

WhatsApp (3B+ MAU) and Telegram (1B+ MAU) win on network effects, not
features. A CHI 2022 study of 1,525 WhatsApp users after the 2021 policy
change found most who tried to move chats elsewhere failed, because their
contacts stayed ([Caught in the Network](https://www.researchgate.net/publication/359118801)).
Usable-security studies find people pick messengers for peers and
usability; security drove the choice for about 1% of respondents
([Abu-Salma et al., S&P 2017](https://discovery.ucl.ac.uk/1560502/);
[ACM 3491265](https://dl.acm.org/doi/10.1145/3491265)).

So Mindline should not try to replace anyone's messenger. It should own
the **private live line**: a link you send when a conversation is
happening now, where the other person is talking within seconds and
nothing is left on a server afterwards. That is closer to a phone call in
text than to a messenger, which is what PRODUCT.md already says.

First audiences (inference, ranked by fit):

1. Two people coordinating live: support calls, walking a parent through a
   setup, remote pair work.
2. Sensitive one-off conversations: source and journalist, lawyer and
   client, a friend in crisis. "No account, no server copy, burn when done"
   is the product, not a feature.
3. Deaf and hard-of-hearing users. Real-time text is an existing
   accessibility need (FCC RTT guidance, Apple RTT, XMPP XEP-0301) with no
   private, install-free option.

## What the evidence says about live typing

- In a CHI 2023 study (24 participants), live typing lowered cognitive load
  and raised presence, but most preferred a plain "is typing" indicator
  for personal or conflict talk, and 20% felt "raw and exposed"
  ([Iftikhar et al.](https://dl.acm.org/doi/fullHtml/10.1145/3544548.3581248)).
- AIM's 2008 real-time IM was opt-in per conversation and recommended for
  1:1 chats ([Gallaudet TAP](https://tap.gallaudet.edu/Text/AOL/index.html)).
- Honk (2020 to 2024) drew real engagement with live, ephemeral chat and
  shut down after an acquisition, not user rejection
  ([sunset note](https://www.honk.me/sunset)).

Consequence, now shipped: the composer has a **Hold drafts / Go live**
toggle. Live typing stays the hero; the writer controls it.

## Growth loop

Every conversation starts with a shared link, so every conversation is an
acquisition. The loop only works if (a) the recipient's first screen is the
product at its best, and (b) recipients later start rooms of their own.

Measure these, not MAU: seconds from link open to first exchanged message;
share of recipients who later create a room; 30-day return to a saved room.

## Shipped in this pass

Security (each with a failing-then-passing test):

- A link with a different key for a known room is refused instead of
  silently replacing the stored key and serving history to its minter.
- Every incoming body is bound to the session room; a member can no longer
  write into or pull history from another room held by the tab.
- Live chat is attributed to the verified device; synced history cannot
  claim to be from you.
- The envelope signer must be the device of the channel it arrived on.
- Media offers cannot reuse existing ids (blob swap); only the transfer
  counterparty can abort; offers are schema-checked; received files open
  as downloads unless they are plain inline media.

UX:

- One live tab per room with "Use here" take-over (two tabs used to break
  delivery silently for both sides).
- Back leaves at once; Burn moved to the room menu behind a confirm.
- Unread count in the tab title; opt-in background notifications that
  name the sender only.
- Links are clickable (http/https only, no raw HTML).
- Screen readers read message text; drafts no longer announce every
  keystroke; idle draft contrast meets 4.5:1; long words wrap.
- Join toasts read "Alice is here"; no "left the room" toast after you
  leave; deleted messages read "This message was deleted".

## Next, in order

Security (from the audit; see PROTOCOL.md §6 for accepted limits):

1. **Safety numbers.** Shipped: per-pair 60-digit numbers in the peer list,
   locally stored verifications, and warnings for changed keys or a
   borrowed verified name. In person, one side shows the number as a QR
   code and the other scans it: a match marks the device verified.
2. **Signed history.** Shipped: authors sign each message state, history
   carries the signatures, forged copies are dropped, and unsigned copies
   from older clients show as "unverified copy". Media offers are signed on
   the author's stored copy only; reaction maps stay unsigned.
3. **Signaling hardening.** Done: client-IP headers honored only from
   configured proxies (`TRUSTED_PROXY_*`), per-IP connection and per-room
   member caps, TURN credentials delivered only once a peer is present.
   STUN moved from Google to Cloudflare (already in the path) and is
   disclosed in PRIVACY.md. Remaining: short-lived per-connection TURN
   credentials (today one timer-minted credential is shared; per-connection
   minting would let clients trigger Cloudflare API calls, so it needs its
   own rate limit). The server deploy is the operator's step.
4. **Link hygiene.** Shipped: link keys live only wrapped in the keystore
   (old plaintext entries migrate), the signaling rendezvous id is derived
   from the key, and Back into a burned room asks first. Decided against
   stripping the fragment from the address bar: people copy invites from
   it, and a keyless URL locks the recipient out. Exception: with the
   passkey lock on, the key stays out of the address bar and history.
5. **Admission and removal.** Shipped: new rooms have ids that commit to
   their founder's key; the host lets newcomers in (one tap while they
   wait), turns people away, removes them, or hands the host role on. The
   roster is a host-signed hash chain, and every removal rotates the room
   key. Remaining: letting members other than the host admit people
   (needs a conflict-free multi-writer roster).
6. **Forward secrecy within a generation.** Shipped: periodic rotation
   (every 15 minutes or 200 messages while active), which bounds a device
   compromise to about the last half hour of captured traffic. Not built:
   per-message sender-key chains. Design for a protocol review before any
   code: at each generation, every sender draws a random chain key and
   grants it to each member through the existing X-Wing wrap; message i
   uses HKDF(ck_i, "msg") and ck_{i+1} = HKDF(ck_i, "chain"), with the old
   key deleted and a bounded store of skipped keys for out-of-order
   delivery; the envelope AAD carries i. It rewrites the sealing path that
   the generation ratchet depends on, so it needs its own review and a
   staged rollout.

   **Owner decision (2026-09-26): not now.** A stolen device already opens
   all saved history (at rest it sits under the link-derived `k_storage`,
   which never rotates), so sender keys would protect only captured wire
   traffic the device did not keep. Direct paths are DTLS; the capturable
   traffic is mostly the server relay of last resort. That small gain does
   not justify rewriting the most fragile part of the protocol for every
   user. Revisit when relay use turns out to be common, when disappearing
   messages exist (wire forward secrecy then matters more), or with an
   external protocol review; ship any version behind a per-room switch.
7. **Code trust.** Shipped: reproducible builds, a public bundle check,
   and a daily watchdog (docs/BUNDLE_VERIFICATION.md); a pinned verifier or
   signed client remains.
8. **Protect saved history.** The larger exposure once a device is taken.
   Shipped: disappearing messages (any member sets the room's timer; each
   message's lifetime is signed with it; every device deletes expired
   messages and their media, and sync never serves them), and an optional
   passkey lock (WebAuthn PRF): room records keep only the link key sealed
   under the passkey-derived key, and no room opens until the passkey is
   used. Metadata (Recent rooms, rosters) stays readable.

Product:

1. ~~Name on first join, and the peer's name in the header.~~ Shipped.
2. ~~Replies, copy text, and jump-to-latest.~~ Shipped: replies quote from
   local history, the quote jumps to the original, and the signature covers
   the quoted id.
3. ~~Recent rooms as the home screen.~~ Shipped: each recent room shows the
   last thing said, decrypted from this device's history for display only.
   Not applicable: unread dots (messages only arrive while you are in the
   room) and who is online (it would mean probing the signaling server for
   rooms you are not in, which tells the operator you are watching them).
4. ~~QR invite on the empty-room screen for phone-to-phone sharing.~~ Shipped.
5. ~~Installable PWA.~~ Shipped as manifest, icons, and home-screen meta;
   no service worker until the update-check model (security item 6) is
   decided. Push "knock" is out of scope: it needs server-side
   push subscriptions, which the product does not store (decided 2026-09-26).
6. An accessibility RTT mode (large text, high contrast, screen-reader
   politeness settings), taken to deaf community organisations. The mode
   shipped (Reading settings: text size, high contrast, steady drafts, read
   drafts aloud; DESIGN.md "Reading mode"), and returning readers get their
   text size and contrast before first paint. An outreach kit for deaf
   community organisations is ready (docs/OUTREACH_RTT.md: who to approach,
   a first message, a session script, questions). Still open: the owner
   sending it and running the sessions.

Do not build: public rooms or discovery (Jitsi removed anonymous room
creation after abuse), groups beyond about 8, a server mailbox, stickers
or games as retention bait, phone numbers or accounts, interop bridges.

## Known gaps found in this pass

All fixed: delivery status now persists (Delivered / Not delivered yet
survive reloads, and a message sent alone turns Delivered once someone
receives it through history), the list stays pinned while late media
loads, the stale persistence tests check IndexedDB, and links use a
`--link` token at 5.4:1 or better.
