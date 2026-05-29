# CLAUDE.md

Instructions for Claude Code (or any AI coding agent) working in this repo.

## What this is

A Bun/TypeScript daemon + React web frontend that visualizes AI coding agent sessions. Each running CC (Claude Code) or Antigravity session shows up as an animated agent on a web-based office dashboard.

Architecture overview: [`README.md`](README.md).

## Layout

```
package.json           Root workspace config — bun install installs all workspaces

daemon/              Bun daemon process + hook shim + OC plugin
├── src/
│   ├── main.ts          Entry point (local mode only — relay/server removed)
│   ├── emitter.ts       EmitManager: emit/broadcast/tick extracted from main
│   ├── types.ts         AgentEvent, Activity, ToolDetail (discriminated unions)
│   ├── agent-id.ts      FNV-1a 64-bit AgentId (BigInt → Number for wire)
│   ├── state.ts         SceneState, AgentSlot, ActivityState
│   ├── wire.ts          SceneState → WireScene JSON conversion
│   ├── decoder.ts       Hook payload decoder + shared utilities + toolTargetKey registry
│   ├── claude-code.ts   CC JSONL decoder + label deriver
│   ├── antigravity.ts   AG JSONL decoder + label deriver
│   ├── hook-socket.ts   Unix socket listener (net.createServer)
│   ├── jsonl-watcher.ts JSONL file watcher (fs.watch + cursor tracking)
│   ├── reducer.ts       State machine (dedup, debounce, GC, cascade)
│   ├── opencode-sse.ts        OC SSE watcher (always-on, daemon-native)
│   ├── opencode-sse-decoder.ts OC SSE event decoder
│   ├── opencode-plugin.ts     Plugin source (built separately for OC plugin system)
│   ├── hook-shim.ts           CC hook shim source (built as standalone binary)
│   ├── session-store.ts  SQLite session persistence
│   ├── pricing.ts        Model pricing + context window limits
│   ├── logger.ts         Logger interface + file appender
│   └── agent-id.ts       FNV-1a 64-bit AgentId
├── agents-office-hook    Compiled hook binary (build artifact)
├── agents-office         Compiled daemon binary (build:daemon output)
├── agents-office-forwarder  Compiled forwarder binary (build:forwarder output)
├── dist/                Compiled plugin JS (build:plugin output)
├── package.json         Workspace: "agents-office-daemon"
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
├── get-session-data               SQLite + log dump for a session ID
└── get-logs-by-session-id         Grep daemon + plugin logs for a session ID

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
- **macOS first.** BSD-flavored CLI, brew, launchd. The hook shim is Unix-socket specific.
- **Keep docs current.** Update README.md and CLAUDE.md when module structure or public API changes.

## Architecture invariants

1. **Events flow through ONE typed handler** `EventHandler = (transport: Transport, event: AgentEvent) => void`. The `Transport` tag is load-bearing — the reducer uses it for hook-wins dedup.
2. **Each source (CC, AG, OC) owns its own decoder and label deriver**. CC and AG use `JsonlWatcher` with injected fn pointers. OC has an SSE watcher (`opencode-sse.ts`) and a plugin (`opencode-plugin.ts`). The plugin speaks the CC hook protocol and reuses `decoder.ts`.
3. **The hook shim must never block CC.** Always exit 0 silently on any error. 200ms write timeout is non-negotiable.
4. **Bun daemon has no terminal dependencies.** It's a headless HTTP/WS server.
5. **Wire protocol is snake_case** matching `web/src/types.ts`. `WireActivityState` uses capitalized type discriminators (`"Idle"`, `"Active"`, `"Waiting"`).
6. **AgentId** uses FNV-1a 64-bit hashing with BigInt for exact u64 arithmetic, converted to Number for the wire protocol.
7. **`VERSION` constant in `main.ts` and `forwarder.ts`** must match `package.json` version. The compiled `--version` flag reads this constant.
8. **`Formula/agents-office.rb`** must stay in sync with the build process. If build steps or binary names change, update the formula. Tag `v{VERSION}` must exist before brew users can install.

## Known sharp edges

- **CC hook payloads DO include `tool_use_id`** in `PreToolUse` and `PostToolUse`. The decoder reads it; the reducer's hook-wins dedup actually fires.
- **Bun.connect with `{ unix: path }` is not supported in older Bun** for Unix sockets. Use `net.createConnection(path)` from Node.js `net` module instead.
- **CC hook `transcript_path` always points to the PARENT'S transcript**, even when a subagent is the actor — so subagent hook events hash to the parent's `AgentId`. The reducer suppresses hook events while a `Task` tool is in flight; JSONL has correct subagent attribution via per-subagent transcript files.
- **JSONL watcher skips historical transcripts on startup.** Only files modified in the last hour emit `SessionStart` on initial scan.
- **Subagent display names come from `attributionAgent` in JSONL.** The decoder strips the plugin prefix.
- **`ActivityState::Active` ≠ "tool is currently executing".** The reducer uses a 1500ms debounce (`ACTIVE_GRACE_WINDOW`) before transitioning to Idle.

## Things NOT to do

- Don't add `ratatui` / `crossterm` / terminal dependencies. The TUI was replaced by the web frontend.
- Don't write `Bun.connect({ unix: path })` — use `net.createConnection(path)` instead.
- Don't add `println!` / `eprintln!` to production paths. Use `console.log` / `console.warn`.
- Don't relax the hook shim's "always exit 0" contract. Blocking CC = breaking the user's primary workflow.
- Don't generate README / CLAUDE.md / docs in PRs unless explicitly asked.
- Don't `git push` without explicit user confirmation.

## Session debugging

All raw hook events are stored in SQLite (`~/.agents-office/agents-office.db`). Use the query script:

```bash
scripts/get-session-data <session-id>   # Full dump: raw events, tokens, parent/child, logs
scripts/get-logs-by-session-id <session-id>  # Daemon + plugin text logs
```

Tables:
- `sessions` — summary per session (model, tokens, cost, parent, timing)
- `token_snapshots` — token state at each `TokenUpdate` (cumul_input, cumul_output, context_pct)
- `raw_events` — EVERY raw hook payload as received (full JSON, queryable by session_id)

Raw events are stored in `hook-socket.ts` before decoding via `storeRawEvent()`.

## Where to look

- "How does a CC tool call become a moving agent?" → `main.ts` `emit()` → `reducer.ts` `apply()` → `wire.ts` `sceneToWire()` → WebSocket broadcast → `web/src/ws.ts` → `OfficePixi.tsx` canvas render.
- "How does multi-source decoding work?" → Each source (CC in `claude-code.ts`, AG in `antigravity.ts`) has its own `decode*Line` + `derive*Label` functions, injected into `JsonlWatcher` via fn pointers.
- "How do hooks get installed?" → `bun run install-hooks`. Writes hook entries into `~/.claude/settings.json`.
- "Why don't old idle sessions show on startup?" → `jsonl-watcher.ts` `initialSeedWalk` checks mtime and only emits `SessionStart` for files within the 1-hour window.
- "How does the hook shim work?" → `daemon/src/hook-shim.ts` reads stdin as JSON, connects to the daemon's Unix socket via `net.createConnection`, writes the payload, and exits 0.
- "How does OpenCode integration work?" → Two paths: (a) SSE watcher in `opencode-sse.ts` polls OC server natively, (b) OC plugin in `opencode-plugin.ts` hooks into OC's event system and sends CC-format hook events to the Unix socket.
