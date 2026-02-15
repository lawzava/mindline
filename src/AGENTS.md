# AGENTS.md

Additional rules for `/src` (SvelteKit app).

## Focus
- Prefer changes in existing components/stores/modules over introducing new abstractions.
- Preserve current UI behavior unless the task explicitly asks for UX changes.
- Keep runtime interactions with WASM behind existing wrappers in `src/lib/wasm`.

## Verification
- Run `pnpm run verify:web` after changes.
- If changes affect messaging, connection state, or room flows, also run `pnpm run test:e2e:with-signaling -- --project='Desktop Chrome'`.
