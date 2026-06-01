#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
HOOK_BIN="$REPO_DIR/daemon/agents-office-hook"
CLAUDE_SETTINGS="${CLAUDE_SETTINGS:-$HOME/.claude/settings.json}"

echo "==> Building hook binary..."
bun run --cwd "$REPO_DIR/daemon" build:hook

if [ ! -f "$HOOK_BIN" ]; then
  echo "FAIL: hook binary not found at $HOOK_BIN"
  exit 1
fi

echo "==> Installing hooks to $CLAUDE_SETTINGS"

mkdir -p "$(dirname "$CLAUDE_SETTINGS")"

if [ -f "$CLAUDE_SETTINGS" ]; then
  cp "$CLAUDE_SETTINGS" "$CLAUDE_SETTINGS.bak"
  echo "  backed up existing settings to $CLAUDE_SETTINGS.bak"
fi

bun -e "
const fs = require('fs');

const hookPath = '$HOOK_BIN';
const settingsPath = '$CLAUDE_SETTINGS';

let cfg = {};
try {
  cfg = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
} catch {}

// Sentinel values — support both old and new for migration
const SENTINELS = ['_agents_office', '_ascii_agents'];

const hookEvents = ['SessionStart', 'SessionEnd', 'PreToolUse', 'PostToolUse', 'Notification'];

// First pass: remove old-sentinel entries, migrate any bare-path entries
let hadAny = false;
for (const event of hookEvents) {
  const entries = cfg.hooks?.[event];
  if (!Array.isArray(entries)) continue;

  // Separate old sentinel entries from others
  const oldEntries = entries.filter(e => SENTINELS.some(s => e[s] === true));
  const otherEntries = entries.filter(e => !SENTINELS.some(s => e[s] === true));

  // Update command path in old entries, retag with new sentinel
  const migrated = oldEntries.map(e => {
    // Remove old sentinel keys
    for (const s of SENTINELS) delete e[s];
    const hookList = e.hooks;
    if (Array.isArray(hookList)) {
      for (const h of hookList) {
        h.command = hookPath;
      }
    }
    e._agents_office = true;
    return e;
  });

  cfg.hooks[event] = [...otherEntries, ...migrated];
  if (migrated.length > 0) hadAny = true;
}

if (!hadAny) {
  // No existing entries found — add fresh ones
  const hookEntry = {
    _agents_office: true,
    hooks: [{ command: hookPath, type: 'command' }],
    matcher: '.*',
  };

  cfg.hooks = cfg.hooks || {};
  for (const event of hookEvents) {
    cfg.hooks[event] = cfg.hooks[event] || [];
    cfg.hooks[event].push(hookEntry);
  }
}

const tmp = settingsPath + '.tmp';
fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2) + '\n');
fs.renameSync(tmp, settingsPath);

console.log('  wrote hook entries to ' + settingsPath);
"

echo ""
if pgrep -f "claude" &>/dev/null; then
  echo "  ⚠  Claude Code is running — hooks won't take effect until restart."
  echo "     To reload gracefully without losing work:"
  echo "       agents-office reload"
  echo "     Then start CC again:"
  echo "       claude"
  echo ""
fi

echo "==> Done. Hook registered: $HOOK_BIN"
