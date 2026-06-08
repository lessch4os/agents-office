# CLAUDE.md

Instructions for Claude Code (or any AI coding agent) working in this repo.

## What this is

A Bun/TypeScript daemon + React web frontend that visualizes AI coding agent sessions. Each running CC (Claude Code) or OpenCode session shows up as an animated agent on a web-based office dashboard.

Architecture overview: [`README.md`](README.md).

## Layout

```
package.json           Root workspace config — bun install installs all workspaces

daemon/              Bun daemon process + hook shim + OC plugin
├── src/
│   ├── main.ts                  Entry point (local mode only)
│   │
│   ├── server/
│   │   ├── http.ts              HTTP/WS server + event processing loop + DB persistence
│   │   └── http.test.ts         e2e tests
│   ├── sources/
│   │   ├── hook-socket.ts       Unix socket listener (net.createServer)
│   │   ├── jsonl-watcher.ts     JSONL file watcher (fs.watch + cursor tracking)
│   │   ├── oc-sse.ts            OpenCode SSE event source
│   │   └── source-manager.ts    Source lifecycle management
│   ├── decoders/
│   │   ├── hook-decoder.ts      Hook payload decoder + shared utilities
│   │   ├── cc-jsonl.ts          CC JSONL line decoder + label deriver + session-end checker
│   │   ├── ag-jsonl.ts          Antigravity JSONL decoder + label deriver
│   │   ├── oc-sse.ts            OpenCode SSE event decoder
│   │   └── decoder.test.ts      All decoder tests
│   ├── schemas/
│   │   ├── agent-event.ts       AgentEvent discriminated union type
│   │   ├── agent-id.ts          FNV-1a 64-bit AgentId (BigInt → Number for wire)
│   │   └── wire.ts              WireScene/WireAgent types
│   ├── state/
│   │   ├── reducer.ts           State machine (dedup, debounce, GC, cascade, sweep)
│   │   └── reducer.test.ts      Reducer tests
│   ├── services/
│   │   ├── logger.ts            Logger + file appender (JSON Lines to stderr)
│   │   ├── config.ts            Config service (Effect-based)
│   │   ├── session-store.ts     Tag/annotation CRUD
│   │   └── pricing.ts           Model pricing + context window limits
│   ├── db/
│   │   ├── index.ts             createDb (SQLite + migrate)
│   │   ├── schema.ts            Drizzle ORM schema (sessions, raw_events, token_snapshots, model_pricing)
│   │   ├── migrate.ts           Migration runner (PRAGMA user_version)
│   │   ├── migrations.ts        Migration SQL statements by version
│   │   └── migrate.test.ts      Migration tests
│   ├── cli/
│   │   ├── forwarder.ts         Remote-forwarder CLI entry
│   │   ├── doctor.ts            Diagnostics CLI
│   │   ├── reloader.ts          Graceful restart CLI
│   │   ├── setup.ts             Interactive setup CLI
│   │   └── db-migrate.ts        Manual DB migration CLI
│   ├── test/
│   │   ├── e2e.test.ts          Full integration tests
│   │   ├── fixture.ts           Test fixtures (hook payloads, event sequences)
│   │   ├── hook-client.ts       Test hook socket client
│   │   └── helper.ts            Test daemon factory
│   ├── opencode-plugin.ts       Plugin source (built for OC plugin system)
│   └── hook-shim.ts             CC hook shim source (built as standalone binary)
├── agents-office-hook           Compiled hook binary (build artifact)
├── agents-office                Compiled daemon binary (build:daemon output)
├── agents-office-forwarder      Compiled forwarder binary (build:forwarder output)
├── dist/                        Compiled plugin JS (build:plugin output)
├── drizzle/                     Drizzle migration snapshots
├── package.json                 Workspace: "agents-office-daemon"
└── tsconfig.json

web/                 React frontend (Vite + TypeScript + PixiJS)
├── src/
│   ├── types.ts         WireScene/WireAgent/WireActivityState
│   ├── ws.ts            WebSocket client with reconnection
│   ├── App.tsx          App shell
│   ├── main.tsx         Vite entry point
│   ├── engine/          PixiJS rendering engine
│   │   ├── pixi-app.ts
│   │   ├── agent-entity.ts
│   │   ├── steering.ts
│   │   ├── waypoints.ts
│   │   └── colors.ts
│   └── components/
│       ├── OfficePixi.tsx
│       ├── ActivityFeed.tsx
│       ├── HistoryPage.tsx
│       ├── PetOverlay.tsx
│       ├── OfficeStatsHud.tsx
│       ├── ContextMeterHud.tsx
│       ├── PricingPage.tsx
│       ├── renderer.ts
│       └── sprites.ts
├── index.html
├── vite.config.ts        Dev proxy: /ws → ws://localhost:8080
├── package.json          Workspace: "agents-office-web"
└── tsconfig.json

scripts/
├── install.sh                     One-command full install (build + hook + plugin)
├── install-hooks.sh               CC hook registration (~/.claude/settings.json)
├── install-opencode-plugin.sh     OC plugin install (~/.config/opencode/plugins/)
├── uninstall-hooks.sh             Remove CC hooks
├── uninstall-opencode-plugin.sh   Remove OC plugin
├── preflight.sh                   Mirrors CI — runs bun test + web build
├── analyze-logs                   Filter + merge daemon.log and plugin.log by SID/time
├── trace-tokens                   Reconstruct token flow from raw_events + DB
├── get-session-data               SQLite + log dump for a session ID
├── get-logs-by-session-id         Grep daemon + plugin logs for a session ID
├── check-db-schema.sh             Verify DB schema matches expected
├── set-pricing                    Update model pricing in DB
├── dev.sh                         Dev workflow helper
├── build-local.sh                 Containerized build
├── make-deb.sh                    Debian package builder
├── test-binary-migration.sh       Test binary upgrade migration
├── test-e2e.sh                    Run e2e tests
├── install-server.sh              One-command server setup (nginx, systemd)
└── check-agent-health.sh          Verify CC hooks + OC plugin are working

.github/workflows/
└── ci.yml             GitHub Actions (Bun tests + web build)
```

