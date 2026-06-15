# Architecture

## 10,000-ft view

Mindline runs as two processes: the SvelteKit browser app and a stateless
Node WebSocket signaling/relay server (`signaling-server.js`). The app is built
with `@sveltejs/adapter-node`, but the sensitive work happens in the browser:
room keys, device identities, envelope encryption, replay state, and WebRTC.

Browsers rendezvous through room IDs, then prefer peer-to-peer WebRTC
DataChannels. The signaling server forwards joins, SDP/ICE, peer presence, and
eligible encrypted relay frames; it does not persist rooms. Application payloads
on the DataChannel/relay path are encrypted envelopes. The room capability key
lives only in the URL fragment (`#k=...`), parsed by `src/lib/crypto/keys.ts`;
fragments are not sent to the server.

## Module map

| Path | Owns |
| --- | --- |
| `src/lib/crypto/` | Room-key parsing/derivation, WebCrypto envelopes, device identity, X-Wing KEM wrapping, replay guard, IndexedDB keystore. |
| `src/lib/p2p/` | P2P public API, RTCPeerConnection/DataChannels, hello/key confirmation, generation ratchet wiring, message handlers, relay policy. |
| `src/lib/media/` | Media offers, consent, dedicated in-band media channels, encrypted chunk framing, encrypted blob storage. |
| `src/lib/storage/` | Encrypted message history, legacy migration, room burn/delete flow. |
| `src/lib/stores/` | Svelte stores for user, room, messages, drafts, connection, delivery, transfers. |
| `src/lib/components/` | Chat/layout/UI components; they render state and emit UI events, but do not own protocol rules. |
| `src/routes/` | Landing/create/join flow and room lifecycle: load keys/history, initialize P2P, handle send/edit/delete/reaction/media UI events. |
| `signaling-server.js` | Node `ws` server: origin/rate limits, in-memory room membership, server-assigned client IDs, SDP/ICE forwarding, encrypted relay forwarding, `/health`. |

## Lifecycle of one message

1. Compose: `src/lib/components/chat/MessageInput.svelte` emits text to
   `src/routes/[roomId]/+page.svelte`. `handleSend()` creates the local
   `Message`, updates `src/lib/stores/messages.ts`, persists through
   `src/lib/storage/messages.ts`, then calls `broadcastChat()`.
2. Seal: `src/lib/p2p/manager.ts` builds the `ChatMessage`; `P2PConnection`
   in `src/lib/p2p/connection.ts` calls `CryptoSession.sealMessage()` in
   `src/lib/p2p/crypto-session.ts`; `src/lib/crypto/envelope.ts` seals with
   AES-256-GCM and signs `msg` envelopes with ECDSA.
3. Transport: `connection.ts` sends the serialized envelope on the reliable
   `chat` DataChannel. If direct P2P is unavailable and the message is relay
   eligible, `signaling-server.js` forwards the encrypted envelope.
4. Open: the peer's `connection.ts` parses the envelope and calls
   `CryptoSession.openMessage()`. `envelope.ts` verifies/decrypts, while
   `src/lib/crypto/replay.ts` rejects duplicate `(epoch, seq)` stamps.
5. Persist + render: `src/lib/p2p/handlers.ts` routes `chat`, adds it to the
   messages store, saves encrypted history, and `MessageList` renders from
   `$currentRoomMessages`.

## Read-this-first order

1. `src/routes/`
2. `src/lib/stores/`
3. `src/lib/p2p/manager.ts`
4. `src/lib/p2p/connection.ts`
5. `src/lib/p2p/crypto-session.ts`
6. `src/lib/crypto/envelope.ts`
7. `src/lib/p2p/ratchet.ts`
8. `signaling-server.js`

## Where the dragons are

The generation ratchet in `src/lib/p2p/ratchet.ts` is the hard part. Its wiring
spans `connection.ts` and `crypto-session.ts`: signed grants, per-recipient KEM
wraps, sibling convergence, segmented catch-up, fork heal, and direct-only
grant delivery all interact. Do not change that area casually; read
`docs/PROTOCOL.md` section 1.4 first.

## Dev model

Run two local processes: `pnpm dev` for the SvelteKit app and
`pnpm run signaling` for the WebSocket signaling/relay server. Use
`docs/PROTOCOL.md` as the full implementation spec and `docs/CLAIMS.md` as the
graded security-claims register.
