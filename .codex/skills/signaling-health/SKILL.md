# Skill: signaling-health

Check signaling server availability and basic runtime health.

## When to use
- Before or during P2P/e2e debugging.
- After signaling server changes.
- During incident triage.

## Commands
```bash
pnpm run signaling
curl -fsS http://localhost:3000/health
```

## Expected outcome
- `/health` returns HTTP 200 with JSON status `healthy`.
- Server stays up without immediate restarts.

## Optional diagnostics
- Review `logs/combined.log` when running with PM2.
- Re-run e2e via `pnpm run test:e2e:with-signaling` after health is confirmed.
