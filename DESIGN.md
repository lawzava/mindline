# DESIGN.md

The design system is called **Quiet Wire**. The app behaves like a first-party
messenger that shipped with the phone: bubbles where bubbles belong, one cobalt
accent spent almost entirely on the live wire, and chrome so compressed it reads
as the OS. Familiarity is the strategy; modernity comes from precision. All
delight concentrates in the one moment no other messenger has: someone's
sentence forming in front of you.

Scene sentences (these force the themes):
- **Light:** a quiet desk by a window at 10am, cool paper-white surfaces and
  gray-blue shadows, where the only color in the room is the blue of a sentence
  being written.
- **Dark:** a phone face-up on the duvet at 1am, the screen barely brighter than
  the dark blue room around it, and the other person's forming words the most
  alive thing in it.

## Color

Brand hue **262** (calm cobalt) tints every neutral; no `#000`/`#fff` anywhere.
Token source of truth: `src/app.css` (`:root` and `.dark`). Chroma is a
semantic axis: **vivid = happening now, tinted = yours, gray = theirs.**

The accent ledger — full-chroma cobalt exists in exactly these places:
1. Live draft text + caret (`--draft`)
2. The presence dot beside a typing peer's name
3. The composer wire dot (only when text exists AND >= 1 peer is connected)
4. The send circle (`--primary`)
5. The full-delivery double-check
6. Links and focus rings (`--ring`)
7. The empty-room "Invite someone" button (exists only while alone)

Everything else is tinted neutral. Connection status uses conventional colors
(`--success` green connected, `--warning` amber in flight, `--destructive`
failed); cobalt is reserved for "someone is writing".

Key chat surfaces:
- `--wash-sent` own bubble (tinted toward cobalt, opaque)
- `--wash-peer` peer bubble (near-neutral, opaque)
- `--wash-draft` live draft fill (8–10% accent over background)

All surfaces are opaque. No backdrop blur (measured jank source), no shadows on
bubbles, no gradients, no glassmorphism.

## Typography

One family: **Inter Variable** (self-hosted via fontsource), fallback
`ui-sans-serif, system-ui`. No serif, no display face, no italics in the
message stream. `font-feature-settings: "cv05", "cv11"` globally;
`tabular-nums` on every timestamp, counter, and room code.

Fixed rem scale, ratio 1.125: xs 0.75 / sm 0.875 / base 1 (message body,
line-height 1.45) / lg 1.125 / xl 1.266 / 2xl 1.424 / 3xl 2.027 (landing H1
desktop). Weights: 400 body, 500 bylines/buttons, 600 titles and H1; nothing
heavier. Wordmark is `Mindline`, sentence case, sm/600.

## Message anatomy

Both sides get bubbles; fill alone defines them (no borders, no tails).
- Base radius `1.125rem`; within a same-sender group (60s window) the corners
  facing an adjacent same-group bubble tighten to `rounded-md`. Own messages
  tighten right corners, peer messages left.
- Width cap `max-w-[min(78%,36rem)]` lives on the **row wrapper**, never on the
  bubble (a percentage max-width on the bubble resolves against the
  shrink-to-fit row and collapses on touch devices).
- Grouping rhythm: in-group gap `mt-0.5`, same sender new group `mt-3`, sender
  change `mt-4`. Byline (peers, group start only): sm/500 muted.
- Timestamp + delivery only on the last message of a group (or when
  edited/failed); per-message time is tap-to-reveal for 3s. No hover-only
  affordances on the timestamp path.
- Day dividers: centered xs/500 muted label between two hairlines.

## The live draft (the hero)

The forming message occupies exactly the slot and geometry of the peer bubble
it will become. Fill `--wash-draft`, text `--draft`, roman.
- Presence dot is **cobalt**, not green: green means "online" everywhere;
  cobalt means the wire is hot.
- The caret is **load-aware**: solid and still while characters arrive (updates
  within 1s), then hands off to the 2400ms `breathe` cycle, in phase with the
  presence dot. It never hard-blinks.
- Idle drafts hold at 55% opacity (breath held, not gone); they never vanish
  while the peer's composer has text.
- **The latch:** when the draft becomes a message, color and fill cool in place
  (`.settle`, 250ms) — zero relayout. This is the product thesis as animation.
- The composer wire dot mirrors it honestly: it breathes only when your field
  has text AND a peer is connected. It refuses to glow when no one is listening.

## Chrome

- Rooms have **one header row** (~56px): chevron-left (leave, confirm dialog),
  room code (tap to copy invite) over a status subtitle (6px dot + one line,
  doubles as the peer-list trigger), share button, ellipsis menu (your name,
  copy invite, theme). No pills, no badges, no second header.
- Landing keeps a separate minimal header (wordmark + theme toggle).
- Empty room (no peers): "You're the only one here." + filled "Invite someone"
  + one trust line. The one-time accent spend that creates the second person.
- Composer: pill field (`--input` fill, radius 1.25rem, autogrows 1–6 lines),
  paperclip + camera at left, mic inside the field when empty, 40px round
  `--primary` send circle. Placeholder: "Message".

## Motion

All easing `--ease-out-expo`; state-conveying only. ink-in 150ms opacity-only;
settle 250ms color/fill; msg-in 200ms opacity + 4px rise; breathe 2400ms loop;
mic/send swap and reveals 150ms; theme switch instant (transitioning every
painted token on a long list is a jank source). Stream-follow scrolling is
instant, never smooth. `prefers-reduced-motion` disables all of it.

## Bans (project-specific, on top of the shared laws)

- Backdrop blur on any chat surface.
- Smooth scrolling in the message stream.
- Green/azure own-bubbles (WhatsApp/iMessage reflexes) and hacker-dark.
- Serif/italic message text; the Iron Gall ink metaphor is retired.
- Padlock/shield iconography. Security is plain words and honest states.