## Development quick start

```bash
bun install                              # install all workspace deps

# Terminal 1: start daemon
bun run daemon/src/main.ts --port 8080

# Terminal 2: start web dev server (with Vite proxy to daemon)
bun run dev:web

# Terminal 3: run tests
bun test

# Build everything for production
bun run build

# Build single daemon binary (no Bun runtime needed)
bun run build:daemon
./daemon/agents-office --port 8080

# Full install (builds all + registers hooks + OC plugin)
bun run install:all
```

### Pre-push preflight

`scripts/preflight.sh` mirrors `.github/workflows/ci.yml` (Bun tests + web build).
`.githooks/pre-push` calls it automatically. Activate the hook **once per clone**:

```
git config core.hooksPath .githooks
```

Bypass in an emergency with `git push --no-verify` or `SKIP_PREFLIGHT=1 git push`.

## Conventions

- **TDD first.** Write a failing test, then the minimal code to make it pass.
- **DRY, YAGNI.** No features beyond what's specified.
- **No comments unless WHY.** Don't restate what the code does. Comment only for non-obvious constraints or workarounds.
- **Errors propagate by throwing in TS.** The hook listener and JSONL watcher log + continue on malformed input — they never crash.
- **No non-null assertions (`!`) in non-test code.**
- **Match the surrounding shell:** scripts target POSIX sh.
- **Keep docs current.** Update README.md and CLAUDE.md when module structure or public API changes.

## Architecture invariants

