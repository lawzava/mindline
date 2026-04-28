# Mindline Warm Clarity System Design

## Summary

Redesign Mindline as a full product visual system for privacy-first teams using radically transparent P2P chat. The redesign should make live drafts, room access, peer sync, and local storage clear without slowing the zero-account create, join, and chat flow.

## Product Context

This brief follows `PRODUCT.md`:

- Register: product.
- Primary users: privacy-first teams that need direct, trusted communication without server-side message storage.
- Personality: warm, honest, human.
- Strategic priority: radical clarity before delight.

## Goals

- Make users understand what others can see while they type.
- Make room access and invite-link sensitivity visible before and during sharing.
- Make connection, peer sync, local-only mode, and failure states understandable in user language.
- Replace the current generic card/chat-column feel with a cohesive product system.
- Preserve the existing fast create, join, message, share, and reconnect flows.
- Meet WCAG AA with readable contrast, keyboard access, visible focus, reduced-motion support, and non-color-only status communication.

## Non-Goals

- No protocol, cryptography, signaling, storage, WASM, or P2P behavior changes.
- No accounts, profiles, onboarding gates, or required acknowledgement screens.
- No analytics, telemetry, or new persisted UI preferences.
- No decorative dashboard metrics, generic SaaS hero patterns, toy chat visuals, or fear-driven security styling.

## Primary User Action

Users should always understand: "What can others see right now, who is connected, and what happens if I type, share, or send?"

## Design Direction

### Color Strategy

Use a Restrained product palette: warm tinted neutrals plus one purposeful accent for active transparency, primary action, and current state. Define colors in OKLCH. Avoid untinted pure black or white.

### Theme Scene

A privacy-first teammate opens Mindline during an active discussion on a laptop in normal office light, anxious to know exactly what others can see and whether the room is actually connected.

This points to a warm light product surface, not theatrical dark security UI. Dark mode can continue to exist, but the redesigned default should be warm, legible, and calm.

### Anchor References

- iA Writer: quiet writing focus and low-noise composition.
- Linear: precise state vocabulary and confident product polish.
- Field Notes: tactile warmth without childishness.

## Scope

Fidelity: production-ready.

Breadth: full visual system plus the core app flow.

Interactivity: shipped-quality Svelte UI.

Time intent: polish until it can replace the current interface.

## Layout Strategy

The app should stop feeling like a centered card plus chat column.

### Landing Page

The landing page becomes a room threshold. Create and join remain the primary actions, but the page should clearly explain three rules before entry:

- Drafts are live while typing.
- Anyone with a room link can join.
- Messages sync with peers when connected and remain local when not.

The page should avoid a generic hero-card layout. Use a composed threshold layout with the create/join controls, concise trust rules, and a small explanation of the room model.

### Room View

The room view becomes a trust cockpit, not a dashboard. The message timeline stays primary. Room identity, peer presence, connection state, sharing, and live-draft visibility become structured supporting rails with clearer hierarchy.

The current top status bar can evolve into a more intentional room masthead. It should make room access, copy/share, peer count, and sync state visible without crowding the chat.

### Message Timeline

Messages should feel like durable conversation entries, while live drafts should feel intentionally provisional. Avoid identical chat bubbles that make draft visibility feel accidental. Use spacing, tone, and labels to distinguish sent messages, local-only messages, failed messages, and incoming drafts.

### Composer

The composer should feel like a live broadcast surface, not a generic textarea. Draft visibility should be visually encoded near the input and in the send affordance. The input must remain fast, familiar, and mobile-safe.

## Visual System Requirements

### Tokens

- Replace flat grayscale tokens with warm tinted neutrals.
- Keep one primary accent for active transparency, focus, and primary actions.
- Add semantic tokens for success, warning, destructive, local-only, syncing, connected, and pending states.
- Keep radii, spacing, borders, and focus rings consistent across controls.

### Typography

- Use one product-appropriate sans stack or a restrained sans family already suitable for labels, body, and controls.
- Build hierarchy through scale, weight, spacing, and tone rather than decorative type.
- Keep explanatory prose to 65-75ch where it appears.

### Components

Redesign or retune the shared vocabulary for:

- Buttons: primary, secondary, quiet, destructive, loading, disabled, focus, hover, active.
- Inputs and textareas: visible focus, readable placeholder, disabled state, mobile-safe sizing.
- Badges/status pills: connected, connecting, local, failed, syncing, peer count, live draft.
- Message surfaces: own message, peer message, edited, deleted, failed, local-only, delivered.
- Draft preview: peer name, provisional content, fading state, empty typing state.
- Toasts/tooltips: concise, behavior-focused language.

