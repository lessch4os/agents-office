#!/usr/bin/env bash
# One-command install for agents-office
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

ARCH="$(uname -m)"
OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
case "$ARCH" in
  x86_64|amd64) BARCH="x64" ;;
  aarch64|arm64) BARCH="arm64" ;;
  *) BARCH="$ARCH" ;;
esac
PLATFORM="${OS}-${BARCH}"

echo "==> agents-office installer (${PLATFORM})"
echo ""

# Build everything for this platform
echo "==> Building daemon for ${PLATFORM}..."
bun run --cwd "$REPO_DIR/daemon" "build:daemon:${PLATFORM}"

echo "==> Building hook for ${PLATFORM}..."
bun run --cwd "$REPO_DIR/daemon" "build:hook:${PLATFORM}"

echo "==> Building forwarder for ${PLATFORM}..."
bun run --cwd "$REPO_DIR/daemon" "build:forwarder:${PLATFORM}"

echo "==> Building plugin..."
bun run --cwd "$REPO_DIR/daemon" build:plugin

echo "==> Building web frontend..."
bun run --cwd "$REPO_DIR/web" build

# Install hooks and plugin
echo "==> Installing hooks..."
bash "$REPO_DIR/scripts/install-hooks.sh"

echo "==> Installing OpenCode plugin..."
bash "$REPO_DIR/scripts/install-opencode-plugin.sh"

# Symlink platform-specific binary as default
echo "==> Creating default binary symlink..."
ln -sf "$REPO_DIR/daemon/agents-office-${PLATFORM}" "$REPO_DIR/daemon/agents-office"
ln -sf "$REPO_DIR/daemon/agents-office-hook-${PLATFORM}" "$REPO_DIR/daemon/agents-office-hook"
ln -sf "$REPO_DIR/daemon/agents-office-forwarder-${PLATFORM}" "$REPO_DIR/daemon/agents-office-forwarder"

echo ""
echo "==> Done!"
echo ""
echo "  Platform: ${PLATFORM}"
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