1. **Events flow through `http.ts` poll loop** → `reducer.ts` `applyEvent()` → WebSocket broadcast → `web/src/ws.ts` → `OfficePixi.tsx` canvas render.
2. **Each source (CC, AG, OC) owns its own decoder and label deriver.** CC and AG use `JsonlWatcher` with injected fn pointers. OC has an SSE watcher (`sources/oc-sse.ts`) and a plugin (`opencode-plugin.ts`). The plugin speaks the CC hook protocol and reuses `hook-decoder.ts`.
3. **The hook shim must never block CC.** Always exit 0 silently on any error. 200ms write timeout is non-negotiable.
4. **Bun daemon has no terminal dependencies.** It's a headless HTTP/WS server.
5. **Wire protocol is snake_case** matching `web/src/types.ts`. `WireActivityState` uses capitalized type discriminators (`"Idle"`, `"Active"`, `"Waiting"`).
6. **AgentId** uses FNV-1a 64-bit hashing with BigInt for exact u64 arithmetic, converted to Number for the wire protocol.
7. **`VERSION` constant in `main.ts` and `forwarder.ts`** must match `package.json` version. The compiled `--version` flag reads this constant.
8. **`Formula/agents-office.rb`** must stay in sync with the build process. If build steps or binary names change, update the formula. Tag `v{VERSION}` must exist before brew users can install.

## Data flow (how a tool call becomes a moving agent)

```
CC runs Bash                    OpenCode runs tool
  │                                │
  ▼                                ▼
hook-shim.ts reads stdin ─┐   opencode-plugin.ts hooks OC events ─┐
                          │                                       │
                          ▼                                       │
                  hook-socket.ts (Unix socket) ◄───────────────────┘
                          │
                          ▼
              decodeHookPayload() → AgentEvent[]
                          │
                          ▼
              http.ts eventBuf → processInterval (every 100ms)
                          │
                          ▼
              reducer.ts applyEvent()
               ├─ shouldDrop() — dedup hook vs jsonl
               ├─ strategyPrelude() — track active hooks/tasks
               ├─ handleSessionStart() → creates AgentSlot
               ├─ handleActivityStart() → sets Active state
               ├─ handleTokenUsage() → updates token counts
               ├─ handleActivityEnd() → sets Idle/pending
               └─ sweepExited() → GC completed children
                          │
                          ▼
              DB persistence (sessions, raw_events, token_snapshots)
              WebSocket broadcast to web UI
                          │
                          ▼
              OfficePixi.tsx renders animated agent
```

## Event sources

### Claude Code (hooks)
CC fires hook events (SessionStart, PreToolUse, PostToolUse, TokenUpdate, Notification, SessionEnd) which are forwarded by `hook-shim.ts` to the daemon's Unix socket. CC hooks **never include token usage data** — the `usage` field is absent from all CC hook payloads.

### Claude Code (JSONL watcher)
The daemon watches `~/.claude/projects/` for `.jsonl` transcript files via `jsonl-watcher.ts`. Each line is decoded by `cc-jsonl.ts` (tool_use → activityStart, tool_result → activityEnd, message usage → tokenUsage). This is the **only way to get CC token data**. The watcher uses `fs.watch` + periodic scan (60s). New transcript files are detected automatically.

### OpenCode (plugin)
The OpenCode plugin (`opencode-plugin.ts`) hooks into OC's event system and sends CC-format hook events to the daemon's Unix socket. It sends TokenUpdate events with real cumulative token data (input_tokens, output_tokens). On daemon restart, the plugin reconnects but doesn't re-send sessionStart — the daemon auto-creates a virtual session from orphaned token events.

### OpenCode (SSE watcher)
The daemon subscribes to OpenCode's SSE event stream at `--opencode-sse-url` via `sources/oc-sse.ts`. Decoder in `decoders/oc-sse.ts`.

## Known sharp edges

