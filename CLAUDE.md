# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Mindline is a P2P real-time chat application featuring "radical transparency" - users see each other's messages as they type, character by character. It uses a hybrid Rust/WebAssembly + SvelteKit architecture.

## Build & Development Commands

```bash
# Install dependencies
pnpm install

# Build WASM module only
pnpm run build-wasm

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
```

### Rust Commands
```bash
cargo fmt --check    # Check formatting
cargo clippy         # Lint Rust code
cargo test           # Run Rust unit tests
```

## Architecture

### Two-Layer Design
- **Rust/WASM Core** (`src-rust/`): Encryption, message handling, state management
- **SvelteKit Layer** (`src/`): UI components, WebRTC P2P, stores

### Key Components

**Rust Modules (`src-rust/`):**
- `core.rs` - Initialization and message handling
- `crypto.rs` - AES-256-GCM encryption
- `messages.rs` - Message types and state
- `p2p.rs` - P2P coordination logic
- `state.rs` - Global state with Mutex
- `*_api.rs` files - API bindings for JavaScript

**SvelteKit (`src/`):**
- `routes/` - SvelteKit pages (/, /[roomId])
- `lib/components/` - Svelte components (MessageBubble, MessageInput, etc.)
- `lib/stores/` - Svelte stores (user, room, messages, drafts, connection)
- `lib/p2p/` - WebRTC P2P connections, message handlers
- `lib/wasm/` - WASM loading and safe proxies

**Server Components:**
- `signaling-server.js` - WebSocket server for peer discovery only (does NOT relay messages)

### Data Flow
1. User types → Character broadcast to peers via WebRTC
2. Enter key → WASM encrypts message → P2P broadcast → Local storage
3. Reconnection → Automatic message sync between peers

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
- **Rust**: snake_case, explicit error handling (no unwrap in production)
- **TypeScript/Svelte**: Svelte 5 runes ($state, $derived, $effect), TypeScript strict mode
- Safe WASM proxy pattern: TypeScript wraps WASM functions with error handling

## Key Patterns

- Messages encrypted with AES-256-GCM, per-room keys
- State: WASM uses Mutex for thread safety, Svelte uses stores + localStorage
- P2P: WebRTC DataChannels, signaling server for discovery only
- UI: Tailwind CSS v4 + shadcn-svelte, supports light/dark modes
