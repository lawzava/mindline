# Security Architecture

This document explains Mindline's security model, encryption implementation, and threat considerations.

## Core Security Principles

### 1. Privacy by Architecture
Mindline's security isn't based on trust—it's based on **technical impossibility** of data access.

- **No server storage**: Messages cannot be intercepted from servers that never store them
- **Client-side encryption**: Keys never leave your device
- **P2P communication**: Direct connections eliminate intermediaries

### 2. Defense in Depth
Multiple layers of security protect your communications:
- Transport encryption (TLS/DTLS)
- Application-layer encryption (AES-256)
- Content Security Policy
- Input sanitization

## Encryption Implementation

### Message Encryption

**Algorithm**: AES-256-GCM
- 256-bit key size
- Galois/Counter Mode for authenticated encryption
- Protects against tampering and replay attacks

**Key Generation**:
```rust
// In src/crypto.rs
pub fn generate_encryption_key() -> Result<Vec<u8>, JsValue> {
    let mut key = vec![0u8; 32]; // 256 bits
    getrandom::getrandom(&mut key)
        .map_err(|e| JsValue::from_str(&format!("Key generation failed: {}", e)))?;
    Ok(key)
}
```

Keys are generated using:
- **Browser**: `crypto.getRandomValues()` (WebCrypto API)
- **Rust/WASM**: `getrandom` crate with strong entropy sources

### Key Management

**Per-Room Encryption**:
- Each room has a unique encryption key
- Keys generated client-side when creating a room
- Keys stored only in browser localStorage
- No key exchange protocol (room creator shares out-of-band)

**Key Storage**:
```javascript
// localStorage structure
{
  "room_<roomId>_key": "<base64-encoded-256-bit-key>",
  "room_<roomId>_history": "<encrypted-messages>"
}
```

**Security Trade-offs**:
- ✅ Simple: No complex key exchange needed
- ✅ Fast: Immediate encryption without handshake
- ⚠️ Sharing risk: Room ID + key must be shared securely
- ⚠️ No forward secrecy: Compromised key exposes all messages

## WebRTC Security

### DTLS Encryption
WebRTC data channels use DTLS (Datagram TLS) for transport security:
- Automatic encryption of all P2P traffic
- Certificate fingerprints exchanged via signaling
- Protection against man-in-the-middle attacks

### Signaling Server Trust
The signaling server coordinates connections but:
- Cannot decrypt message content (has no keys)
- Cannot inject messages (no access to P2P channels)
- Cannot impersonate users (would need access to both endpoints)
- Can only facilitate or block connection establishment

**Threat**: Malicious signaling server could:
- Prevent connections
- Log connection metadata (who connects to which room)
- Perform denial of service

**Mitigation**: Self-host signaling server for full control

## Threat Model

### What We Protect Against

✅ **Passive Network Eavesdropping**
- All traffic encrypted (TLS + DTLS + AES)
- Network observers see only encrypted data

✅ **Server Compromise**
- Server has no keys or message content
- Compromise reveals no historical messages

✅ **Message Tampering**
- AES-GCM provides authentication
- Modified messages detected and rejected

✅ **Content Injection (XSS)**
- Strict Content Security Policy
- Input sanitization in Rust/WASM layer
- Output encoding for display

### What We Don't Fully Protect Against

⚠️ **Endpoint Compromise**
- Malware on user's device can access localStorage
- Browser extensions can read memory
- **Mitigation**: Use trusted devices, review extensions

⚠️ **Active Man-in-the-Middle**
- Attacker controlling signaling server could prevent connections
- Attacker with network position could disrupt P2P
- **Mitigation**: Self-host signaling, verify room access

⚠️ **Traffic Analysis**
- Network observers can see connection patterns
- Room participation is visible to signaling server
- **Mitigation**: Use VPN/Tor (with performance trade-off)

⚠️ **Room ID Guessing**
- Weak room IDs can be brute-forced
- **Mitigation**: Use long, random room IDs (16+ characters)

⚠️ **No Forward Secrecy**
- Compromised key exposes all past messages in localStorage
- **Mitigation**: Clear history regularly, use ephemeral rooms

## Browser Security

### Content Security Policy
```html
<meta http-equiv="Content-Security-Policy" content="
  default-src 'self';
  script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval';
  connect-src 'self' wss: ws:;
  style-src 'self' 'unsafe-inline';
">
```

**Justification for unsafe directives**:
- `unsafe-inline` scripts: Inline theme initialization (prevents flash)
- `unsafe-eval`: Webpack hot module replacement (dev only)
- `wasm-unsafe-eval`: Required for WebAssembly execution

### Input Sanitization

**Rust Layer** (`src/sanitizer.rs`):
```rust
pub fn sanitize_message_content(input: &str) -> String {
    input
        .chars()
        .filter(|c| !is_dangerous_char(*c))
        .take(MAX_MESSAGE_LENGTH)
        .collect()
}
```

**JavaScript Layer**:
- DOMPurify-style sanitization for display
- HTML entity encoding
- No `dangerouslySetInnerHTML` equivalents

