# MCP Usage Guide for Mindline

This guide standardizes how AI agents should choose between local repository work and MCP tools.

## 1) Local-first for repository facts
Use local files and commands first when the answer is in this repo.

Preferred commands:
- `rg --files` and `rg` for file and text discovery.
- `pnpm run ...` scripts from `package.json`.
- `cargo ...` for Rust checks/tests.

## 2) MCP-first for external systems
When the task depends on external systems (tickets, logs, incidents, hosted metrics, chat history):
- Discover tools first via MCP tool search.
- Use the matching MCP connector/tool before falling back to shell-based scraping.

## 3) Web lookup usage
Use web lookup only for unstable or external facts (e.g., library behavior changes, platform changes). For project behavior, prefer repo files.

## 4) Verification before completion
Before marking work complete, run the narrowest valid gate:
- Rust-only change: `pnpm run verify:rust`
- Frontend-only change: `pnpm run verify:web`
- Cross-cutting or release-sensitive change: `pnpm run verify:ai`

## 5) Evidence expectations
In final reports, include:
- Commands executed.
- Pass/fail summary.
- Any skipped checks with reasons.
