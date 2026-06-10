#!/usr/bin/env bash
set -m
set -euo pipefail

SIGNALING_HEALTH_URL="${SIGNALING_HEALTH_URL:-http://localhost:3000/health}"
SKIP_SIGNALING_START="${SKIP_SIGNALING_START:-0}"
SIGNALING_START_CMD="${SIGNALING_START_CMD:-pnpm run signaling}"
ALLOW_LOCALHOST_REMOTE="${ALLOW_LOCALHOST_REMOTE:-0}"

SIGNALING_PID=''
PLAYWRIGHT_ARGS=()

is_localhost_url() {
  case "$1" in
    *://localhost*|*://127.0.0.1*|*://[::1]*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

normalize_playwright_args() {
  for arg in "$@"; do
    if [ "$arg" = "--" ]; then
      continue
    fi
    PLAYWRIGHT_ARGS+=("$arg")
  done
}

fail_if_stale_local_signaling_port() {
  if ! command -v lsof >/dev/null 2>&1; then
    return
  fi

  local stale_pids
  stale_pids="$(lsof -tiTCP:3000 -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "$stale_pids" ]; then
    echo "Refusing to start signaling server: port 3000 is already in use by PID(s): $(echo "$stale_pids" | tr '\n' ' ')" >&2
    echo "Stop the stale process or re-run with SKIP_SIGNALING_START=1 for remote mode." >&2
    exit 1
  fi
}

validate_remote_mode_inputs() {
  if [ "$SKIP_SIGNALING_START" != "1" ]; then
    return
  fi

  if [ -z "${APP_BASE_URL:-}" ]; then
    echo "APP_BASE_URL is required when SKIP_SIGNALING_START=1." >&2
    exit 1
  fi

  if [ -z "${SIGNALING_HEALTH_URL:-}" ]; then
    echo "SIGNALING_HEALTH_URL is required when SKIP_SIGNALING_START=1." >&2
    exit 1
  fi

  if [ "$ALLOW_LOCALHOST_REMOTE" = "1" ]; then
    return
  fi

  if is_localhost_url "${APP_BASE_URL}"; then
    echo "APP_BASE_URL must not point to localhost in remote mode (set ALLOW_LOCALHOST_REMOTE=1 to override)." >&2
    exit 1
  fi

  if is_localhost_url "${SIGNALING_HEALTH_URL}"; then
    echo "SIGNALING_HEALTH_URL must not point to localhost in remote mode (set ALLOW_LOCALHOST_REMOTE=1 to override)." >&2
    exit 1
  fi
}

cleanup() {
  if [ -n "${SIGNALING_PID:-}" ] && kill -0 "$SIGNALING_PID" 2>/dev/null; then
    kill -- "-$SIGNALING_PID" 2>/dev/null || true
    kill "$SIGNALING_PID" 2>/dev/null || true
    for _ in {1..20}; do
      if ! kill -0 "$SIGNALING_PID" 2>/dev/null; then
        break
      fi
      sleep 0.1
    done
    kill -9 -- "-$SIGNALING_PID" 2>/dev/null || true
    kill -9 "$SIGNALING_PID" 2>/dev/null || true
    disown "$SIGNALING_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

validate_remote_mode_inputs
normalize_playwright_args "$@"

if [ "$SKIP_SIGNALING_START" != "1" ]; then
  fail_if_stale_local_signaling_port
  bash -lc "exec ${SIGNALING_START_CMD}" > /tmp/mindline-signaling.log 2>&1 &
  SIGNALING_PID=$!
fi

for _ in {1..30}; do
  if curl -fsS "$SIGNALING_HEALTH_URL" >/dev/null 2>&1; then
    pnpm exec playwright test "${PLAYWRIGHT_ARGS[@]}"
    exit $?
  fi
  sleep 1
done

echo "Signaling server did not become healthy within 30 seconds: $SIGNALING_HEALTH_URL" >&2
exit 1