- **CC hooks never carry token data.** The `usage` field is absent from all CC hook payloads (SessionStart, PreToolUse, PostToolUse, etc.). For CC token data, the JSONL watcher must be enabled (it parses transcript files where `usage` IS present in assistant messages).
- **JSONL watcher's `fs.watch` was never running** (pre-fix) — `Effect.sync()` without `yield*` silently discards the operation. Always `yield*` Effect operations inside `Effect.gen()`.
- **Transport enum mismatch** — `hook-socket.ts` passes `ctx.source` ("claude-code", "opencode") as transport, but `reducer.ts:shouldDrop` and `strategyPrelude` check for "hook"/"remote-hook"/"sse"/"jsonl". The hook-wins dedup and token-suppression logic is currently inert for CC/OC hook events.
- **OpenCode plugin doesn't re-send sessionStart on reconnect.** On daemon restart, the plugin reconnects but never re-emits `session.created`. The daemon auto-creates a virtual session on the first orphaned `tokenUsage` or `activityStart` event.
- **`agent_id` column** — DB migration v4 drops a stale `agent_id TEXT NOT NULL` column from the sessions table (from an older schema version). Without this migration, ALL session inserts fail with `NOT NULL constraint failed: sessions.agent_id`.
- **Raw events not stored for local hooks** (pre-fix) — `hook-socket.ts` never called `storeRawEvent()`. Fixed by passing an `onRawPayload` callback in `http.ts`.
- **`completedChildren` lost on sweep** (pre-fix) — `sweepExited` removed parents before recording children. Fixed with two-pass approach.
- **CC hook `transcript_path` always points to the PARENT'S transcript**, even when a subagent is the actor — so subagent hook events hash to the parent's `AgentId`. The reducer suppresses hook events while a `Task` tool is in flight; JSONL has correct subagent attribution via per-subagent transcript files.
- **JSONL watcher skips historical transcripts on startup.** Only files modified in the last hour emit `SessionStart` on initial scan.
- **`ActivityState::Active` ≠ "tool is currently executing".** The reducer uses a 1500ms debounce (`ACTIVE_GRACE_WINDOW`) before transitioning to Idle.

## Things NOT to do

- Don't add `ratatui` / `crossterm` / terminal dependencies. The TUI was replaced by the web frontend.
- Don't write `Bun.connect({ unix: path })` — use `net.createConnection(path)` instead.
- Don't use raw `console.log` / `console.warn` in production paths. Use `getLogger()` from `src/services/logger.ts` instead (`.info()`, `.warn()`, `.error()`, `.debug()`, `.trace()`). All logs output JSON Lines to stderr.
- Don't relax the hook shim's "always exit 0" contract. Blocking CC = breaking the user's primary workflow.
- Don't generate README / CLAUDE.md / docs in PRs unless explicitly asked.
- Don't `git push` without explicit user confirmation.

## Session debugging

All raw hook events are stored in SQLite (`~/.agents-office/sessions.db`). Use the query scripts:

```bash
scripts/get-session-data <session-id>   # Full dump: raw events, tokens, parent/child, logs
scripts/get-logs-by-session-id <session-id>  # Daemon + plugin text logs
scripts/trace-tokens <session-id>       # Reconstruct token flow from raw_events
scripts/analyze-logs --sid <session-id> # Filter daemon + plugin logs by session
```

Tables:
- `sessions` — summary per session (model, tokens, cost, parent, timing)
- `token_snapshots` — token state at each `TokenUpdate` (cumul_input, cumul_output, context_pct)
- `raw_events` — EVERY raw hook payload as received (full JSON, queryable by session_id)

Raw events are stored in `hook-socket.ts` via `onRawPayload` callback before decoding.

### Quick queries

