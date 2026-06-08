#!/bin/sh
# Usage: check-agent-health.sh
#
# Comprehensive diagnostic for agents-office daemon, hooks, plugins, and data flow.
# Exits 0 if everything looks healthy, 1 on any failure.
#
# Environment:
#   AGENTS_OFFICE_DB    override SQLite path (default: ~/.agents-office/sessions.db)
#   AGENTS_OFFICE_PORT  override daemon port (default: 8080)

PORT="${AGENTS_OFFICE_PORT:-8080}"
DB="${AGENTS_OFFICE_DB:-${HOME}/.agents-office/sessions.db}"
LOG_DIR="${AGENTS_OFFICE_LOG_DIR:-${HOME}/.agents-office/logs}"
COUNTER=0
PASS=0
FAIL=0

pass() { PASS=$((PASS + 1)); echo "  ✓ $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  ✗ $1"; }

echo "=== agents-office health check ==="
echo ""

# ── 1. Daemon process ──
echo "--- Daemon ---"
if pgrep -f "daemon/src/main.ts" > /dev/null 2>&1 || pgrep -f "agents-office" > /dev/null 2>&1; then
  pass "process running"
else
  fail "process not found - start with: bun run daemon/src/main.ts --port $PORT"
fi
if curl -sf "http://localhost:${PORT}/health" > /dev/null 2>&1; then
  pass "HTTP /health endpoint ($PORT)"
else
  fail "HTTP /health not responding on port $PORT"
fi

# ── 2. Scene ──
echo ""
echo "--- Scene ---"
SCENE=$(curl -sf "http://localhost:${PORT}/api/scene" 2>/dev/null)
if [ -n "$SCENE" ]; then
  AGENTS=$(echo "$SCENE" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('agents',{})))" 2>/dev/null)
  pass "API /api/scene responds with ${AGENTS:-?} agents"
else
  fail "API /api/scene returned empty"
fi

