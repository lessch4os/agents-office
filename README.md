# agents-office

Web-based observability dashboard for AI coding agent sessions.

Each running CC (Claude Code) or OpenCode session shows up as an animated agent in a web-based office dashboard.

## Architecture

```
┌──────────────────┐     Unix socket     ┌──────────────────────────────────┐
│  CC Hook          │ ──────────────────► │  Bun Daemon (daemon/src/)        │
│  (hook-shim.ts)   │   JSON/event stream │                                  │
└──────────────────┘                     │  ├─ sources/hook-socket.ts       │
                                          │  ├─ sources/jsonl-watcher.ts    │
┌──────────────────┐     JSONL watch     │  ├─ server/http.ts (process loop)│
│  CC Sessions      │ ◄────────────────── │  ├─ state/reducer.ts            │
│  (~/.claude/*.jsonl)│                   │  ├─ db/ (SQLite persistence)    │
└──────────────────┘                     │  ├─ decoders/ (per-source)       │
                                          │  └─ services/ (logger, pricing) │
┌──────────────────┐     Unix socket     └────────┬─────────────────────────┘
│  OpenCode Plugin  │ ──────────────────►          │
│  (opencode-plugin)│                               │
└──────────────────┘                      WebSocket │
                                                   ▼
                                          ┌──────────────────┐
                                          │  Web Frontend    │
                                          │  React + PixiJS  │
                                          └──────────────────┘
```

The daemon can run in three configurations (all use the same compiled binary):

**Server mode** — daemon on VPS with `--password`. Serves web UI + accepts remote hooks.
```
./daemon/agents-office --port 8080 --password mysecret
# One-command server setup:
curl -fsSL https://raw.githubusercontent.com/lessch4os/agents-office/main/scripts/install-server.sh | bash
```

**Client forwarder** — tiny binary on laptop, forwards local hooks to server.
```
./daemon/agents-office-forwarder --server wss://server/hook --password mysecret
```

**Full daemon + relay** — daemon on laptop with local UI + forwards to server.
```
./daemon/agents-office --port 8080 --relay-to wss://server/hook --password mysecret
```

## Quick start

Note: the `npx`/`bunx` commands below require **Bun** installed (`curl -fsSL https://bun.sh/install | bash`).  
The compiled binary is standalone — no runtime dependencies.

```bash
# Pre-built binary (standalone, no Bun needed)
./daemon/agents-office --port 8080

# Via npm (requires bun)
npx @lessch4os/agents-office --port 8080

# From source
bun install
bun run daemon/src/main.ts --port 8080

# Convenience script (builds web dist + starts daemon)
bash run.sh --port 8080
```

Open http://localhost:8080 in your browser.

### Homebrew

```bash
brew tap lessch4os/agents-office
brew install agents-office

# Start as a background service:
brew services start agents-office
```

### Server install (one-command)

Quick-setup a server with systemd service, auto-generated password, and automatic Bun install:

```bash
curl -fsSL https://raw.githubusercontent.com/lessch4os/agents-office/main/scripts/install-server.sh | bash
```

### Options

| Flag | Default | Description |
|---|---|---|
| `--port <n>` | `8080` | HTTP/WebSocket listen port |
| `--max-desks <n>` | `16` | Number of agent desks in the office |
| `--password <s>` | — | Auth password (enables login page + hook auth) |
| `--username <s>` | `agents-office` | Login username (requires `--password`) |
| `--relay-to <url>` | — | Forward all events to a remote server WebSocket |
| `--web-root <path>` | `../web/dist` | Path to the web frontend build output |
| `--socket <path>` | `/tmp/agents-office-{uid}.sock` | Unix socket path for hook shim |
| `--db <path>` | `~/.agents-office/sessions.db` | SQLite database path |
| `--log <level>` | `3` | Log verbosity 1-10 (1=error, 3=warn, 5=info, 7=debug, 10=trace) |
| `--log-type <filter>` | `all` | Component filter: all,daemon,forwarder,doctor,setup |
| `--verbose`, `-v` | — | Shorthand for `--log 10` |
| `--install` | — | Install hooks + OC plugin then exit |
| `--doctor` | — | Run diagnostics and exit |
| `--reload` | — | Gracefully restart CC/OC + daemon |

