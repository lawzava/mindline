# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Production-ready documentation (SECURITY.md, CONTRIBUTING.md, PRIVACY.md, TERMS.md)
- MIT License file
- Comprehensive .gitignore for cleaner repository
- Legal compliance documentation (Privacy Policy, Terms of Service)

### Changed
- Cleaned up repository (removed test files, dev documents)
- Improved project structure for public release

### Security
- Enhanced security documentation
- Documented threat model and security limitations

## [0.1.0] - 2025-01-XX

### Added
- Initial release of Mindline
- End-to-end encrypted P2P chat
- Real-time typing indicators (transparent typing)
- Room-based chat organization
- WebRTC P2P connections
- Rust/WebAssembly core for encryption
- Progressive Web App (PWA) support
- Dark/light theme toggle
- Mobile-responsive design
- Local chat history persistence
- Message synchronization between peers
- Neobrutalist UI design
- WebSocket signaling server

### Features
- **Core Functionality**
  - Direct browser-to-browser messaging
  - No server-side message storage
  - AES-256-GCM encryption
  - Room creation and joining
  - Real-time message delivery

- **User Experience**
  - Instant typing visibility (radical transparency)
  - Clean, accessible interface
  - Mobile-first design
  - Offline capability (PWA)
  - Install as standalone app
  - Theme customization

- **Technical**
  - Rust compiled to WebAssembly
  - WebRTC data channels
  - LocalStorage for chat history
  - Service Worker for offline mode
  - Cloudflare integration ready

### Security
- Client-side encryption key generation
- No data collection or tracking
- Content Security Policy headers
- Input sanitization (XSS protection)
- Secure WebRTC connections (DTLS)

### Known Limitations
- No forward secrecy (keys don't rotate)
- No cross-device message sync
- Room ID must be shared out-of-band
- LocalStorage size limits (~5MB)
- Requires WebRTC-compatible browser

---

## Release Notes

### Version 0.1.0 - Initial Public Release

This is the first public release of Mindline, a privacy-first, truly peer-to-peer chat application.

**Key Highlights:**
- ✅ Zero server-side message storage
- ✅ End-to-end encryption
- ✅ Open source (MIT License)
- ✅ No registration required
- ✅ Progressive Web App

**What's Next:** See [README Roadmap](./README.md#roadmap) for planned features.

**Known Issues:** See [GitHub Issues](https://github.com/yourusername/mindline/issues) for current bugs and feature requests.

---

## How to Use This Changelog

- **[Unreleased]**: Changes in development, not yet released
- **[Version]**: Released versions with dates
- **Added**: New features
- **Changed**: Changes to existing functionality
- **Deprecated**: Features that will be removed
- **Removed**: Features that were removed
- **Fixed**: Bug fixes
- **Security**: Security-related changes

---

*Last Updated: January 2025*