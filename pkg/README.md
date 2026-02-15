# 🔐 Mindline

**Secure P2P Real-Time Chat Application**

Mindline is a cutting-edge peer-to-peer chat application that combines the performance of Rust/WebAssembly with modern web technologies to deliver secure, real-time communication without relying on centralized servers for message storage.

## ✨ Unique Selling Proposition

**Radical Transparency in Real-Time Communication**

Mindline revolutionizes digital communication by eliminating the artificial barrier between thinking and sharing. Unlike traditional messengers where you craft messages in private before sending, Mindline creates a **completely transparent communication experience**:

### 🔥 Revolutionary Features

**🚫 No Hidden Drafts** - See exactly what others are typing in real-time as they type
**🎯 Authentic Communication** - No time to craft perfect responses - just genuine, spontaneous interaction
**⚡ Zero Latency Thoughts** - Every keystroke is shared instantly with connected peers
**🪞 Complete Transparency** - Nothing is hidden, everything is visible as it happens

### 🔐 Built on Uncompromising Security

- **True P2P Architecture** - Messages never touch external servers
- **WebAssembly-Powered Core** - Rust performance for security-critical operations
- **End-to-End Encryption** - 256-bit encryption with client-side key generation
- **Decentralized by Design** - No central authority can access your conversations

## 🚀 Key Features

### 🔒 Privacy & Security
- **End-to-End Encryption**: All messages encrypted with 256-bit keys generated client-side
- **No Server Storage**: Messages never leave your device except to reach intended recipients
- **Decentralized Architecture**: No central authority can access your conversations
- **Client-Side Key Management**: Encryption keys generated and managed entirely on your device

### ⚡ Performance & Technology
- **Rust/WebAssembly Core**: High-performance message handling and room management
- **Real-Time Communication**: WebRTC-based P2P connections for instant messaging
- **Smart Message Sync**: Automatic synchronization of missed messages when peers reconnect
- **Persistent State**: Chat history preserved locally across browser sessions

### 🎨 User Experience
- **Radical Transparency UI**: See draft messages appear in real-time as others type
- **Neobrutalist Design**: Bold, accessible interface emphasizing transparency
- **Live Draft Preview**: No typing indicators - see actual message content being composed
- **Spontaneous Communication**: Forces authentic, unfiltered conversation
- **Room-Based Chat**: Create or join rooms with custom IDs for organized conversations
- **Responsive UI**: Works seamlessly on desktop and mobile browsers
- **Zero Configuration**: No accounts, registration, or setup required

### 🛠 Developer Features
- **Modern Architecture**: Clean separation between Rust core and SvelteKit frontend
- **WebAssembly Integration**: Safe, performant WASM bindings with error handling
- **Modular Design**: Extensible codebase with well-defined component boundaries
- **TypeScript-First**: Strict TypeScript across the SvelteKit app

## 🏗 Architecture

### Technology Stack

```
┌─────────────────────────────────────────┐
│        Frontend (SvelteKit + TS)         │
│  ┌─────────────┐ ┌─────────────────────┐ │
│  │  UI Layer   │ │    WebRTC P2P      │ │
│  │  (Svelte)   │ │   Communication     │ │
│  └─────────────┘ └─────────────────────┘ │
└─────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────┐
│         Core (Rust → WebAssembly)       │
│  ┌─────────────┐ ┌─────────────────────┐ │
│  │ ChatManager │ │   Message Handler   │ │
│  │   (State)   │ │   (Encryption)      │ │
│  └─────────────┘ └─────────────────────┘ │
└─────────────────────────────────────────┘
```

### Core Components

1. **Rust/WASM Module** (`src-rust/lib.rs`)
   - `ChatManager`: Singleton managing rooms and user state
   - Message handling with types (Text, Typing, Edit, Delete, Media)
   - Room management with client-side encryption keys
   - Thread-safe state management

2. **SvelteKit Layer** (`src/routes`, `src/lib`)
   - WASM module loading and safe proxy creation
   - UI event handling and state management
   - LocalStorage persistence for user/room data
   - Theme management and responsive design

3. **WebRTC P2P Layer** (`src/lib/p2p`)
   - Direct peer-to-peer connections
   - Signaling server coordination (offer/answer/ICE + encrypted relay fallback)
   - Message broadcasting and routing
   - Connection failure handling and reconnection