Example — server mode with auth:
```bash
bun run daemon/src/main.ts --port 8080 --password secret --username agents-office
```

Example — daemon with verbose logging:
```bash
bun run daemon/src/main.ts --port 8080 --log 7
```

### Client forwarder

Tiny binary — no daemon needed. Forwards local CC/OC hooks to a remote server.

```bash
# Pre-built binary
./daemon/agents-office-forwarder --server wss://server/hook --password secret

# Via npx (requires bun)
npx @lessch4os/agents-office forwarder \
  --server wss://server/hook --password secret

# Or via env vars:
AGENTS_OFFICE_SERVER=wss://server/hook AGENTS_OFFICE_PASSWORD=secret ./daemon/agents-office-forwarder
```

### Environment variables

| Variable | Command | Purpose |
|---|---|---|
| `AGENTS_OFFICE_PASSWORD` | daemon, forwarder | Auth password |
| `AGENTS_OFFICE_SERVER` | forwarder | Remote server WebSocket URL |
| `AGENTS_OFFICE_SOCKET` | daemon, forwarder | Override Unix socket path |
| `AGENTS_OFFICE_DB` | daemon | Override SQLite database path |
| `AGENTS_OFFICE_DAEMON_LOG` | daemon | Override daemon log file path |
| `AGENTS_OFFICE_PLUGIN_LOG` | daemon | Override plugin log file path |
| `AGENTS_OFFICE_LOG_DIR` | daemon | Override log directory (default: ~/.agents-office/logs) |
| `AGENTS_OFFICE_USERNAME` | daemon | Login username |
| `AGENTS_OFFICE_RELAY_TO` | daemon | Relay target WebSocket URL |
| `AGENTS_OFFICE_VERBOSE` | forwarder | Enable verbose logging |

## Client setup (laptop)

Install hooks and plugins on your laptop so your local agents show up on the server dashboard:

```bash
# Via npx (requires bun):
npx @lessch4os/agents-office install-hooks      # CC hooks
npx @lessch4os/agents-office install-opencode   # OC plugin

# Or both at once:
npx @lessch4os/agents-office install

# Then reload to apply hooks gracefully:
agents-office reload

# Then run forwarder to relay to server:
npx @lessch4os/agents-office forwarder \
  --server wss://your-server/hook --password <your-password>
```

### Doctor (diagnostics)

Run diagnostics to check your setup:

```bash
agents-office doctor
```

Checks binary versions, running processes, Unix socket, CC hooks, OC plugin, port, database, logs, and remote server config. Exits with code 1 on failures.

### Reload (graceful restart)

Gracefully restart Claude Code, OpenCode, and the agents-office daemon:

```bash
agents-office reload              # restart CC + OC + daemon
agents-office reload --daemon-only  # restart daemon only
agents-office reload --agents-only  # restart CC/OC only
```

Sends SIGINT to CC/OC (preserving session state) and restarts the daemon via systemd or SIGHUP.

## Uninstall

```bash
# Remove CC hooks from ~/.claude/settings.json
bun run uninstall-hooks

# Remove OC plugin from ~/.config/opencode/plugins/
bun run uninstall-opencode

# Remove data directory
rm -rf ~/.agents-office/
```

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `EADDRINUSE` on startup | Port already taken | Use `--port <other>` or kill the existing process |
| Web UI shows blank page | Web frontend not built | Run `bun run build:web` or use `run.sh` |
| Hook shim "connection refused" | Daemon not running | Start the daemon first, or check `--socket` path matches |
| No agents appearing | Hook/plugin not installed | Run `npx @lessch4os/agents-office install` |
| Agents appear but **tokens are 0** | CC hooks don't carry token data | This is expected for CC. Tokens come from JSONL transcript parsing (enabled by default). See "Session data & debugging" section. |
| Agents missing after daemon restart | OpenCode plugin doesn't re-send sessionStart | The daemon auto-creates virtual sessions on first event. Run a tool on the agent to trigger it. |
| `NOT NULL constraint failed: sessions.agent_id` | Stale DB schema from old version | Run `agents-office db-migrate` or just restart the daemon (auto-migration v4 drops the column). |
| Forwarder won't connect | Wrong password or server URL | Check `--password` and `--server` match the server config |
| Permission denied on socket | Socket in a restricted dir | Use `AGENTS_OFFICE_SOCKET=/tmp/my.sock` or `--socket` flag |

