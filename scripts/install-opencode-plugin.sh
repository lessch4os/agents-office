#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OPENCODE_PLUGIN_DIR="${OPENCODE_PLUGIN_DIR:-$HOME/.config/opencode/plugins}"

echo "==> Building agents-office OpenCode plugin..."

bun run --cwd "$REPO_DIR/daemon" build:plugin

PLUGIN_SRC="$REPO_DIR/daemon/dist/opencode-plugin.js"

if [ ! -f "$PLUGIN_SRC" ]; then
  echo "FAIL: built plugin not found at $PLUGIN_SRC"
  exit 1
fi

echo "==> Installing plugin to $OPENCODE_PLUGIN_DIR"

mkdir -p "$OPENCODE_PLUGIN_DIR"

TARGET="$OPENCODE_PLUGIN_DIR/agents-office.js"

if [ -f "$TARGET" ] || [ -L "$TARGET" ]; then
  mv "$TARGET" "$TARGET.bak" 2>/dev/null || rm -f "$TARGET"
  echo "  preserved old plugin as $TARGET.bak"
fi

ln -sf "$PLUGIN_SRC" "$TARGET"
echo "  linked $PLUGIN_SRC -> $TARGET"

echo ""
if pgrep -f "opencode" &>/dev/null; then
  echo "  ⚠  OpenCode is running — plugin won't take effect until restart."
  echo "     To reload gracefully without losing work:"
  echo "       agents-office reload"
  echo "     Then start OC again:"
  echo "       opencode"
  echo ""
fi

echo "==> Done. Restart OpenCode for the plugin to take effect."
