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
- **Node.js** 20+ and pnpm (see `.nvmrc`)
- Basic understanding of TypeScript/Svelte, WebCrypto, and WebRTC

### Development Setup

1. **Fork and clone the repository**
   ```bash
   git clone https://github.com/yourusername/mindline.git
   cd mindline
   ```

2. **Install dependencies**
   ```bash
   pnpm install
   ```

3. **Install Playwright browsers** (only needed to run the e2e suite)
   ```bash
   pnpm exec playwright install
   ```

4. **Start development servers**
   ```bash
   # Terminal 1: Frontend dev server
   pnpm dev

   # Terminal 2: Signaling server
   pnpm run signaling
   ```

5. **Open the app**
   - Navigate to `http://localhost:5173`

### Project Structure
```
mindline/
├── src/
│   ├── routes/             # SvelteKit pages (/, /[roomId])
│   ├── service-worker.js   # offline cache (auto-versioned)
│   └── lib/
│       ├── crypto/         # key schedule, envelopes, identity, replay, keystore
│       ├── p2p/            # WebRTC negotiation, crypto session, signaling
│       ├── media/          # chunked encrypted transfer, blob store, image, recorder
│       ├── storage/        # IndexedDB persistence
│       ├── stores/         # Svelte stores (messages, drafts, connection, transfers)
│       └── components/     # UI components
├── tests/                  # vitest unit + Playwright e2e
├── signaling-server.js     # discovery + ciphertext relay of last resort
└── docs/PROTOCOL.md        # wire protocol, key schedule, threat model
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

### TypeScript/Svelte Code

**Style**: TypeScript strict mode with Svelte 5 runes

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

For everyday iteration, the **fast** checks (no browsers, seconds to run):
```bash
pnpm run test:unit    # crypto/protocol unit tests (vitest)
pnpm run check        # types + svelte-check
pnpm run lint         # prettier + eslint
```

**End-to-end tests** (real two-browser P2P; install browsers once with
`pnpm exec playwright install`):
```bash
pnpm run test:e2e:with-signaling
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

**Unit tests** (vitest, see `tests/unit/`):
```ts
test('rejects envelope from another room (AAD mismatch)', async () => {
	const env = await sealEnvelope(body, { keys, roomId: 'room-1', identity, klass: 'msg' });
	await expect(
		openEnvelope(env, { keys, roomId: 'room-2', senderPublicKey: identity.publicKey })
	).rejects.toThrow();
});
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

3. **Test your change**
   ```bash
   # Fast gate — run for every change:
   pnpm run test:unit && pnpm run check && pnpm run lint

   # Full gate (adds the web build + two-browser e2e) before opening a PR
   # that touches the protocol, p2p, or crypto layers:
   pnpm run verify:ai
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
See the [issue tracker](https://github.com/lawzava/mindline/issues) for planned features:
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
   - Update version in `package.json`

2. **Create release**
   ```bash
   git tag v1.2.3
   git push origin v1.2.3
   ```

3. **Build production**
   ```bash
   pnpm run build:production
   ```

4. **Deploy**
   - Push to production hosting
   - Update signaling server if needed

5. **Announce**
   - GitHub Release with release notes
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

By contributing, you agree that your contributions will be licensed under the [AGPL-3.0-only](LICENSE) license.

---

## Thank You!

Every contribution, no matter how small, makes Mindline better. Whether you're:
- Fixing a typo in documentation
- Reporting a bug
- Suggesting a feature
- Submitting a major PR

...you're helping build a more private, secure communication tool for everyone.

**Thank you for being part of the Mindline community!** 🚀
