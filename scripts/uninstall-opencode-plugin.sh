#!/usr/bin/env bash
set -euo pipefail

OPENCODE_PLUGIN_DIR="${OPENCODE_PLUGIN_DIR:-$HOME/.config/opencode/plugins}"
TARGET="$OPENCODE_PLUGIN_DIR/agents-office.js"

if [ ! -f "$TARGET" ] && [ ! -L "$TARGET" ]; then
  echo "Nothing to do — no agents-office plugin found at $TARGET"
  exit 0
fi

if [ -f "$TARGET.bak" ] && [ ! -L "$TARGET.bak" ]; then
  mv "$TARGET.bak" "$TARGET"
  echo "  restored backup from $TARGET.bak"
else
  rm -f "$TARGET"
  echo "  removed $TARGET"
fi

echo "==> Done. Restart OpenCode for changes to take effect."
