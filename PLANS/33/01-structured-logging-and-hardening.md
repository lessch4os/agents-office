# Structured JSON Logging, Tests, and Hardening

## Problem

The daemon had 76 raw `console.log`/`console.warn`/`console.error` calls scattered
across 12 files with inconsistent formatting. No structured logging, no log levels,
no JSON output. This made debugging and production monitoring difficult.

Additionally, several robustness gaps were identified:
- No logger unit tests or safeNum/safeStr edge case tests
- `seedPricing` failure was silent
- Migration tests didn't simulate realistic v0.1.31→v0.1.32 upgrades
- No documentation for CLI flags, logging, or config differences

## Solution: Structured JSON Logger + Hardening

### Logger architecture

```
daemon/src/services/logger.ts
├── Logger class with level filtering (1-10)
├── Component scoping via .child("forwarder")
├── File appender to ~/.agents-office/logs/daemon.log
├── Global singleton via getLogger()/setLogger()
└── All output is JSON Lines to stderr, pipeable with jq
```

### New CLI flags

| Flag | Default | Description |
|------|---------|-------------|
| `--log <level>` | 3 | Verbosity 1-10 |
| `--log-type <filter>` | all | Component filter: all, daemon, forwarder, doctor, setup |
| `--verbose` | — | Shorthand for `--log 10` |

### Log levels

| Level | Name | When shown |
|-------|------|-----------|
| 1 | error | Always |
| 3 | warn | Default |
| 5 | info | `--log 5` |
| 7 | debug | `--log 7` |
| 10 | trace | `--log 10` (verbose) |

### Files changed

| File | Change |
|------|--------|
| `daemon/src/services/logger.ts` | New — structured JSON logger |
| `daemon/src/services/logger.test.ts` | New — 8 logger tests |
| `daemon/src/main.ts` | Added `--log`, `--log-type` CLI flags; logger setup |
| `daemon/src/server/http.ts` | Replaced `console.log/warn` with logger calls; `seedPricing` error handling |
| `daemon/src/server/http.test.ts` | Added 9 safeNum/safeStr tests + logger flag test |
| `daemon/src/cli/forwarder.ts` | Replaced `console.error` with logger calls via `child("forwarder")` |
| `daemon/src/cli/db-migrate.ts` | Replaced `console.log/error` with logger calls |
| `daemon/src/sources/hook-socket.ts` | Replaced `console.log` with logger calls |
| `daemon/src/sources/jsonl-watcher.ts` | Replaced `console.log` with logger calls |
| `daemon/src/state/reducer.ts` | Replaced `console.warn` with logger calls |
| `daemon/src/db/migrate.test.ts` | Added v0.1.31 legacy DB upgrade test with data preservation |
| `docs/AGENTS.md` | New — CLI reference with logging examples |
| `CLAUDE.md` | Updated logging convention to use logger |

### Hardening

| Issue | Fix |
|-------|-----|
| `safeNum` with Drizzle NULL string bug | Added `v !== snake` and `!Number.isNaN` checks |
| `safeStr` with Drizzle NULL string bug | Added `v !== snake` check to reject column-name-as-value |
| `seedPricing` silent failure | Wrapped in try/catch with `log.warn()` |
| Logger level filtering | Unit tested with mocked stderr |
| Legacy DB migration edge case | Test: old schema with data → migration → data preserved |

### Test results

```
60 unit tests, 0 failures (up from 41)
 8 logger tests (new)
 9 safeNum/safeStr edge case tests (new)
 1 DB migration upgrade test (new)
 1 logger CLI flag test (new)
```

### Usage examples

```bash
# Minimal (warnings only)
agents-office daemon

# Info level
agents-office daemon --log 5

# Debug — pipe with jq
agents-office daemon --log 7 2>&1 | jq 'select(.level >= 7) | {ts, msg, sessionId}'

# Full trace
agents-office daemon --verbose
```