### Development

```bash
# Run tests
bun test

# Web frontend dev (with Vite proxy to daemon on :8080)
bun run dev:web
```

## Project layout

```
package.json           Root workspace config — bun install installs all workspaces

daemon/              Bun daemon process + hook shim + OC plugin
├── src/
│   ├── main.ts                  Entry point
│   ├── server/
│   │   ├── http.ts              HTTP/WS server + event processing loop + DB persistence
│   │   └── http.test.ts         e2e tests
│   ├── sources/
│   │   ├── hook-socket.ts       Unix socket listener (net.createServer)
│   │   ├── jsonl-watcher.ts     JSONL file watcher (fs.watch + cursor tracking)
│   │   └── oc-sse.ts            OpenCode SSE event source
│   ├── decoders/
│   │   ├── hook-decoder.ts      Hook payload decoder + shared utilities
│   │   ├── cc-jsonl.ts          CC JSONL line decoder + label deriver
│   │   ├── ag-jsonl.ts          Antigravity JSONL decoder + label deriver
│   │   ├── oc-sse.ts            OpenCode SSE event decoder
│   │   └── decoder.test.ts      All decoder tests
│   ├── schemas/
│   │   ├── agent-event.ts       AgentEvent discriminated union
│   │   ├── agent-id.ts          FNV-1a 64-bit AgentId hashing
│   │   └── wire.ts              WireScene/WireAgent types
│   ├── state/
│   │   ├── reducer.ts           State machine (dedup, GC, cascade, sweep)
│   │   └── reducer.test.ts      Reducer tests
│   ├── services/
│   │   ├── logger.ts            Logger + file appender
│   │   ├── config.ts            Config service
│   │   ├── session-store.ts     Tag/annotation CRUD
│   │   └── pricing.ts           Model pricing + context window limits
│   ├── db/
│   │   ├── index.ts             createDb (SQLite + migrate)
│   │   ├── schema.ts            Drizzle ORM schema
│   │   ├── migrate.ts           Migration runner
│   │   ├── migrations.ts        Migration SQL
│   │   └── migrate.test.ts      Migration tests
│   ├── cli/
│   │   ├── forwarder.ts         Remote-forwarder CLI
│   │   ├── doctor.ts            Diagnostics CLI
│   │   ├── reloader.ts          Graceful restart CLI
│   │   ├── setup.ts             Interactive setup CLI
│   │   └── db-migrate.ts        Manual DB migration CLI
│   ├── test/
│   │   ├── e2e.test.ts          Full integration tests
│   │   ├── fixture.ts           Test fixtures
│   │   ├── hook-client.ts       Test socket client
│   │   └── helper.ts            Test daemon factory
│   ├── opencode-plugin.ts       Plugin source (built for OC)
│   └── hook-shim.ts             CC hook shim source (built standalone)
├── agents-office-hook           Compiled hook binary
├── agents-office                Compiled daemon binary
├── agents-office-forwarder      Compiled forwarder binary
├── dist/                        Compiled plugin JS
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
│   │   ├── pixi-app.ts      App + stage setup
│   │   ├── agent-entity.ts  Agent sprite entity
│   │   ├── steering.ts      Smooth movement
│   │   ├── waypoints.ts     Desk position nav
│   │   └── colors.ts        Color palette
│   └── components/
│       ├── OfficePixi.tsx   Main canvas (PixiJS)
│       ├── ActivityFeed.tsx Right sidebar log
│       ├── HistoryPage.tsx  Past sessions
│       ├── PetOverlay.tsx   Floating agent status
│       ├── OfficeStatsHud.tsx   Stats panel
│       ├── ContextMeterHud.tsx  Context usage panel
│       ├── PricingPage.tsx  Model pricing table
│       ├── renderer.ts     Canvas 2D drawing primitives
│       └── sprites.ts      Sprite pixel data
├── index.html
├── vite.config.ts
├── package.json
└── tsconfig.json

scripts/
├── install.sh                     Full install
├── install-hooks.sh               CC hook registration
├── install-opencode-plugin.sh     OC plugin install
├── uninstall-hooks.sh             Remove CC hooks
├── uninstall-opencode-plugin.sh   Remove OC plugin
├── preflight.sh                   CI mirror — bun test + web build
├── analyze-logs                   Filter + merge daemon.log and plugin.log by SID/time
├── trace-tokens                   Reconstruct token flow from raw_events + DB
├── get-session-data               Full session data dump (SQLite + logs)
├── get-logs-by-session-id         Grep daemon + plugin logs for session ID
├── check-agent-health.sh          Verify CC hooks + OC plugin are working
└── check-db-schema.sh             Verify DB schema matches expected
```