```bash
# Show recent sessions with token data
sqlite3 -header -column ~/.agents-office/sessions.db \
  "SELECT session_id, source, input_tokens, output_tokens, tool_call_count, active_ms
   FROM sessions ORDER BY started_at DESC LIMIT 10;"

# Show raw event types for a session (hook_event_name is in JSON payload, not its own column)
sqlite3 -header -column ~/.agents-office/sessions.db \
  "SELECT datetime(ts/1000,'unixepoch'), json_extract(payload, '$.hook_event_name') AS event,
          json_extract(payload, '$.usage.input_tokens') AS input,
          json_extract(payload, '$.usage.output_tokens') AS output
   FROM raw_events WHERE session_id = '<id>' ORDER BY ts;"

# Show token snapshots
sqlite3 -header -column ~/.agents-office/sessions.db \
  "SELECT datetime(ts/1000,'unixepoch'), cumul_input, cumul_output,
           ROUND(context_pct * 100, 1) AS pct
   FROM token_snapshots WHERE session_id = '<id>' ORDER BY ts;"
```

## Verifying agents are working

After starting the daemon (`bun run daemon/src/main.ts --port 8080`):

### 1. Check daemon is alive
```bash
curl -s http://localhost:8080/api/health   # → {"ok":true}
curl -s http://localhost:8080/api/scene    # → {"agents":{...},"max_desks":16}
```

### 2. Verify CC hooks fire
```bash
cd /tmp && echo "run: echo hook-test" | claude -p

# Check the session appeared in the scene
curl -s http://localhost:8080/api/scene | python3 -c "
import sys,json; d=json.load(sys.stdin)
for a in d['agents'].values():
  print(f'{a[\"source\"]:10s} {a[\"session_id\"][:20]} tools={a[\"tool_call_count\"]} state={a[\"state\"][\"type\"]}')" 2>/dev/null
```

### 3. Verify CC JSONL token capture
CC tokens come from transcript files, not hooks. After a CC session, check:
```bash
scripts/trace-tokens <session-id>  # Shows persisted token values
```

### 4. Verify OpenCode plugin events
```bash
cd /tmp && opencode run "say hi"
# Check scene for new agent with source=opencode
```

### 5. Check raw event capture
```bash
sqlite3 ~/.agents-office/sessions.db "SELECT COUNT(*) FROM raw_events;"
# Should show 1+ rows per hook/plugin event
```

### 6. Full health check
```bash
scripts/check-agent-health.sh
```

## Where to look

- "How does a CC tool call become a moving agent?" → `http.ts` event loop → `reducer.ts` `applyEvent()` → WebSocket broadcast → `web/src/ws.ts` → `OfficePixi.tsx` canvas render.
- "How does multi-source decoding work?" → Each source (CC in `cc-jsonl.ts`, AG in `ag-jsonl.ts`) has its own `decode*Line` + `derive*Label` functions, injected into `JsonlWatcher` via fn pointers.
- "How do hooks get installed?" → `bun run install-hooks`. Writes hook entries into `~/.claude/settings.json`.
- "Why don't old idle sessions show on startup?" → `jsonl-watcher.ts` seed phase checks mtime and only emits `SessionStart` for files within the 1-hour window.
- "How does the hook shim work?" → `daemon/src/hook-shim.ts` reads stdin as JSON, connects to the daemon's Unix socket via `net.createConnection`, writes the payload, and exits 0.
- "How does OpenCode integration work?" → Two paths: (a) SSE watcher in `sources/oc-sse.ts` polls OC server natively, (b) OC plugin in `opencode-plugin.ts` hooks into OC's event system and sends CC-format hook events to the Unix socket.
- "Why are CC tokens 0?" → CC hooks never include `usage` data. Enable JSONL watcher (enabled by default — watches `~/.claude/projects/`). CC token data comes from transcript files.
- "Why is a session missing from the scene after daemon restart?" → The OpenCode plugin doesn't re-send sessionStart. The daemon auto-creates virtual sessions on first orphaned event. Run a tool on the agent to trigger it.
- "How do I debug token flow?" → `scripts/trace-tokens <session-id>` shows every `TokenUpdate` payload, cumulative reconstruction, and DB persistence cross-check.
