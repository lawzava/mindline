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

1. **Safety numbers.** A per-room fingerprint or QR over members' device
   keys, with key-change warnings. Signal-grade identity verification is
   fully possible in a web app and nothing like it exists today.
2. **Signed history.** Sign each message at origin and carry the signature
   through sync, so served history is verifiable (closes the §3.5 caveat).
3. **Signaling hardening.** Trust `x-forwarded-for` only from configured
   proxies, add per-IP connection caps, issue short-lived per-connection
   TURN credentials after a peer is present, and self-host STUN (the
   hard-coded Google STUN server sees every user's IP; disclose it until
   then).
4. **Link hygiene.** Stop keeping raw link keys in localStorage for Recent
   rooms (wrap them like the KEM seed), strip the fragment after import,
   and bind the signaling rendezvous id to the key so the operator cannot
   pair room ids with links.
5. **Admission and removal.** Let a link knock and an existing member
   admit; removing a member rotates the link. Today a leaked link is
   permanent membership.
6. **Per-message forward secrecy** (sender-key chains) and a pinned,
   reproducible build with a service-worker update check.

Product:

1. Name on first join (prefilled with the last one), and show the peer's
   name in the header instead of "1 peer".
2. Replies, copy text, and a jump-to-latest button.
3. Recent rooms as the home screen for returning users: last message,
   unread dot, who is online.
4. QR invite on the empty-room screen for phone-to-phone sharing.
5. Installable PWA with an explicit, opt-in encrypted push "knock". This
   adds metadata held by Apple, Google, or Mozilla and needs its own
   CLAIMS row before it ships.
6. An accessibility RTT mode (large text, high contrast, screen-reader
   politeness settings), taken to deaf community organisations.

Do not build: public rooms or discovery (Jitsi removed anonymous room
creation after abuse), groups beyond about 8, a server mailbox, stickers
or games as retention bait, phone numbers or accounts, interop bridges.

## Known gaps found in this pass, not yet fixed

- Delivery ticks read "unavailable" after reload; a message sent while
  alone keeps its "Local" label after later sync.
- The list can stop short of the bottom after reload when media loads late.
- `tests/e2e/persistence.spec.ts` "Encryption Key Persistence" checks a
  localStorage key the app no longer writes; the test is stale and in no
  CI suite.
- Link color on bubbles measures just under 4.5:1 contrast (`--ring`).
