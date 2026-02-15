# Skill: cloud-build

Reproduce and validate Cloudflare Pages build behavior.

## When to use
- Before release deployments.
- When build output differs between local and Cloudflare.
- When changing `cloud_build.sh` or `scripts/inject-env.js`.

## Commands
```bash
bash cloud_build.sh
```

## Validation checks
- Confirm `dist/js/env-config.js` exists after build.
- Confirm `SIGNALING_SERVER` and `USE_SSL` are present in generated config.
- If `TURN_SERVERS` is set, ensure it is valid JSON.

## Troubleshooting
- If `wasm-pack` is missing, install per repo prerequisites.
- If env injection fails, run `node scripts/inject-env.js` directly and inspect warnings.
