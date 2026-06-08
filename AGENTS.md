# AGENTS.md

Instructions for coding agents (Cursor, Copilot, Aider, etc.) working in this repo.
See also [`CLAUDE.md`](CLAUDE.md) (Claude Code-specific) and [`README.md`](README.md) (user docs).

## Repository overview

**agents-office** is a Bun/TypeScript daemon + React/PixiJS web dashboard that visualizes AI coding agent sessions. Each running CC (Claude Code) or OpenCode session appears as an animated agent on a web-based office dashboard.

```
package.json              Root workspace
daemon/                   Bun daemon (HTTP/WS server + state machine + SQLite)
web/                      React + PixiJS frontend (Vite)
scripts/                  Shell scripts for install, debug, health check
```

## Key architecture

- **Daemon** (`daemon/src/server/http.ts`): Event processing loop (100ms interval) reads from `eventBuf`, applies state changes via `reducer.ts`, persists to SQLite, broadcasts to WebSocket clients.
- **Event sources**: Hook socket (`hook-socket.ts`, Unix socket), JSONL watcher (`jsonl-watcher.ts`, file watcher), OpenCode SSE (`oc-sse.ts`).
- **State machine** (`daemon/src/state/reducer.ts`): Creates/destroys `AgentSlot` objects, handles activity dedup, token tracking, stale agent GC, child cascade on task end.
- **Decoders** (`daemon/src/decoders/`): Per-source parsing — `hook-decoder.ts` for CC/OC hook protocol, `cc-jsonl.ts` for CC transcript files, `ag-jsonl.ts` for Antigravity.
- **DB** (`daemon/src/db/`): SQLite via Drizzle ORM. Tables: sessions, raw_events, token_snapshots, model_pricing. Migrations via PRAGMA user_version (current v4).

## Code conventions

- **Language**: TypeScript (Bun runtime). Tests use Bun's built-in test runner (`bun test`).
- **Module system**: ES modules (TypeScript source). Compiled binaries via `bun build --compile`.
- **Effect system**: Some modules use `effect-ts` (`Effect`, `HashMap`, `Stream`, `Queue`). New code should prefer plain TypeScript unless Effect's structured concurrency is needed.
- **Database**: Drizzle ORM for schema queries, raw SQL via `bun:sqlite` for complex queries. Migrations in `db/migrations.ts`.
- **Logging**: Use `getLogger()` from `services/logger.ts` — `.info()`, `.warn()`, `.error()`, `.debug()`, `.trace()`. All logs are JSON Lines to stderr.
- **No non-null assertions** (`!`) in non-test code.
- **No `console.log`/`console.warn`** in production paths — use the logger.
- **Scripts target POSIX sh** (not bash).

## Key files to know

| File | Purpose |
|------|---------|
| `daemon/src/server/http.ts` | Main daemon: HTTP routes, WS broadcast, event processing, DB persistence |
| `daemon/src/state/reducer.ts` | State machine: `applyEvent()`, `shouldDrop()`, `tick()`, `sweepExited()` |
| `daemon/src/sources/hook-socket.ts` | Unix socket listener, calls `decodeHookPayload`, pushes to `eventBuf` |
| `daemon/src/sources/jsonl-watcher.ts` | CC transcript file watcher (fs.watch + periodic scan) |
| `daemon/src/decoders/hook-decoder.ts` | CC/OC hook payload decoder (SessionStart, PreToolUse, TokenUpdate, etc.) |
| `daemon/src/decoders/cc-jsonl.ts` | CC JSONL transcript line decoder (token extraction here) |
| `daemon/src/db/migrate.ts` | Migration runner (current version: 4) |
| `daemon/src/db/migrations.ts` | SQL migration definitions |
| `daemon/src/services/logger.ts` | Logger with file appender, level filtering |
| `daemon/src/opencode-plugin.ts` | OpenCode plugin (built separately, not part of daemon) |
| `daemon/src/main.ts` | Entry point, CLI arg parsing, version constant |

## Testing

```bash
bun test                                   # Run all tests
bun test --watch                           # Watch mode
bun test daemon/src/state/reducer.test.ts  # Single file
```

Test files are co-located with source (`reducer.test.ts` next to `reducer.ts`).

## Common tasks

### Adding a new event type
1. Add to `AgentEvent` discriminated union in `schemas/agent-event.ts`
2. Add handler in `reducer.ts` (pattern: `handleXxx(slot, event, state, meta, now, transport)`)
3. Add decoder output in appropriate decoder (hook-decoder.ts / cc-jsonl.ts / ag-jsonl.ts)
4. Add DB persistence in `http.ts` processInterval loop
5. Add wire type in `schemas/wire.ts` if needed for frontend

### Adding a DB migration
1. Add SQL statements to `db/migrations.ts` with version+1
2. Add version check + apply block in `db/migrate.ts`
3. Update version assertions in `db/migrate.test.ts`
4. Update schema in `db/schema.ts` (Drizzle ORM)

### Debugging token flow
```bash
scripts/trace-tokens <session-id>       # Reconstruct from raw_events
scripts/analyze-logs --sid <session-id> # Log timeline
scripts/check-agent-health.sh           # Full diagnostics
sqlite3 ~/.agents-office/sessions.db
  "SELECT json_extract(payload,'$.hook_event_name'), json_extract(payload,'$.usage.input_tokens')
   FROM raw_events WHERE session_id='<id>';"
```

## Known constraints

- **CC hooks never carry token data.** CC token data comes only from JSONL transcript parsing. The `usage` field is absent from all CC hook payloads.
- **Transport enum mismatch** — hook-socket passes source names ("claude-code", "opencode") as transport, but `shouldDrop` checks for "hook"/"jsonl". The hook-wins dedup is currently inert.
- **fs.watch MUST be `yield*`ed** inside `Effect.gen()`. Bare `Effect.sync()` without `yield*` silently discards the operation.
- **OpenCode plugin doesn't re-send sessionStart** on daemon restart. The daemon auto-creates virtual sessions from orphaned token events.
- **BNF-1a agentId hashing** uses BigInt internally, converted to Number for the wire protocol. Hashes are deterministic per (source, transcript_path).

## Important conventions

- `VERSION` constant in `main.ts` must match `package.json`.
- Wire protocol uses `snake_case` matching `web/src/types.ts`.
- `WireActivityState` uses capitalized type discriminators (`"Idle"`, `"Active"`, `"Waiting"`).
- Do NOT use `Bun.connect({ unix: path })` — use `net.createConnection(path)` instead.
- Do NOT use `console.log`/`console.warn` in production code — use `getLogger()`.
- Do NOT add terminal TUI dependencies. The UI is web-only.
