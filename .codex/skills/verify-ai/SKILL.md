# Skill: verify-ai

Run deterministic validation for AI-assisted changes in this repository.

## When to use
- Before opening/updating a PR.
- After editing files in both `src-rust/` and `src/`.
- When asked to confirm a change is production-ready.

## Commands
```bash
pnpm run verify:ai
```

### Narrow-scope variants
```bash
pnpm run verify:rust
pnpm run verify:web
```

## Expected outcome
- `verify:rust` passes (`cargo fmt --check`, `cargo clippy -- -D warnings`, `cargo test`).
- `verify:web` passes (`pnpm run build-wasm`, `pnpm run check`, `pnpm run build:production`).
- `test:e2e:ci` passes via signaling-aware orchestration.

## Report format
- Include command(s) executed.
- Include pass/fail result and first failing error if any.
- Note skipped checks and why.