## Wire protocol

The daemon broadcasts a `WireScene` JSON object over WebSocket:

```json
{
  "agents": {
    "12345678": {
      "agent_id": 12345678,
      "source": "claude-code",
      "session_id": "uuid",
      "cwd": "/home/user/project",
      "label": "cc·project",
      "state": { "type": "Idle" },
      "state_started_at_ms": 1700000000000,
      "last_event_at_ms": 1700000000000,
      "created_at_ms": 1700000000000,
      "exiting_at_ms": null,
      "desk_index": 0,
      "tool_call_count": 0,
      "active_ms": 0,
      "parent_id": null,
      "current_tool": null,
      "agent_type": null,
      "session_total_tokens": 0,
      "context_total_tokens": 0,
      "context_input_tokens": 0,
      "token_input_total": 0,
      "token_output_total": 0,
      "cache_read_tokens": 0,
      "context_window_limit": 100000,
      "model_name": null,
      "completed_children": []
    }
  },
  "max_desks": 16,
  "now_ms": 1700000001000
}
```

Active state includes tool info:
```json
{
  "type": "Active",
  "activity": "typing",
  "tool_use_id": "tooluse_abc123",
  "detail": "Bash: ls -la"
}
```

## Hook installation

```bash
# Build + register the hook shim in ~/.claude/settings.json
bun run install-hooks

# To remove:
bun run uninstall-hooks
```

The hook shim must never block CC — always exits 0, 200ms timeout.

## Event sources

### Claude Code (hooks)
CC fires hook events (SessionStart, PreToolUse, PostToolUse, Notification, SessionEnd) via `hook-shim.ts` to the daemon's Unix socket. **CC hooks never include token usage data** — the `usage` field is absent from all CC hook payloads.

### Claude Code (JSONL watcher)
The daemon watches `~/.claude/projects/` for `.jsonl` transcript files. This is the **only way to get CC token data**. The JSONL decoder (`cc-jsonl.ts`) parses assistant messages and extracts `usage.input_tokens` / `usage.output_tokens`. Enabled by default — no configuration needed.

### OpenCode (plugin)
The OpenCode plugin hooks into OC's event system and sends CC-format events (including `TokenUpdate` with real cumulative token counts) to the daemon's Unix socket.

### OpenCode (SSE watcher)
The daemon can subscribe to OpenCode's SSE event stream at `--opencode-sse-url` via `sources/oc-sse.ts`.

## Session data & debugging

All raw hook events, token snapshots, and session metadata are stored in an SQLite database (`~/.agents-office/sessions.db` by default).

### Quick scripts

```bash
scripts/trace-tokens <session-id>        # Reconstruct token flow
scripts/analyze-logs --sid <session-id>  # Filter daemon + plugin logs
scripts/get-session-data <session-id>    # Full session data dump
scripts/get-logs-by-session-id <session-id>  # Shortcut for log grep
```

