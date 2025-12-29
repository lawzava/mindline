# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Mindline is a P2P real-time chat application featuring "radical transparency" - users see each other's messages as they type, character by character. It uses a hybrid Rust/WebAssembly + JavaScript architecture.

## Build & Development Commands

```bash
# Install dependencies
npm install

# Build WASM module only
npm run build-wasm

# Build entire project (WASM + Webpack)
npm run build

# Production build
npm run build:production

# Development server (port 8080)
npm start

# Signaling server (port 3000) - run in separate terminal
npm run signaling

# Run both servers for production
npm run start:production
```

### Rust Commands
```bash
cargo fmt --check    # Check formatting
cargo clippy         # Lint Rust code
cargo test           # Run Rust unit tests
```

## Architecture

### Two-Layer Design
- **Rust/WASM Core** (`src/`): Encryption, message handling, state management
- **JavaScript Layer** (`js/`): UI, WebRTC P2P, event handling

### Key Components

**Rust Modules (`src/`):**
- `core.rs` - Initialization and message handling
- `crypto.rs` - AES-256-GCM encryption
- `messages.rs` - Message types and state
- `p2p.rs` - P2P coordination logic
- `state.rs` - Global state with Mutex
- `*_api.rs` files - API bindings for JavaScript

**JavaScript Modules (`js/`):**
- `app.js` - Main entry point
- `webrtc.js` - WebRTC P2P connections (largest file)
- `message-manager.js` - Message handling
- `room-manager.js` - Room creation/joining
- `wasm-manager.js` - WASM loading and safe proxies
- `state.js` - Application state
- `ui.js` - UI rendering

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
- **JavaScript**: ES6+, const/let only, async/await, JSDoc comments
- Safe WASM proxy pattern: JavaScript wraps WASM functions with error handling

## Key Patterns

- Messages encrypted with AES-256-GCM, per-room keys
- State: WASM uses Mutex for thread safety, JS uses localStorage
- P2P: WebRTC DataChannels, signaling server for discovery only
- UI: Neobrutalist design, supports light/dark modes
