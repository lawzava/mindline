#!/usr/bin/env bash
set -euo pipefail

cleanup() {
  if [ -n "${SIGNALING_PID:-}" ] && kill -0 "$SIGNALING_PID" 2>/dev/null; then
    kill "$SIGNALING_PID" 2>/dev/null || true
    wait "$SIGNALING_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

pnpm run signaling > /tmp/mindline-signaling.log 2>&1 &
SIGNALING_PID=$!

for _ in {1..30}; do
  if curl -fsS "http://localhost:3000/health" >/dev/null 2>&1; then
    pnpm exec playwright test "$@"
    exit $?
  fi
  sleep 1
done

echo "Signaling server did not become healthy within 30 seconds" >&2
exit 1
