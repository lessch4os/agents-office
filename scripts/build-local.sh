#!/usr/bin/env bash
# Build platform-specific binaries for the current machine
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

ARCH="$(uname -m)"
OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
case "$ARCH" in
  x86_64|amd64) BARCH="x64" ;;
  aarch64|arm64) BARCH="arm64" ;;
  *) echo "unsupported arch: $ARCH"; exit 1 ;;
esac
PLATFORM="${OS}-${BARCH}"

echo "==> Building for ${PLATFORM}..."

cd "$REPO_DIR/daemon"

bun run "build:plugin"
echo "  ✓ plugin built"

bun run "build:daemon:${PLATFORM}"
echo "  ✓ daemon built (agents-office-${PLATFORM})"

bun run "build:hook:${PLATFORM}"
echo "  ✓ hook built (agents-office-hook-${PLATFORM})"

cd "$REPO_DIR/web"
bun run build
echo "  ✓ web built"

# Create legacy symlinks for backward compatibility
cd "$REPO_DIR/daemon"
ln -sf "agents-office-${PLATFORM}" "agents-office" 2>/dev/null || true
ln -sf "agents-office-hook-${PLATFORM}" "agents-office-hook" 2>/dev/null || true

echo ""
echo "==> Build complete for ${PLATFORM}"
echo "  daemon:    daemon/agents-office-${PLATFORM}"
echo "  hook:      daemon/agents-office-hook-${PLATFORM}"