### Motion

Use motion only for state feedback: draft appearance, reconnect progress, sending state, tooltip/popover reveal. Keep most transitions between 150 and 250 ms. Respect `prefers-reduced-motion`. Do not animate layout properties.

## Key States

- Default landing: warm, calm, ready to create or join.
- Empty room: explains what happens when typing starts, who can join, and whether peers are connected.
- Loading WASM or joining room: anchored loading state with useful context where possible.
- Connected room: shows syncing confidence and peer presence plainly.
- Connecting or reconnecting: shows current attempt and next action without alarm.
- Local or offline: states that messages are saved here but not syncing with peers.
- Failed connection: offers reconnect and explains the consequence.
- Incoming live drafts: provisional, clearly attributed, readable, and not confused with sent messages.
- Sending message: acknowledges progress without blocking composition.
- Failed message: visible recovery context and non-color-only status.
- Shared invite: confirms anyone with the link can join.
- Mobile: safe-area composer, readable masthead, controls within thumb reach.
- Reduced motion: all animated state changes degrade cleanly.

## Interaction Model

- Create and join remain one-step actions.
- The join input should accept room IDs and links as it does today.
- Sharing keeps Web Share API and clipboard fallback behavior, with clearer visible and toast copy.
- Connection status should answer behavior, not only label state.
- Tooltips can carry secondary detail, but critical meaning must be visible or screen-reader accessible.
- Message editing, deletion, reactions, and long-press behavior should remain familiar.
- Keep the existing leave confirmation pattern for destructive room exit.

## Content Requirements

Copy should be candid, short, and human. Avoid hype and fear.

Preferred language patterns:

- "Drafts are live while you type."
- "Anyone with this link can join."
- "Messages are saved here, but not syncing with peers."
- "Connected to 2 peers."
- "Trying to reconnect so messages and live drafts can sync."

Avoid repeated headings, generic privacy claims, and emotional pressure. Do not use em dashes.

## Accessibility Requirements

- Target WCAG AA contrast for text and controls.
- Preserve keyboard access for create, join, copy, share, reconnect, leave, send, edit, delete, and reactions.
- Preserve or improve visible focus states.
- Do not rely on color alone for connection, delivery, or warning states.
- Keep screen-reader labels explicit for icon-only controls.
- Avoid noisy live regions for draft contents unless a separate accessibility strategy is designed.
- Respect reduced motion preferences.

## Implementation Boundaries

Likely frontend files:

- `src/app.css`
- `src/routes/+page.svelte`
- `src/routes/[roomId]/+page.svelte`
- `src/lib/components/layout/AppShell.svelte`
- `src/lib/components/layout/Header.svelte`
- `src/lib/components/chat/ConnectionStatus.svelte`
- `src/lib/components/chat/MessageList.svelte`
- `src/lib/components/chat/MessageBubble.svelte`
- `src/lib/components/chat/MessageInput.svelte`
- `src/lib/components/chat/DraftIndicator.svelte`
- Existing shared UI components only if necessary for consistent states.

Do not modify cryptography, security policy, signaling protocol behavior, WASM wrappers, P2P connection logic, or stores unless explicitly requested.

## Verification

Required after implementation:

- `pnpm run verify:web`

Also run if messaging, connection state, or room flows are touched in behavior-sensitive ways:

- `pnpm run test:e2e:with-signaling -- --project='Desktop Chrome'`

Manual checks:

- Landing works on desktop and mobile.
- Room works with empty, connected, local, reconnecting, failed, and live-draft states.
- Keyboard and screen-reader labels remain usable.
- Reduced motion does not leave broken or confusing transitions.

## Risks And Mitigations

- Risk: The redesign becomes decorative and obscures the chat task.
  Mitigation: Keep message composition and status clarity as the hierarchy anchors.
- Risk: Too much trust copy slows the zero-account flow.
  Mitigation: Use concise, contextual copy where decisions happen.
- Risk: Full visual-system work drifts into unrelated refactors.
  Mitigation: Touch only frontend UI surfaces needed for the visual system and core flow.
- Risk: Status labels crowd mobile layout.
  Mitigation: Use short visible labels with accessible secondary explanations.

## Definition Of Done

- PRODUCT.md exists and reflects the confirmed product strategy.
- The visual system uses warm restrained OKLCH tokens and consistent component states.
- Landing, room masthead, message timeline, live draft area, and composer share one coherent design language.
- Users can understand live drafts, invite access, peer sync, and local-only behavior in context.
- Existing create, join, send, share, reconnect, edit, delete, reaction, and leave flows still work.
- Verification passes for frontend changes.
