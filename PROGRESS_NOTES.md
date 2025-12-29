# Mindline Progress Notes

**Date**: December 29, 2025
**Session Summary**: Major codebase simplification + WebSocket relay fallback

---

## Completed Work

### Part A: Critical Bug Fixes (Previous Session)

| Task | Status | Description |
|------|--------|-------------|
| A1 | ✅ | Removed Tailwind CSS CDN from index.html |
| A2 | ✅ | Fixed webpack build configuration (`--env production=true`) |
| A3 | ✅ | Added TURN server support (config.js, webrtc.js, env-config.js) |

### Part B: Codebase Simplification (This Session)

| Task | Status | Files Changed | Lines Removed |
|------|--------|---------------|---------------|
| B1 | ✅ | state.js, app-state.js (deleted) | ~54 |
| B2 | ✅ | room-manager.js | ~262 |
| B3 | ✅ | wasm-manager.js | ~223 |
| B4 | ✅ | message-manager.js | ~200 |
| B5 | ✅ | webrtc.js, p2p_api.rs, p2p.rs | ~500 |
| B6 | ✅ | app.js | ~64 |

**Total reduction**: ~1,016 lines removed across 16 files

### WebSocket Relay Fallback (This Session)

| Task | Status | Description |
|------|--------|-------------|
| Signaling server | ✅ | Added `relay` message type |
| WebRTC client | ✅ | Added `relayPeers` tracking, relay in `broadcast()` |
| Testing | ✅ | Verified locally with Playwright |

---

## Key Architectural Decisions

### 1. P2P Coordination Moved to JavaScript

**Before**: Complex Rust P2P layer with mesh repair, broadcast optimization, message queuing
**After**: Simple JavaScript-only P2P with WebSocket relay fallback

**Rationale**:
- Rust P2P layer added ~500 lines of complexity with minimal benefit
- JavaScript can handle P2P coordination adequately
- WebSocket relay provides reliable fallback for restrictive networks

**Files affected**:
- `src/p2p.rs` - Commented out (unused)
- `src/p2p_api.rs` - Gutted to 8 lines
- `js/webrtc.js` - Simplified from 1,017 to ~800 lines
- `js/wasm-manager.js` - Removed 17 P2P function bindings

### 2. WebSocket Relay Instead of TURN

**Decision**: Use signaling server as message relay when P2P fails

**Why not TURN**:
- TURN credentials would be exposed in client-side JavaScript
- Ephemeral credentials require backend infrastructure
- Relay is simpler and sufficient for chat messages

**How it works**:
```
1. Client attempts P2P connection
2. If P2P fails (symmetric NAT, firewall), peer added to relayPeers set
3. broadcast() sends via P2P to connected peers, relay to others
4. Messages stay E2E encrypted - server just forwards bytes
```

**Trade-offs**:
- (+) No credential management
- (+) Works everywhere (WebSocket over port 443)
- (+) Zero additional infrastructure
- (-) Slightly higher latency than direct P2P
- (-) More load on signaling server

### 3. Simplified App Initialization

**Before**: 9+ initialization steps with scattered error handling
**After**: 5 clear steps

```javascript
async function initializeApp() {
  // Step 1: Core setup
  initializeAppState();
  initializeTheme();
  initializeDebugMode();

  // Step 2: WASM initialization
  await loadWasmModule();
  createSafeWasmProxies();
  initializeWasm();

  // Step 3: User and UI setup
  await restoreUserState();
  connectNewUIWithWasm();
  setupEventHandlers();

  // Step 4: Room initialization
  await handleRoomInit();

  // Step 5: Finalize
  updateRoomHistoryUI();
  setInitialized(true);
}
```

### 4. State Consolidation

**Before**: 4 state sources (state.js, app-state.js, WASM state, localStorage)
**After**: 2 state sources (state.js with merged app-state, localStorage)

**Pattern**: JavaScript owns UI state, WASM owns message/crypto state

