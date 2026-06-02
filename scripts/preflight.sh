#!/usr/bin/env bash
# Pre-push checks: runs Bun tests + web build before pushing.
# Mirrors .github/workflows/ci.yml.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

if [[ "${SKIP_PREFLIGHT:-0}" == "1" ]]; then
    printf '\033[33m[preflight] SKIP_PREFLIGHT=1 — skipping checks\033[0m\n' >&2
    exit 0
fi

step() { printf '\033[36m[preflight] %s\033[0m\n' "$*" >&2; }
fail() { printf '\033[31m[preflight] FAILED: %s\033[0m\n' "$*" >&2; exit 1; }

step 'bun test (daemon unit tests)'
bun test --cwd daemon --path-ignore-patterns="web-health" || fail 'daemon unit tests: fix failures and recommit'

step 'bun test (web health test — starts daemon, hits /health and /)'
bun test --cwd daemon --filter="web-health" || fail 'web health test: daemon not serving correctly'

step 'bun run build (web)'
bun run --cwd web build || fail 'web build: fix build errors and recommit'

printf '\033[32m[preflight] all checks passed\033[0m\n' >&2
