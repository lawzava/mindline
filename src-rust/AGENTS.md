# AGENTS.md

Additional rules for `/src-rust` (Rust/WASM core).

## Focus
- Keep APIs stable for JS/Svelte consumers unless the task explicitly includes integration updates.
- Avoid `unwrap`/`expect` in production paths.
- Keep crypto/message/state changes minimal and covered by tests.

## Verification
- Run `pnpm run verify:rust` after changes.
- If exported WASM interfaces change, also run `pnpm run verify:web`.