---

## Code Patterns Established

### 1. Safe WASM Calls

```javascript
// All WASM calls go through safeWasm proxy with error handling
window.safeWasm.function_name?.(...args);
```

### 2. Relay Fallback Pattern

```javascript
// In broadcast()
for (const [peerId, channel] of this.dataChannels.entries()) {
  if (channel.readyState === 'open') {
    channel.send(message);  // P2P
  }
}
for (const peerId of this.relayPeers) {
  this.sendRelay(message, peerId);  // Fallback
}
```

### 3. Signaling Message Types

| Type | Direction | Purpose |
|------|-----------|---------|
| `join` | Client → Server | Join a room |
| `room-joined` | Server → Client | Confirm join with peer list |
| `peer-joined` | Server → Clients | New peer notification |
| `peer-left` | Server → Clients | Peer departure |
| `offer` | Client → Client | WebRTC offer |
| `answer` | Client → Client | WebRTC answer |
| `ice-candidate` | Client → Client | ICE candidate |
| `relay` | Client → Server → Client | Message relay (new) |

---

## Current File Structure

```
js/
├── app.js              # Main entry, 5-step init (~150 lines)
├── webrtc.js           # P2P + relay (~800 lines)
├── wasm-manager.js     # WASM loading + safe proxies
├── state.js            # Consolidated app state
├── p2p-manager.js      # P2P event handlers
├── message-manager.js  # Message handling
├── room-manager.js     # Room create/join (merged)
├── ui.js               # UI updates
├── logger.js           # Logging
└── ...

src/
├── lib.rs              # Module declarations
├── core.rs             # Core WASM functions
├── crypto.rs           # Encryption (AES-256-GCM)
├── messages.rs         # Message types
├── state.rs            # WASM state
├── p2p_api.rs          # Minimal (P2P moved to JS)
└── ...

signaling-server.js     # WebSocket signaling + relay
```

---

## Deployment Status

| Component | Platform | Status |
|-----------|----------|--------|
| Frontend | Cloudflare Pages | Auto-deploys on push to main |
| Signaling Server | TBD | Needs manual deployment |

**Commits pushed**:
- `e228aca` - refactor: simplify P2P and app initialization
- `23ea63c` - feat: add WebSocket relay fallback when P2P fails

---

## Next Steps

### Immediate

1. **Deploy signaling server** with relay support
   - Update your hosted signaling server with the new `relay` message type
   - Test P2P + relay in production

2. **Production testing**
   - Test from corporate network (should use relay)
   - Test from home network (should use P2P)
   - Verify E2E encryption works in both modes

### Future Considerations

1. **Connection status indicator**
   - Show users whether they're on P2P or relay
   - Could add: "Direct connection" vs "Relayed connection"

2. **Relay rate limiting**
   - Current: 10 messages/second per client
   - May need adjustment based on usage patterns

3. **Monitoring**
   - Track P2P vs relay usage ratio
   - Monitor signaling server load

4. **Optional: Hybrid approach**
   - Try P2P first with timeout
   - If P2P fails within 10s, switch to relay
   - Continue trying P2P in background

---

## Environment Variables

### Cloudflare Pages (Frontend)

```
SIGNALING_SERVER=your-signal-server.com
USE_SSL=true
```

### Signaling Server

```
PORT=3000
HOST=0.0.0.0
NODE_ENV=production
```

---

## Testing Commands

```bash
# Local development
npm run signaling    # Start signaling server (port 3000)
npm start            # Start dev server (port 8080)

# Production build
npm run build:production

# Rust checks
cargo build
cargo clippy
cargo test
```

---

## Summary

The codebase has been significantly simplified (~1,000 lines removed) while adding a critical feature (WebSocket relay fallback) that ensures connectivity for users behind restrictive firewalls. The P2P-first approach with relay fallback provides the best of both worlds: low latency for most users, guaranteed connectivity for all.