4. **Signaling Server** (`signaling-server.js`)
   - Minimal WebSocket server for peer discovery
   - Room management for connection coordination
   - Relays signaling traffic and encrypted fallback payloads only

## 🚀 Getting Started

### Prerequisites
- Node.js 18+ and pnpm
- Rust and wasm-pack for development

### Quick Start

1. **Clone and install dependencies**
   ```bash
   git clone <repository-url>
   cd mindline
   pnpm install
   ```

2. **Build the application**
   ```bash
   pnpm run build
   ```

3. **Start development server**
   ```bash
   pnpm dev
   ```

4. **Start signaling server** (in separate terminal)
   ```bash
   pnpm run signaling
   ```

5. **Open your browser**
   - Navigate to `http://localhost:5173`
   - Create a username
   - Create or join a room
   - Start experiencing radical transparency!

### 🧪 Testing Real-Time Transparency

To experience the revolutionary transparency feature:

1. **Open two browser windows** to `http://localhost:5173`
2. **Initialize users** with different names in each window
3. **Join the same room** from both windows
4. **Start typing in one window** - watch the other window show your draft message in real-time
5. **Experience authentic communication** - no hidden thoughts, complete transparency

### Development Commands

```bash
# Build only the WebAssembly module
pnpm run build-wasm

# Build entire project (WASM + app bundle)
pnpm run build

# Start development server with hot reload
pnpm dev

# Start signaling server for P2P connections
pnpm run signaling

# Required E2E suite (blocking, strict P2P)
pnpm run test:e2e:ci

# Best-effort E2E suite (non-blocking diagnostics)
pnpm run test:e2e:with-signaling:best-effort

# Remote required E2E suite (against staging/prod URLs)
APP_BASE_URL="https://staging.example.com" SIGNALING_HEALTH_URL="https://signal-staging.example.com/health" pnpm run test:e2e:remote:required -- --project='Desktop Chrome'
# Optional localhost override for remote script guard rails:
# ALLOW_LOCALHOST_REMOTE=1 APP_BASE_URL="http://localhost:5173" SIGNALING_HEALTH_URL="http://localhost:3000/health" pnpm run test:e2e:remote:required -- --project='Desktop Chrome'

# Signaling load/soak test
pnpm run test:signaling:soak -- --url=ws://localhost:3000/ws --clients=120 --rooms=12 --durationSec=90 --minJoinRate=0.9 --minReceivedPerSent=0.9 --maxSocketErrorRate=0.05 --maxServerErrors=0
# Optional server tuning knobs for soak environments:
# RATE_LIMIT_MESSAGES_PER_SECOND=50 RATE_LIMIT_CONNECTION_ATTEMPTS_PER_MINUTE=240 RATE_LIMIT_ROOM_JOINS_PER_MINUTE=30 pnpm run signaling

# Full AI-ready verification gate
pnpm run verify:ai
```

### Strict Direct Mode

- Append `?strictDirect=true` to a room URL to enforce direct P2P only.
- In strict mode, TURN and WebSocket relay fallback are disabled.

### AI-Assisted Development

- Agent instructions: `AGENTS.md` (plus scoped overrides in `src/` and `src-rust/`)
- Skill catalog: `docs/ai-skills.md`
- MCP usage guidance: `docs/mcp-usage.md`

## 💡 How It Works

### Real-Time Draft Flow
1. **User types character** → Instantly broadcast to all connected peers
2. **Live draft display** → Other users see the message being composed in real-time
3. **Character-by-character updates** → Every keystroke, deletion, and edit is visible
4. **Enter key pressed** → Draft becomes permanent message and is stored locally
5. **Complete transparency** → No hidden thoughts, no time to reconsider

### Message Flow
1. **Draft composition** → Real-time sharing of every keystroke
2. **Message finalized** → Enter key commits draft to permanent message
3. **WASM processing** → Rust encrypts and stores locally
4. **P2P broadcast** → WebRTC sends final message to connected peers
5. **Local storage** → Message persisted on device

### Connection Process
1. **Room Creation/Join** → WASM creates room with encryption key
2. **Signaling** → WebSocket server facilitates peer discovery
3. **WebRTC Handshake** → Direct P2P connection established
4. **Message Sync** → Peers exchange missed messages
5. **Real-time Chat** → Direct communication without server

## 🛡 Security Model