# ── 3. Unix socket ──
echo ""
echo "--- Hook socket ---"
SOCKET=$(echo "$SCENE" | python3 -c "
import sys,json
try:
  d=json.load(sys.stdin)
  # We can't get socket path from scene, use defaults
except: pass
print()
" 2>/dev/null)
for sock in /run/user/0/agents-office.sock /tmp/agents-office-*.sock; do
  if [ -S "$sock" ] 2>/dev/null; then
    pass "socket exists: $sock"
    break
  fi
done
[ -S /run/user/0/agents-office.sock ] 2>/dev/null || [ -S /tmp/agents-office-0.sock ] 2>/dev/null || [ -S /tmp/agents-office.sock ] 2>/dev/null || \
  fail "no socket found (expected /run/user/0/agents-office.sock or /tmp/agents-office-*.sock)"

# ── 4. CC hooks ──
echo ""
echo "--- Claude Code hooks ---"
if [ -f "${HOME}/.claude/settings.json" ]; then
  if grep -q "agents-office-hook" "${HOME}/.claude/settings.json" 2>/dev/null; then
    pass "hook registered in ~/.claude/settings.json"
  else
    fail "hook not found in ~/.claude/settings.json - run: bun run install-hooks"
  fi
  for event in SessionStart PreToolUse PostToolUse SessionEnd; do
    if grep -q "$event" "${HOME}/.claude/settings.json" 2>/dev/null; then
      : # event present
    else
      fail "missing hook event: $event"
    fi
  done
else
  fail "~/.claude/settings.json not found"
fi

# ── 5. OC plugin ──
echo ""
echo "--- OpenCode plugin ---"
PLUGIN_DIR="${HOME}/.config/opencode/plugins"
if [ -d "$PLUGIN_DIR" ]; then
  PLUGIN_FOUND=0
  for f in "$PLUGIN_DIR"/*.js; do
    if [ -L "$f" ] || [ -f "$f" ]; then
      PLUGIN_FOUND=1
    fi
  done
  if [ "$PLUGIN_FOUND" -eq 1 ]; then
    pass "plugin directory exists with $(ls -1 "$PLUGIN_DIR"/*.js 2>/dev/null | wc -l) plugin(s)"
  else
    fail "plugin directory empty - run: bun run install-opencode-plugin"
  fi
else
  fail "plugin directory not found at $PLUGIN_DIR"
fi

# ── 6. Database ──
echo ""
echo "--- Database ---"
if [ -f "$DB" ]; then
  pass "DB file exists at $DB"
  DB_SIZE=$(stat -c%s "$DB" 2>/dev/null)
  pass "  size: $(echo "$DB_SIZE" | awk '{printf "%.1f KB", $1/1024}')"
  
  DB_VER=$(sqlite3 "$DB" "PRAGMA user_version;" 2>/dev/null)
  pass "  schema version: ${DB_VER:-?}"
  
  SESSIONS=$(sqlite3 "$DB" "SELECT COUNT(*) FROM sessions;" 2>/dev/null)
  RAW=$(sqlite3 "$DB" "SELECT COUNT(*) FROM raw_events;" 2>/dev/null)
  SNAPS=$(sqlite3 "$DB" "SELECT COUNT(*) FROM token_snapshots;" 2>/dev/null)
  pass "  sessions: ${SESSIONS:-0}, raw_events: ${RAW:-0}, snapshots: ${SNAPS:-0}"
  
  RECENT=$(sqlite3 "$DB" "SELECT datetime(MAX(started_at)/1000,'unixepoch') FROM sessions;" 2>/dev/null)
  pass "  latest session: ${RECENT:-none}"
else
  fail "DB file not found at $DB"
fi

# ── 7. Active sessions with token data ──
echo ""
echo "--- Active sessions ---"
SCENE_AGENTS=$(curl -sf "http://localhost:${PORT}/api/scene" 2>/dev/null | python3 -c "
import sys,json
d=json.load(sys.stdin)
for a in d.get('agents',{}).values():
  tok = a.get('token_input_total',0) + a.get('token_output_total',0)
  print(f'{a[\"source\"]:10s} {a.get(\"session_id\",\"\")[:20]:22s} tokens={tok}')
" 2>/dev/null)
if [ -n "$SCENE_AGENTS" ]; then
  echo "$SCENE_AGENTS" | while IFS= read -r line; do echo "    $line"; done
  HAS_TOKENS=$(echo "$SCENE_AGENTS" | grep -v "tokens=0$" | head -1)
  if [ -n "$HAS_TOKENS" ]; then
    pass "at least one agent has token data"
  else
    fail "no agents have token data (CC hooks don't carry tokens - need JSONL watcher)"
  fi
else
  fail "no agents in scene"
fi

# ── 8. Log files ──
echo ""
echo "--- Log files ---"
if [ -f "${LOG_DIR}/daemon.log" ]; then
  DAEMON_LOG_SIZE=$(stat -c%s "${LOG_DIR}/daemon.log" 2>/dev/null)
  JS_LINES=$(grep -c '^{' "${LOG_DIR}/daemon.log" 2>/dev/null || echo 0)
  pass "daemon.log exists (${DAEMON_LOG_SIZE:-0} bytes, ${JS_LINES} JSON lines)"
else
  fail "daemon.log not found at ${LOG_DIR}/daemon.log"
fi
if [ -f "${LOG_DIR}/plugin.log" ]; then
  PLUGIN_LOG_SIZE=$(stat -c%s "${LOG_DIR}/plugin.log" 2>/dev/null)
  PLUGIN_LINES=$(wc -l < "${LOG_DIR}/plugin.log" 2>/dev/null || echo 0)
  pass "plugin.log exists (${PLUGIN_LOG_SIZE:-0} bytes, ${PLUGIN_LINES} lines)"
else
  fail "plugin.log not found at ${LOG_DIR}/plugin.log"
fi

# ── 9. JSONL watcher activity ──
echo ""
echo "--- JSONL watcher ---"
if [ -f "${LOG_DIR}/daemon.log" ]; then
  JS_WATCHER=$(grep -c "jsonl watcher" "${LOG_DIR}/daemon.log" 2>/dev/null || echo 0)
  if [ "$JS_WATCHER" -gt 0 ]; then
    pass "jsonl watcher logged ($JS_WATCHER entries)"
  else
    fail "no jsonl watcher activity in daemon.log"
  fi
  NEW_SESSIONS=$(grep -c "jsonl watcher new session" "${LOG_DIR}/daemon.log" 2>/dev/null || echo 0)
  pass "  sessions detected from JSONL: $NEW_SESSIONS"
else
  fail "can't check jsonl watcher (no daemon.log)"
fi

# ── Summary ──
echo ""
echo "=== Summary ==="
TOTAL=$((PASS + FAIL))
echo "  $PASS/$TOTAL checks passed"
if [ "$FAIL" -eq 0 ]; then
  echo "  ✓ All checks passed"
  exit 0
else
  echo "  ✗ $FAIL failures found"
  exit 1
fi
