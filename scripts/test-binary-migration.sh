#!/usr/bin/env bash
# Binary-level migration test.
# Creates a legacy SQLite DB (missing the `transport` column in raw_events),
# runs the compiled binary's `db-migrate` command, and verifies the DB was
# upgraded correctly.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

step() { printf '\033[36m[binary-migration] %s\033[0m\n' "$*" >&2; }
fail() { printf '\033[31m[binary-migration] FAILED: %s\033[0m\n' "$*" >&2; exit 1; }

BINARY="${1:-./daemon/agents-office}"
if [ ! -x "$BINARY" ]; then
  fail "binary not found at $BINARY — build it first with 'bun run --cwd daemon build:daemon'"
fi

TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT
DB="$TMPDIR/legacy.db"

step 'creating legacy DB (raw_events WITHOUT transport column)'
sqlite3 "$DB" <<'SQL'
CREATE TABLE sessions (
  session_id TEXT PRIMARY KEY, parent_session_id TEXT,
  source TEXT NOT NULL, label TEXT NOT NULL DEFAULT '',
  cwd TEXT NOT NULL DEFAULT '', agent_type TEXT,
  context_window_limit INTEGER NOT NULL DEFAULT 200000,
  started_at INTEGER NOT NULL, ended_at INTEGER,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  tool_call_count INTEGER NOT NULL DEFAULT 0,
  active_ms INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0.0,
  cache_hit_rate REAL NOT NULL DEFAULT 0.0,
  tags TEXT NOT NULL DEFAULT '[]',
  model_name TEXT
);
CREATE TABLE raw_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL, session_id TEXT,
  payload TEXT NOT NULL
);
CREATE TABLE token_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL, ts INTEGER NOT NULL,
  cumul_input INTEGER NOT NULL DEFAULT 0,
  cumul_output INTEGER NOT NULL DEFAULT 0,
  context_pct REAL NOT NULL DEFAULT 0.0
);
INSERT INTO sessions (session_id, source, started_at) VALUES ('test-session', 'hook', 1000);
INSERT INTO raw_events (ts, session_id, payload) VALUES (1000, 'test-session', '{}');
PRAGMA user_version = 0;
SQL

step 'checking raw_events does NOT have transport column (pre-condition)'
if sqlite3 "$DB" "PRAGMA table_info(raw_events);" | grep -q "transport"; then
  fail "pre-condition failed: raw_events already has transport column"
fi

step 'running db-migrate on legacy DB'
OUTPUT="$("$BINARY" db-migrate --db "$DB" 2>&1)"
echo "$OUTPUT"
if ! echo "$OUTPUT" | grep -q '"msg":"database migrated"'; then
  fail "db-migrate did not report successful migration"
fi

step 'verifying transport column was added by migration'
if sqlite3 "$DB" "PRAGMA table_info(raw_events);" | grep -q "transport"; then
  printf '\033[32m[binary-migration] OK — transport column added, legacy DB upgraded\033[0m\n' >&2
else
  fail 'transport column still missing after migration'
fi

step 'verifying user_version'
VERSION="$(sqlite3 "$DB" "PRAGMA user_version;")"
if [ "$VERSION" = "4" ]; then
  printf '\033[32m[binary-migration] OK — user_version is 4\033[0m\n' >&2
else
  fail "expected user_version 4 (got $VERSION)"
fi

step 'verifying existing sessions data is preserved'
COUNT="$(sqlite3 "$DB" "SELECT COUNT(*) FROM sessions;")"
if [ "$COUNT" -gt 0 ]; then
  printf '\033[32m[binary-migration] OK — sessions data preserved (%d rows)\033[0m\n' >&2 "$COUNT"
else
  fail 'sessions table is empty'
fi
