#!/usr/bin/env bash
# One-command install for agents-office
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> agents-office installer"
echo ""

# Build everything
echo "==> Building daemon..."
bun run --cwd "$REPO_DIR/daemon" build:daemon

echo "==> Building hook..."
bun run --cwd "$REPO_DIR/daemon" build:hook

echo "==> Building forwarder (client relay)..."
bun run --cwd "$REPO_DIR/daemon" build:forwarder

echo "==> Building plugin..."
bun run --cwd "$REPO_DIR/daemon" build:plugin

echo "==> Building web frontend..."
bun run --cwd "$REPO_DIR/web" build

# Install hooks and plugin
echo "==> Installing hooks..."
bash "$REPO_DIR/scripts/install-hooks.sh"

echo "==> Installing OpenCode plugin..."
bash "$REPO_DIR/scripts/install-opencode-plugin.sh"

echo ""
echo "==> Done!"
echo ""
echo "  SERVER (VPS):"
echo "    ./daemon/agents-office --port 8080 --password secret"
echo ""
echo "  CLIENT (laptop, subscribe to server):"
echo "    ./daemon/agents-office-forwarder \\"
echo "      --server wss://your-server/hook --password secret"
echo ""
echo "  Or run full daemon with relay:"
echo "    ./daemon/agents-office --port 8080 \\"
echo "      --relay-to wss://your-server/hook --password secret"
