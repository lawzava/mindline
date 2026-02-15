# AGENTS.md

This file defines default agent behavior for the entire repository.

## Scope
- Applies to all files under `/Users/jakob/Code/lawzava/mindline` unless a deeper `AGENTS.md` overrides it.

## Working Rules
- Use `pnpm` for Node workflows. Do not introduce `npm` commands in docs or scripts.
- Keep changes surgical. Edit only files needed for the task.
- Use existing scripts from `package.json` when possible instead of ad-hoc command sequences.
- Do not modify cryptography, security policy, or signaling protocol behavior without explicit request.

## Verification Rules
- For Rust/WASM changes: run `pnpm run verify:rust`.
- For SvelteKit/frontend changes: run `pnpm run verify:web`.
- For P2P/signaling/e2e-sensitive changes: run `pnpm run test:e2e:with-signaling`.
- For cross-cutting or release-ready changes: run `pnpm run verify:ai`.

## Completion Standard
- State what was changed, what was verified, and any checks skipped.
- If a requested change is ambiguous, ask a targeted clarification before implementation.
