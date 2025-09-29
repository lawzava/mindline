# Privacy Policy

**Last Updated: January 2025**

## Our Privacy-First Philosophy

Mindline is built on the principle that **true privacy isn't a promise—it's a technical guarantee**. Unlike traditional messaging apps, we literally cannot access your messages because they never pass through our servers.

## What We Don't Collect

We **do not** and **cannot** collect:
- ❌ Message content
- ❌ Message metadata (who talks to whom)
- ❌ Chat history
- ❌ User profiles
- ❌ Usage analytics
- ❌ IP addresses
- ❌ Device information
- ❌ Cookies or tracking data

## How It Works

### True Peer-to-Peer Architecture
- Messages are sent directly between users' browsers using WebRTC
- No central server ever sees, stores, or relays your messages
- Encryption happens entirely on your device

### What Our Signaling Server Does
Our signaling server has a single, limited purpose: help two browsers find each other to establish a direct connection. Once connected, your browsers talk directly to each other.

The signaling server only handles:
- Initial WebRTC handshake coordination
- Room presence information (who's in which room)
- Connection dropped/reconnected events

**It never sees your actual messages.**

## Data Storage

### On Your Device Only
- **Chat History**: Stored locally in your browser's localStorage
- **User Preferences**: Theme settings, username, stored locally
- **Room History**: List of rooms you've joined, stored locally
- **Encryption Keys**: Generated and stored only on your device

### Not On Our Servers
We do not maintain any database of users, messages, or metadata.

## Your Rights

Since we don't collect your data, you don't need to request deletion or export—you already have full control:

- **Right to Access**: All your data is in your browser's localStorage
- **Right to Delete**: Clear your browser data or use the app's clear history feature
- **Right to Export**: Use browser developer tools to export localStorage
- **Right to Be Forgotten**: You already are—we never knew you existed

## Third-Party Services

### Cloudflare
Our website and signaling server are protected by Cloudflare's CDN and DDoS protection. Cloudflare may collect:
- Connection metadata (IP addresses, user agent)
- Performance and security metrics

See [Cloudflare's Privacy Policy](https://www.cloudflare.com/privacypolicy/) for details.

### WebRTC STUN/TURN Servers
To establish peer-to-peer connections through firewalls (NAT traversal), we use public STUN servers. These may temporarily log:
- Connection attempts
- IP addresses for NAT traversal

No message content is ever sent to STUN/TURN servers.

## Security Measures

### End-to-End Encryption
- All messages encrypted with AES-256
- Encryption keys generated locally on your device
- Keys never leave your device

### Technical Safeguards
- Content Security Policy headers
- XSS protection
- HTTPS/WSS encryption for all connections
- No third-party tracking scripts

## Children's Privacy

Mindline does not knowingly collect information from anyone, including children under 13. Since we don't collect personal information at all, COPPA compliance is inherent to our design.

## Changes to This Policy

If we ever change our privacy practices (for example, adding optional analytics), we will:
1. Update this policy with a new "Last Updated" date
2. Show a prominent notice in the application
3. Require explicit opt-in for any new data collection

Privacy-breaking changes will never be forced upon users.

## International Users

### GDPR Compliance (EU)
We are compliant by design:
- No personal data collection = no GDPR obligations
- Data minimization principle fully satisfied
- Right to erasure: data already on your device only

### CCPA Compliance (California)
Since we don't sell or collect personal information, CCPA requirements don't apply to us.

## Technical Transparency

Our source code is open source (MIT License). You can verify our privacy claims by reviewing:
- [Source Code on GitHub](https://github.com/yourusername/mindline)
- [Architecture Documentation](./SECURITY.md)

## Contact

Questions about privacy? Open an issue on our GitHub repository.

**Remember**: We built Mindline this way specifically so we couldn't access your data even if we wanted to. Your privacy is protected by mathematics and architecture, not promises.

---

## Developer Notes

For technical details on our privacy implementation:
- See `SECURITY.md` for encryption architecture
- Review `src/crypto.rs` for encryption implementation
- Check `js/webrtc.js` for P2P connection handling

**Auditors welcome**: We encourage security researchers to review our code and report any privacy concerns.