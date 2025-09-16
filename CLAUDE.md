# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Mindline is a secure P2P chat application combining Rust/WebAssembly for core functionality with JavaScript for the frontend. The application features real-time typing indicators, encrypted messaging, and room-based communication.

## Architecture

### Technology Stack
- **Backend/Core**: Rust compiled to WebAssembly
- **Frontend**: Vanilla JavaScript with Webpack bundling
- **Styling**: CSS with Tailwind-inspired utility classes
- **Build Tools**: wasm-pack for Rust→WASM, Webpack for bundling

### Key Components

1. **Rust/WASM Module** (`src/lib.rs`):
   - `ChatManager`: Singleton managing rooms and user state
   - Message handling with types (Text, Typing, Edit, Delete, Media)
   - Room management with encryption keys
   - Exposed functions: `initialize`, `send_message`, `join_room`, `create_room_with_id`, `send_typing_indicator`, `get_messages`

2. **JavaScript Layer** (`js/index.js`):
   - WASM module loading and safe proxy creation
   - UI event handling and state management
   - LocalStorage persistence for user/room data
   - Theme management (light/dark modes)

## Development Commands

```bash
# Build WASM module
npm run build-wasm

# Build entire project (WASM + webpack)
npm run build

# Start development server (port 8080)
npm start

# Install dependencies
npm install

# Generate PWA icons (after creating/updating icons/icon.svg)
node generate-icons.js
```

## PWA Features

Mindline is now a Progressive Web App (PWA) with:

### Mobile-First Design
- Responsive layout optimized for mobile devices
- Touch-friendly buttons and inputs (minimum 44px touch targets)
- Safe area insets support for notched devices
- Viewport meta tag with `user-scalable=no` for consistent mobile experience
- Font size minimum 16px to prevent iOS zoom

### PWA Capabilities
- **Service Worker**: Provides offline functionality and caching
- **Web App Manifest**: Enables "Add to Home Screen" functionality
- **App Icons**: Complete icon set for various platforms (16x16 to 512x512)
- **Install Prompts**: Smart install prompts for Chrome/Edge and iOS Safari
- **Standalone Display**: Runs fullscreen like a native app
- **Theme Colors**: Consistent branding with Nord color scheme

### Installation Experience
- Automatic install prompt after user interaction (3 clicks/taps)
- iOS-specific installation instructions
- Install prompt respects user preferences (won't show again if dismissed)
- Update notifications when new versions are available

### Performance Optimizations
- CSS performance improvements with `will-change` and `backface-visibility`
- Reduced animations on touch devices
- High DPI display optimizations
- Code splitting and caching strategies

## Working with the Codebase

### Adding New WASM Functions
1. Define the function in `src/lib.rs` with `#[wasm_bindgen]` attribute
2. Create a safe proxy in `js/index.js` using the `safeWasmCall` factory
3. Add to `window.safeWasm` object for global access

### Message Flow
1. User actions trigger JavaScript event handlers
2. JS validates input and calls WASM functions via safe proxies
3. WASM processes data and stores in thread-local `ChatManager`
4. Results return to JS for UI updates

### State Management
- User state: Stored in localStorage (`userId`, `userName`)
- Room state: Stored in localStorage (`currentRoomId`)
- Messages: Maintained in WASM memory, retrieved via `get_messages`

## Important Patterns

### Error Handling
- WASM functions return `Result<T, JsValue>` for proper error propagation
- JavaScript uses try-catch blocks around WASM calls
- All errors logged to both console and debug output area

### Parameter Validation
- JavaScript validates before calling WASM (see `safeWasmCall`)
- Rust validates parameters with `validate_js_string_param`
- Room IDs must be alphanumeric with dashes/underscores, minimum 8 characters

### Logging
- Rust: Use `console_log!` macro for browser console output
- JavaScript: Use `log()` function for console + debug area output
- When testing UI/ux features always use playwrith mcp
- when testing functionality before submitting the solution always make sure to test with at least 3 users talking to each other
- before testing with playwrith mcp review html files to know exact selector ids to use
- Create two separate browser contexts for testing - one for each user. Each context should be isolated with its own storage.