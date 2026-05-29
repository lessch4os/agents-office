#!/usr/bin/env bash
set -euo pipefail

CLAUDE_SETTINGS="${CLAUDE_SETTINGS:-$HOME/.claude/settings.json}"

if [ ! -f "$CLAUDE_SETTINGS" ]; then
  echo "Nothing to do — $CLAUDE_SETTINGS does not exist"
  exit 0
fi

cp "$CLAUDE_SETTINGS" "$CLAUDE_SETTINGS.bak"
echo "  backed up current settings to $CLAUDE_SETTINGS.bak"

bun -e "
const fs = require('fs');

const settingsPath = '$CLAUDE_SETTINGS';

let cfg = {};
try {
  cfg = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
} catch {
  console.log('  invalid JSON — skipping');
  process.exit(0);
}

// Remove all agents-office / ascii-agents hook entries
const SENTINELS = ['_agents_office', '_ascii_agents'];
const hookEvents = ['SessionStart', 'SessionEnd', 'PreToolUse', 'PostToolUse', 'Notification'];

for (const event of hookEvents) {
  const entries = cfg.hooks?.[event];
  if (!Array.isArray(entries)) continue;
  cfg.hooks[event] = entries.filter(e => !SENTINELS.some(s => e[s] === true));
  if (cfg.hooks[event].length === 0) {
    delete cfg.hooks[event];
  }
}

if (cfg.hooks && Object.keys(cfg.hooks).length === 0) {
  delete cfg.hooks;
}

const tmp = settingsPath + '.tmp';
fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2) + '\n');
fs.renameSync(tmp, settingsPath);

console.log('  removed ascii-agents hook entries from ' + settingsPath);
"