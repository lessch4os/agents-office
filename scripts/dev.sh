#!/usr/bin/env bash
# Start agents-office in dev mode (daemon + vite concurrently)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

cleanup() {
  echo ""
  echo "Shutting down..."
  kill $DAEMON_PID $VITE_PID 2>/dev/null || true
  wait $DAEMON_PID $VITE_PID 2>/dev/null || true
  echo "Done."
}
trap cleanup SIGINT SIGTERM EXIT

echo "Starting daemon..."
bun run --cwd daemon dev &
DAEMON_PID=$!

echo "Starting vite dev server..."
bun run --cwd web dev &
VITE_PID=$!

echo ""
echo "+------------------------------------------+"
echo "|  agents-office dev mode                   |"
echo "|  Web:  http://localhost:5173              |"
echo "|  API:  http://localhost:8080              |"
echo "+------------------------------------------+"
echo ""

wait