### Query raw events (hook_event_name is in JSON, not a column)

```bash
# Recent events with types
sqlite3 -header -column ~/.agents-office/sessions.db \
  "SELECT datetime(ts/1000,'unixepoch') AS ts,
          json_extract(payload, '$.hook_event_name') AS event,
          length(payload) AS bytes
   FROM raw_events WHERE session_id = '<id>' ORDER BY ts;"

# Token data only
sqlite3 -header -column ~/.agents-office/sessions.db \
  "SELECT datetime(ts/1000,'unixepoch') AS ts,
          json_extract(payload, '$.hook_event_name') AS event,
          json_extract(payload, '$.usage.input_tokens') AS input,
          json_extract(payload, '$.usage.output_tokens') AS output
   FROM raw_events WHERE session_id = '<id>'
   AND json_extract(payload, '$.usage') IS NOT NULL
   ORDER BY ts;"
```

### Token snapshots

```bash
sqlite3 -header -column ~/.agents-office/sessions.db \
  "SELECT datetime(ts/1000,'unixepoch') AS ts, cumul_input, cumul_output,
           ROUND(context_pct * 100, 1) AS pct
   FROM token_snapshots WHERE session_id = '<id>' ORDER BY ts;"
```

### Session summary

```bash
sqlite3 -header -column ~/.agents-office/sessions.db \
  "SELECT source, model_name, input_tokens, output_tokens,
           tool_call_count, active_ms, cost_usd
   FROM sessions WHERE session_id = '<id>';"
```

### What's stored

| Table | Contents | Retention |
|-------|----------|-----------|
| `sessions` | Summary per session (tokens, cost, model, parent, timing) | Session lifetime |
| `token_snapshots` | Token state at each `TokenUpdate` event (cumul_input, cumul_output, context_pct) | Session lifetime |
| `raw_events` | Every raw hook payload as received (full JSON, queryable by session_id) | Session lifetime |
| `model_pricing` | Model name → cost per token mapping | Until reset |
| `tags` | User-applied tags for session comparison | Until removed |

### Verifying agents are working

After starting the daemon:

```bash
# 1. Check daemon is alive
curl -s http://localhost:8080/api/health

# 2. Run CC and check scene
cd /tmp && echo "run: echo test" | claude -p
curl -s http://localhost:8080/api/scene | python3 -m json.tool

# 3. Run OC and check scene
opencode run "say hi"
curl -s http://localhost:8080/api/scene

# 4. Check raw events captured
sqlite3 ~/.agents-office/sessions.db "SELECT COUNT(*) FROM raw_events;"

# 5. Check daemon log for JSONL watcher
grep "jsonl watcher" ~/.agents-office/logs/daemon.log

# 6. Full health check
scripts/check-agent-health.sh
```

### Session restoration across daemon restarts

When the daemon restarts:
- **CC sessions** are restored by the JSONL watcher from transcript files (within 1 hour of last activity)
- **Old sessions** (inactive > 1 hour) are scanned but not emitted — their transcripts exist for historical queries
- **OpenCode sessions** don't re-send sessionStart on reconnect. The daemon auto-creates a virtual session on the first orphaned `tokenUsage` or `activityStart` event. Run a tool on the agent to trigger this.
- **OpenCode sessions** that do have a fresh sessionStart (new OC sessions started after daemon restart) appear immediately

### DB migrations

The database version is tracked by `PRAGMA user_version`. Current version: **4**.

```bash
sqlite3 ~/.agents-office/sessions.db "PRAGMA user_version;"
```

Manual migration: `bun run daemon/src/main.ts db-migrate`

| Version | Description |
|---------|-------------|
| 1 | Initial schema (sessions, raw_events, token_snapshots) |
| 2 | Add model_pricing table, renaming columns |
| 3 | Add cumul_cache column to token_snapshots |
| 4 | Drop stale `agent_id` column from sessions |

## License

MIT