### Encryption
- **AES-256 encryption** for all messages
- **Client-side key generation** using cryptographically secure random numbers
- **Per-room encryption keys** ensure message isolation
- **No key transmission** - keys never leave your device

### Privacy Guarantees
- **Zero server storage** - messages exist only on participant devices
- **Metadata protection** - room IDs are user-controlled
- **Connection anonymity** - only temporary signaling data exchanged
- **Local-first** - application works offline with cached messages

## 🎨 Design Philosophy

**Neobrutalism Meets Functionality**

Mindline embraces a neobrutalist design philosophy that prioritizes:
- **Bold, accessible interfaces** with high contrast
- **Functional aesthetics** that enhance usability
- **Consistent visual language** across light and dark modes
- **Performance-first** approach with minimal visual overhead

## 🔧 Configuration

### Room ID Format
- Minimum 8 characters
- Alphanumeric with dashes and underscores allowed
- Example: `my-secure-room-2024`

### Local Storage
- User identity and preferences
- Room connection history
- Encrypted message history
- Theme preferences

## 🗺 Roadmap

### Planned Features

#### Core Functionality
- **Export/Import Chat History** - Backup and restore your conversations
- **Cross-Device Sync** - Keep messages in sync across your devices (without servers!)
- **Message Editing & Deletion** - Edit typos, remove sent messages
- **File Sharing** - P2P file transfers with encryption
- **Voice/Video Calls** - Real-time audio/video integration

#### User Experience
- **Message Reactions** - React to messages with emoji
- **Rich Text Formatting** - Markdown support, code blocks, formatting
- **User Profiles** - Custom avatars and display names
- **Notification System** - Desktop/mobile notifications for new messages
- **Internationalization (i18n)** - Multi-language support

#### Advanced Features
- **Native Mobile Apps** - iOS and Android apps with same Rust core
- **Group Management** - Admin controls, moderation tools
- **Message Search** - Search through chat history
- **Custom Themes** - Create and share color schemes
- **Browser Extension** - Quick access from toolbar

#### Security Enhancements
- **Forward Secrecy** - Automatic key rotation for better security
- **Identity Verification** - Verify room participants with fingerprints
- **Message Expiry** - Auto-delete messages after set time
- **Password-Protected Rooms** - Additional layer of room security

Want to contribute? See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines!

## 📚 Documentation

- **[Security Architecture](./SECURITY.md)** - How encryption and privacy work
- **[Contributing Guide](./CONTRIBUTING.md)** - How to contribute to the project
- **[Privacy Policy](./PRIVACY.md)** - What we collect (spoiler: nothing!)
- **[Terms of Service](./TERMS.md)** - Usage terms and conditions
- **[Changelog](./CHANGELOG.md)** - Version history and releases

## 📝 License

MIT License - See [LICENSE](./LICENSE) file for details

## 🔗 Links

- **Source Code**: [GitHub Repository](https://github.com/yourusername/mindline)
- **Issues**: [Report Bugs](https://github.com/yourusername/mindline/issues)
- **Discussions**: [Community Forum](https://github.com/yourusername/mindline/discussions)
- **Security**: [Report Vulnerabilities](./SECURITY.md#responsible-disclosure)

---

**Built with ❤️ using Rust, WebAssembly, and modern web technologies**

---

## 🌟 The Psychology of Transparency

**Traditional messaging creates artificial barriers between thought and communication.** You type, edit, delete, rethink, and finally send a "perfect" message that doesn't represent your actual thought process.

**Mindline eliminates this barrier completely.**

When you use Mindline:
- **Your authentic self emerges** - no time to craft personas
- **Conversations become spontaneous** - like real face-to-face interaction
- **Trust builds faster** - complete transparency creates deeper connections
- **Communication anxiety reduces** - no pressure to be "perfect"
- **Real relationships form** - based on genuine, unfiltered interaction

### 💭 Real Transparency vs. False Privacy

Most "secure" chat apps give you **false privacy** - hiding your thoughts from others while tech companies collect everything.

Mindline offers **radical transparency with real privacy**:
- ✅ **Transparent to participants** - everyone sees authentic communication
- ✅ **Private from corporations** - your data never touches external servers
- ✅ **Secure by design** - end-to-end encryption with no backdoors

*Mindline: Where authentic transparency meets uncompromising privacy*