### LocalStorage Security
- No sensitive data in cookies
- localStorage isolated by origin
- Regular clearing of old data
- No third-party scripts with storage access

## Cryptography Details

### Algorithms Used

| Purpose | Algorithm | Key Size | Notes |
|---------|-----------|----------|-------|
| Message Encryption | AES-256-GCM | 256-bit | Authenticated encryption |
| Key Generation | CSPRNG | 256-bit | `getrandom` / WebCrypto |
| Transport | TLS 1.3 | 256-bit | Cloudflare managed |
| P2P Transport | DTLS | 256-bit | WebRTC automatic |

### Why AES-256-GCM?
- **Performance**: Hardware-accelerated on most platforms
- **Security**: NIST-approved, well-studied
- **Authentication**: Prevents tampering
- **Browser support**: Native WebCrypto support
- **WASM support**: Efficient implementation

### No Public-Key Crypto?
We deliberately avoid complex protocols like:
- Signal Protocol
- Double Ratchet
- Perfect Forward Secrecy

**Rationale**:
- Simplicity: Easier to audit and understand
- Performance: Faster encryption/decryption
- Room-based model: Doesn't fit traditional 1:1 protocols
- Future upgrade path: Can add later without breaking changes

## Security Best Practices

### For Users

1. **Use Strong Room IDs**
   - Minimum 16 characters
   - Include numbers, letters, special characters
   - Never use guessable IDs like "meeting123"

2. **Share Room IDs Securely**
   - Don't post publicly
   - Use different secure channel (Signal, encrypted email)
   - Verify participants after joining

3. **Clear History**
   - Regularly clear browser data for sensitive conversations
   - Use incognito/private mode for ephemeral chats

4. **Trust Your Device**
   - Keep OS and browser updated
   - Review installed extensions
   - Use trusted networks (or VPN)

### For Developers

1. **Self-Host for Maximum Security**
   - Run your own signaling server
   - Control infrastructure completely
   - See [deployment guide](./README.md#deployment)

2. **Audit the Code**
   - Security-critical code in `/src/crypto.rs`
   - P2P implementation in `/js/webrtc.js`
   - Input handling in `/src/sanitizer.rs`

3. **Report Vulnerabilities**
   - See "Responsible Disclosure" below

## Known Limitations

### Current Implementation

1. **No Forward Secrecy**
   - Message keys don't rotate
   - Compromised key exposes all messages
   - **Roadmap**: Implement key rotation

2. **No Identity Verification**
   - No way to verify room participants
   - Vulnerable to impersonation in room
   - **Roadmap**: Add participant fingerprints

3. **LocalStorage Exposure**
   - Keys stored in plaintext in localStorage
   - Accessible to JavaScript
   - **Roadmap**: Consider IndexedDB with additional encryption

4. **No Message Expiry**
   - Messages persist until manually cleared
   - **Roadmap**: Add automatic expiry options

### Browser/Platform Limitations

1. **WebRTC NAT Traversal**
   - May require TURN server for some networks
   - TURN servers see IP addresses
   - Some corporate firewalls block WebRTC

2. **localStorage Limits**
   - 5-10MB typical limit
   - Long conversations may hit limit
   - Browser clears localStorage unpredictably

3. **No Persistence Across Devices**
   - Messages only on one device
   - No synchronization mechanism
   - **Roadmap**: Optional device-to-device sync

## Responsible Disclosure

Found a security issue? We appreciate responsible disclosure:

1. **DO NOT** open a public GitHub issue
2. Email security concerns to: [security@yourdomain.com]
3. Include:
   - Description of vulnerability
   - Steps to reproduce
   - Potential impact assessment
   - Suggested fix (if any)

We will:
- Respond within 48 hours
- Provide a fix timeline
- Credit you (unless you prefer anonymity)
- Coordinate disclosure timing

### Hall of Fame
*Security researchers who responsibly disclose issues will be listed here*

## Security Roadmap

### Short Term (Next Release)
- ✅ Add rate limiting to signaling server
- ✅ Implement input validation improvements
- ⬜ Add room ID strength indicator
- ⬜ Implement CSP reporting endpoint

### Medium Term (3-6 Months)
- ⬜ Add forward secrecy (key rotation)
- ⬜ Implement participant verification
- ⬜ Add message expiry options
- ⬜ Security audit by third party

### Long Term (6-12 Months)
- ⬜ Consider Signal Protocol integration
- ⬜ Add optional phone number verification
- ⬜ Implement device-to-device sync
- ⬜ Add encrypted file sharing

## References

- [WebRTC Security Architecture](https://tools.ietf.org/html/rfc8827)
- [AES-GCM Specification](https://csrc.nist.gov/publications/detail/sp/800-38d/final)
- [OWASP WebSocket Security](https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html)
- [MDN Web Crypto API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API)

---

**Last Updated**: January 2025
**Next Review**: March 2025

For questions about this security documentation, open an issue on GitHub.