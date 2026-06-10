# AGENTS.md

Additional rules for `/src` (SvelteKit app).

## Focus
- Prefer changes in existing components/stores/modules over introducing new abstractions.
- Preserve current UI behavior unless the task explicitly asks for UX changes.
- Keep crypto/protocol logic in `src/lib/crypto` per `docs/PROTOCOL.md`; persistence in `src/lib/storage`.

## Verification
- Run `pnpm run verify:web` after changes.
- If changes affect messaging, connection state, or room flows, also run `pnpm run test:e2e:with-signaling -- --project='Desktop Chrome'`.
