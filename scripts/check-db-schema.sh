#!/usr/bin/env bash
# Check that the Drizzle schema (schema.ts) is in sync with the
# generated migration meta (drizzle/meta/).
#
# If schema.ts was modified but drizzle-kit generate wasn't re-run,
# this detects the drift and fails.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT/daemon"

step() { printf '\033[36m[db-schema] %s\033[0m\n' "$*" >&2; }
fail() { printf '\033[31m[db-schema] FAILED: %s\033[0m\n' "$*" >&2; exit 1; }

step 'checking schema drift with drizzle-kit generate'

output="$(bunx drizzle-kit generate 2>&1)" || true

if echo "$output" | grep -q "No schema changes"; then
  printf '\033[32m[db-schema] OK — schema is in sync\033[0m\n' >&2
  exit 0
elif echo "$output" | grep -q "Your SQL migration file"; then
  fail 'schema drift detected — run "bunx drizzle-kit generate" and update migrations.ts'
else
  fail "drizzle-kit output unexpected:\n$output"
fi
