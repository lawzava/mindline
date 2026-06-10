# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Mindline is a P2P real-time chat application featuring "radical transparency" - users see each other's messages as they type, character by character. Pure TypeScript/SvelteKit; encryption via WebCrypto. The protocol contract lives in `docs/PROTOCOL.md` — if code and that document disagree, one of them is a bug.

## Build & Development Commands

```bash
# Install dependencies
pnpm install

# Development server (port 5173)
pnpm dev

# Production build
pnpm build

# Preview production build
pnpm preview

# Signaling server (port 3000) - run in separate terminal
pnpm run signaling

# Type checking
pnpm check

# Unit tests (vitest: crypto, storage, protocol)
pnpm run test:unit

# Full verification gate
pnpm run verify:ai
```

## Architecture

### Layers
- **Crypto core** (`src/lib/crypto/`): room keys (HKDF subkeys from the URL-fragment key), wire envelopes (AES-256-GCM + ECDSA), replay guard, IndexedDB keystore. Spec: `docs/PROTOCOL.md`.
- **Storage** (`src/lib/storage/`): message persistence.
- **P2P** (`src/lib/p2p/`): WebRTC connections, message handlers, signaling client.
- **UI** (`src/routes/`, `src/lib/components/`, `src/lib/stores/`): SvelteKit + Svelte 5 runes + Tailwind v4 + shadcn-svelte. Design context: `PRODUCT.md`.

**Server Components:**
- `signaling-server.js` - WebSocket server for peer discovery only (does NOT relay messages except as encrypted last-resort transport)

### Data Flow
1. User types → draft broadcast to peers via WebRTC (encrypted envelope)
2. Enter key → message envelope → P2P broadcast → local storage
3. Reconnection → cursor-paginated message sync between peers

## Conventions

### Branch Naming
- `feature/description` - New features
- `fix/description` - Bug fixes
- `docs/description` - Documentation
- `perf/description` - Performance

### Commit Format
```
type(scope): brief description
```
Types: feat, fix, docs, style, refactor, perf, test, chore

### Code Style
- **TypeScript/Svelte**: Svelte 5 runes ($state, $derived, $effect), TypeScript strict mode
- Message store is the single source of truth; persistence goes through `src/lib/storage/`

## Agent Behavior

- Follow repository-wide rules in `AGENTS.md` and scoped overrides in `src/AGENTS.md`.
- Prefer existing scripts in `package.json` over ad-hoc command composition.
- Before completing work, run the smallest valid gate: `test:unit`, `verify:web`, or `verify:ai`.
- Never weaken a security claim or the protocol without updating `docs/PROTOCOL.md` in the same change.

## Key Patterns

- E2E encryption: room key in URL fragment, never sent to servers; everything on the wire is an `Envelope` (see `src/lib/crypto/envelope.ts`)
- State: Svelte stores + localStorage/IndexedDB
- P2P: WebRTC DataChannels, signaling server for discovery only
- UI: Tailwind CSS v4 + shadcn-svelte, supports light/dark modes
