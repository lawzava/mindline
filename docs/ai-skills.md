# AI Skills for Mindline

This repository defines local Codex skills under `.codex/skills/` to keep AI-assisted changes repeatable.

## Available Skills

### `verify-ai`
- Path: `.codex/skills/verify-ai/SKILL.md`
- Purpose: Run the full repo verification gate before merge.
- Commands:
  - `pnpm run verify:ai`
  - `pnpm run verify:web` (when UI-only validation is enough)
  - `pnpm run verify:rust` (when Rust-only validation is enough)

### `cloud-build`
- Path: `.codex/skills/cloud-build/SKILL.md`
- Purpose: Reproduce Cloudflare Pages build locally and verify env injection.
- Commands:
  - `bash cloud_build.sh`
  - `node scripts/inject-env.js`

### `signaling-health`
- Path: `.codex/skills/signaling-health/SKILL.md`
- Purpose: Validate signaling server health and collect quick diagnostics.
- Commands:
  - `pnpm run signaling`
  - `curl http://localhost:3000/health`

## Usage Guidance
- Use these skills as first choice instead of ad-hoc command selection.
- Include command output summaries in PR/issue updates.
- If a skill fails due to environment setup, report the exact failing command and exit code.
