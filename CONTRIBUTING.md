# Contributing to Mindline

Thank you for your interest in contributing to Mindline! This document provides guidelines and information for contributors.

## Table of Contents
- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Coding Standards](#coding-standards)
- [Testing](#testing)
- [Submitting Changes](#submitting-changes)
- [Release Process](#release-process)

## Code of Conduct

### Our Pledge
We are committed to providing a welcoming and inclusive experience for everyone. We expect all contributors to:
- Be respectful and considerate
- Accept constructive criticism gracefully
- Focus on what's best for the community
- Show empathy towards others

### Unacceptable Behavior
- Harassment, discrimination, or trolling
- Publishing others' private information
- Inappropriate sexual content or advances
- Other conduct inappropriate in a professional setting

## Getting Started

### Prerequisites
- **Rust** 1.70+ and cargo
- **Node.js** 16+ and npm
- **wasm-pack** for building WebAssembly
- Basic understanding of Rust, JavaScript, and WebRTC

### Development Setup

1. **Fork and clone the repository**
   ```bash
   git clone https://github.com/yourusername/mindline.git
   cd mindline
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Build the project**
   ```bash
   npm run build
   ```

4. **Start development servers**
   ```bash
   # Terminal 1: Frontend dev server
   npm start

   # Terminal 2: Signaling server
   npm run signaling
   ```

5. **Open the app**
   - Navigate to `http://localhost:8080`

### Project Structure
```
mindline/
├── src/              # Rust/WASM source code
│   ├── lib.rs        # Main entry point
│   ├── crypto.rs     # Encryption implementation
│   ├── messages.rs   # Message handling
│   ├── p2p.rs        # P2P coordination
│   └── ...
├── js/               # JavaScript source code
│   ├── app.js        # Application entry
│   ├── webrtc.js     # WebRTC P2P implementation
│   ├── ui.js         # UI management
│   └── ...
├── css/              # Stylesheets
├── index.html        # Main HTML file
└── signaling-server.js  # WebSocket signaling server
```

## Development Workflow

### Branch Naming
- **Feature**: `feature/description` (e.g., `feature/file-sharing`)
- **Bug fix**: `fix/description` (e.g., `fix/connection-timeout`)
- **Documentation**: `docs/description`
- **Performance**: `perf/description`

### Commit Messages
Follow the conventional commits specification:

```
type(scope): brief description

Detailed explanation if needed

Fixes #123
```

**Types**:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation only
- `style`: Formatting, no code change
- `refactor`: Code restructuring
- `perf`: Performance improvement
- `test`: Adding tests
- `chore`: Maintenance tasks

**Examples**:
```
feat(crypto): add key rotation support

Implements automatic key rotation for forward secrecy.
Keys now rotate every 100 messages or 24 hours.

Fixes #45
```

```
fix(webrtc): handle connection timeout gracefully

Previous implementation crashed when ICE gathering timed out.
Now shows user-friendly error and retry option.

Fixes #67
```

## Coding Standards

### Rust Code

**Style**: Follow standard Rust conventions
```bash
cargo fmt --check  # Check formatting
cargo clippy      # Lint code
```

**Guidelines**:
- Use descriptive variable names
- Keep functions small and focused
- Add doc comments for public APIs
- Handle errors explicitly (no unwrap in production)
- Write unit tests for new functions

**Example**:
```rust
/// Encrypts message content using AES-256-GCM
///
/// # Arguments
/// * `content` - Plaintext message to encrypt
/// * `key` - 256-bit encryption key
///
/// # Returns
/// Base64-encoded encrypted message or error
///
/// # Example
/// ```
/// let encrypted = encrypt_message("Hello", &key)?;
/// ```
pub fn encrypt_message(content: &str, key: &[u8]) -> Result<String, JsValue> {
    // Implementation
}
```

### JavaScript Code

**Style**: ES6+, functional where possible

**Guidelines**:
- Use `const` and `let`, not `var`
- Prefer arrow functions for callbacks
- Use async/await over raw promises
- Add JSDoc comments for public functions
- Use meaningful names

**Example**:
```javascript
/**
 * Establishes WebRTC connection to peer
 * @param {string} peerId - Target peer identifier
 * @param {Object} options - Connection options
 * @returns {Promise<RTCPeerConnection>}
 */
async function connectToPeer(peerId, options = {}) {
    // Implementation
}
```

### CSS/Styling
- Follow existing neobrutalist design system
- Use Tailwind classes where available
- Document custom CSS with comments
- Test in light and dark modes
- Ensure mobile responsiveness

## Testing

### Running Tests

**Rust tests**:
```bash
cargo test
```

**JavaScript tests** (when implemented):
```bash
npm test
```

**Manual testing checklist**:
- [ ] Test in Chrome, Firefox, Safari
- [ ] Test on mobile (iOS Safari, Android Chrome)
- [ ] Test with 2+ concurrent users
- [ ] Test connection drop/recovery
- [ ] Test with slow network (DevTools throttling)
- [ ] Test localStorage limits
- [ ] Test room ID validation

### Writing Tests

**Rust unit tests**:
```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encrypt_decrypt_roundtrip() {
        let key = generate_encryption_key().unwrap();
        let plaintext = "test message";
        let encrypted = encrypt_message(plaintext, &key).unwrap();
        let decrypted = decrypt_message(&encrypted, &key).unwrap();
        assert_eq!(plaintext, decrypted);
    }
}
```

**Integration tests**:
Create test files in `/tests` directory

## Submitting Changes

### Pull Request Process

1. **Create a branch**
   ```bash
   git checkout -b feature/my-feature
   ```

2. **Make your changes**
   - Write code
   - Add tests
   - Update documentation

3. **Test thoroughly**
   ```bash
   npm run build          # Build succeeds
   cargo test            # Tests pass
   cargo clippy          # No warnings
   cargo fmt --check     # Properly formatted
   ```

4. **Commit changes**
   ```bash
   git add .
   git commit -m "feat(scope): description"
   ```

5. **Push to your fork**
   ```bash
   git push origin feature/my-feature
   ```

6. **Open Pull Request**
   - Use PR template (if available)
   - Reference related issues
   - Describe changes and rationale
   - Add screenshots for UI changes

### PR Review Process
- Maintainers will review within 1-3 days
- Address feedback and update PR
- Once approved, maintainer will merge
- PR will be squashed into single commit

### PR Checklist
- [ ] Code follows project style guidelines
- [ ] Self-review of changes completed
- [ ] Comments added for complex logic
- [ ] Documentation updated (README, etc.)
- [ ] No new compiler warnings
- [ ] Tests added for new features
- [ ] All tests pass
- [ ] Security implications considered

## Areas for Contribution

### Good First Issues
Look for issues labeled `good-first-issue`:
- Documentation improvements
- UI/UX enhancements
- Bug fixes
- Test coverage

### High Priority
- Security improvements
- Performance optimization
- Browser compatibility fixes
- Accessibility improvements

### Feature Ideas
See [README Roadmap](./README.md#roadmap) for planned features:
- File sharing
- Voice/video calls
- Message reactions
- Cross-device sync
- Mobile apps

## Documentation

### What to Document
- New features in README
- API changes in code comments
- Security implications in SECURITY.md
- Architecture changes in diagrams

### Documentation Style
- Write for developers unfamiliar with codebase
- Include code examples
- Explain *why*, not just *what*
- Keep it up to date

## Security

### Reporting Security Issues
**DO NOT** open public issues for security vulnerabilities.

See [SECURITY.md](./SECURITY.md) for responsible disclosure process.

### Security Considerations
When contributing code that touches:
- Encryption/decryption
- Input validation
- Network communication
- LocalStorage access

Please:
- Document security implications in PR
- Consider threat model
- Request security review
- Add tests for security edge cases

## Release Process

*(For maintainers)*

1. **Version bump**
   - Update version in `Cargo.toml`
   - Update version in `package.json`
   - Update version in `sw.js` cache names

2. **Update changelog**
   - Add entry to `CHANGELOG.md`
   - List all changes since last release

3. **Create release**
   ```bash
   git tag v1.2.3
   git push origin v1.2.3
   ```

4. **Build production**
   ```bash
   npm run build:production
   ```

5. **Deploy**
   - Push to production hosting
   - Update signaling server if needed

6. **Announce**
   - GitHub Release with changelog
   - Post to relevant communities

## Community

### Getting Help
- **Questions**: Open a GitHub Discussion
- **Bugs**: Open an Issue with reproduction steps
- **Feature requests**: Open an Issue with use case explanation
- **Chat**: Join our community (link when available)

### Recognition
Contributors are recognized in:
- Git history
- Release notes
- README contributors section

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

## Thank You!

Every contribution, no matter how small, makes Mindline better. Whether you're:
- Fixing a typo in documentation
- Reporting a bug
- Suggesting a feature
- Submitting a major PR

...you're helping build a more private, secure communication tool for everyone.

**Thank you for being part of the Mindline community!** 🚀