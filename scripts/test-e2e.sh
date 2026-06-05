#!/usr/bin/env bash
# E2e test runner for CI.
# Builds a fresh daemon binary, starts it, runs e2e tests, then cleans up.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

step() { printf '\033[36m[e2e] %s\033[0m\n' "$*" >&2; }
fail() { printf '\033[31m[e2e] FAILED: %s\033[0m\n' "$*" >&2; exit 1; }

step 'building daemon binary'
bun run --cwd daemon build:daemon || fail 'daemon build failed'

step 'killing any leftover daemon processes'
pkill -x agents-office 2>/dev/null || true
sleep 1

step 'starting daemon on port 23499'
rm -f /tmp/agents-office-e2e-ci.sock
./daemon/agents-office daemon \
  --port 23499 \
  --socket /tmp/agents-office-e2e-ci.sock \
  --password test \
  > /tmp/agents-office-e2e.log 2>&1 &
DAEMON_PID=$!

# Wait for daemon to be ready
for i in $(seq 1 30); do
  if curl -sf http://localhost:23499/health > /dev/null 2>&1; then
    step 'daemon ready'
    break
  fi
  if [ "$i" -eq 30 ]; then
    kill "$DAEMON_PID" 2>/dev/null || true
    fail 'daemon did not start within 6s'
  fi
  sleep 0.2
done

step 'running e2e tests'
EC=0
bun test --cwd daemon --filter "e2e" 2>&1 || EC=$?

step 'cleaning up'
kill "$DAEMON_PID" 2>/dev/null || true
wait "$DAEMON_PID" 2>/dev/null || true
rm -f /tmp/agents-office-e2e-ci.sock

if [ -n "${EC:-}" ]; then
  fail "e2e tests failed (exit code $EC)"
fi

printf '\033[32m[e2e] all e2e tests passed\033[0m\n' >&2
