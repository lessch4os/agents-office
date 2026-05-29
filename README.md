# agents-office

Web-based observability dashboard for AI coding agent sessions.

Each running CC (Claude Code), Antigravity, or OpenCode session shows up as an animated agent in a web-based office dashboard.

## Architecture

```
┌──────────────────┐     Unix socket     ┌──────────────────┐
│  CC Hook          │ ──────────────────► │                  │
│  (hook-shim.ts)   │   JSON/event stream │   Bun Daemon     │
└──────────────────┘                     │  (daemon/src/)   │
                                          │                  │
┌──────────────────┐                     │  ┌─ Hook Socket  │
│  CC Sessions      │     JSONL watch    │  ├─ JSONL Watch  │
│  (JSONL)          │ ──────────────────► │  ├─ Reducer      │
└──────────────────┘                     │  ├─ State        │
                                          │  ├─ WebSocket   │
┌──────────────────┐     JSONL watch      │  ├─ SSE Watcher  │
│  Antigravity      │ ──────────────────► │  └─ Plugin       │
│  Sessions         │                     └────────┬─────────┘
└──────────────────┘                              │
                                          WebSocket │
┌──────────────────┐     Unix socket                │
│  OpenCode Plugin  │ ──────────────────►           │
│  (opencode-plugin)│                                │
└──────────────────┘                                 │
                                                      ▼
┌──────────────────┐                          ┌──────────────────┐
│  Forwarder        │  WebSocket (TLS)        │  Web Frontend    │
│  (client machine) │ ──────────► /hook       │  (web/src/)      │
│  Unix socket → WS │                        │  React + PixiJS  │
└──────────────────┘                          └──────────────────┘
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
| `--projects-root <path>` | `~/.claude/projects` | Claude Code projects directory to watch |
| `--ag-brain-root <path>` | `~/.gemini/antigravity-cli/brain` | Antigravity brain directory |
| `--opencode-sse-url <url>` | — | OpenCode SSE event stream URL |
| `--db <path>` | `~/.agents-office/sessions.db` | SQLite database path |
| `--verbose`, `-v` | — | Verbose logging |
| `--install` | — | Install hooks + OC plugin then exit |

Example — server mode with auth:
```bash
bun run daemon/src/main.ts --port 8080 --password secret --username agents-office
```

Example — daemon with relay:
```bash
bun run daemon/src/main.ts --port 8080 --relay-to wss://server/hook --password secret
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

# Then run forwarder to relay to server:
npx @lessch4os/agents-office forwarder \
  --server wss://your-server/hook --password <your-password>
```

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
│   ├── main.ts          Entry point (local mode only)
│   ├── emitter.ts       EmitManager: emit/broadcast/tick
│   ├── types.ts         AgentEvent, Activity, ToolDetail (discriminated unions)
│   ├── agent-id.ts      FNV-1a 64-bit AgentId (BigInt → Number for wire)
│   ├── state.ts         SceneState, AgentSlot, ActivityState
│   ├── wire.ts          SceneState → WireScene JSON conversion
│   ├── decoder.ts       Hook payload decoder + shared utilities
│   ├── claude-code.ts   CC JSONL decoder + label deriver
│   ├── antigravity.ts   AG JSONL decoder + label deriver
│   ├── hook-socket.ts   Unix socket listener (net.createServer)
│   ├── jsonl-watcher.ts JSONL file watcher (fs.watch + cursor tracking)
│   ├── reducer.ts       State machine (dedup, debounce, GC, cascade)
│   ├── opencode-sse.ts        OC SSE watcher
│   ├── opencode-sse-decoder.ts OC SSE event decoder
│   ├── opencode-plugin.ts     Plugin source (built for OC plugin system)
│   ├── hook-shim.ts           CC hook shim source (built standalone)
│   ├── session-store.ts  SQLite session persistence
│   ├── pricing.ts        Model pricing + context window limits
│   └── logger.ts         Logger + file appender
├── agents-office-hook    Compiled hook binary
├── agents-office         Compiled daemon binary
├── agents-office-forwarder  Compiled forwarder binary
├── dist/                Compiled plugin JS
├── package.json
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
├── get-session-data               SQLite + log dump
└── get-logs-by-session-id         Grep daemon + plugin logs
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
      "context_input_tokens": 0,
      "token_input_total": 0,
      "token_output_total": 0,
      "cache_read_tokens": 0,
      "context_window_limit": 100000
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

## OpenCode integration

agents-office supports OpenCode via two complementary mechanisms:

### 1. OpenCode Plugin (real-time, recommended)

An OpenCode plugin hooks into session/tool events and forwards them to agents-office's Unix socket — same protocol as the CC hook shim.

```bash
# Install the plugin to ~/.config/opencode/plugins/
bun run install-opencode

# Restart OpenCode for the plugin to take effect.

# To remove:
bun run uninstall-opencode
```

Labels appear as `oc·projectname` in the dashboard.

### 2. SSE Watcher (always-on, daemon-native)

The daemon can subscribe to OpenCode's SSE event stream directly. No external SDK dependency.

```bash
# Start the daemon with OpenCode SSE support
bun run daemon/src/main.ts --opencode-sse-url http://localhost:4096
```

## Session data & debugging

All raw hook events, token snapshots, and session metadata are stored in an SQLite database (`~/.agents-office/agents-office.db` by default).

### Query a session by ID

```bash
# Show all data (raw events, token history, parent/child, logs) for a session
scripts/get-session-data ses_abc123

# Raw hook events only (all JSON payloads since plugin connected)
sqlite3 ~/.agents-office/agents-office.db \
  "SELECT ts, hook_event, payload FROM raw_events WHERE session_id = 'ses_abc123' ORDER BY ts;"

# Token snapshots with percentages
sqlite3 ~/.agents-office/agents-office.db \
  "SELECT ts, cumul_input, cumul_output, ROUND(context_pct * 100, 1) AS context_pct
   FROM token_snapshots WHERE session_id = 'ses_abc123' ORDER BY ts;"

# Session summary with model name and cost
sqlite3 -header -column ~/.agents-office/agents-office.db \
  "SELECT source, model_name, input_tokens, output_tokens, tool_call_count, active_ms
   FROM sessions WHERE session_id = 'ses_abc123';"
```

### What's stored

| Table | Contents | Retention |
|-------|----------|-----------|
| `sessions` | Summary per session (tokens, cost, model, parent, timing) | Session lifetime |
| `token_snapshots` | Token state at each `TokenUpdate` event | Session lifetime |
| `raw_events` | Every raw hook payload as received (full JSON) | Session lifetime |
| `tags` | User-applied tags for session comparison | Until removed |

### Scripts

```bash
scripts/get-session-data <session-id>    # Full session data dump
scripts/get-logs-by-session-id <session-id>  # Daemon + plugin log grep
scripts/preflight.sh                      # Run tests + web build
```

The `model_name` field on sessions is populated automatically when OpenCode's plugin discovers the model (via `message.updated` → `ModelUpdate` hook event). Claude Code subagents get model info from their parent session.

## License

MIT
