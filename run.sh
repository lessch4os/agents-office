#!/usr/bin/env bash
# Start the agents-office daemon with the web frontend.
set -euo pipefail

cd "$(git rev-parse --show-toplevel 2>/dev/null || dirname "$0")"

# Ensure web dist is built
if [ ! -f web/dist/index.html ]; then
  echo "Building web frontend..."
  bun run build --cwd web
fi

echo "Starting agents-office daemon on http://localhost:8080"
exec bun run daemon/src/main.ts "$@"
