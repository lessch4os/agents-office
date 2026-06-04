import { Database } from "bun:sqlite"
import { Effect, Either, Fiber, HashMap, Queue, Redacted, Ref, Stream, Schedule } from "effect"
import { Schema } from "@effect/schema"
import { WireScene } from "../schemas/wire-protocol"
import { AgentsOfficeConfig } from "../services/config"
import type { AgentEvent } from "../schemas/agent-event"
import { hashAgentId } from "../schemas/agent-id"
import { decodeHookPayload } from "../decoders/hook-decoder"
import { applyEvent, createInitialState, createMeta, tick, ReducerState, ReducerMeta, sweepExited } from "../state/reducer"

function getSessionId(state: ReducerState, agentId: number): string | undefined {
  const key = String(agentId)
  const opt = HashMap.get(state.agents, key)
  return opt._tag === "Some" ? opt.value.sessionId : undefined
}

function initDb(dbPath: string): Database {
  const db = new Database(dbPath)
  db.run(`CREATE TABLE IF NOT EXISTS sessions (
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
    model_name TEXT
  )`)
  db.run(`CREATE TABLE IF NOT EXISTS raw_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL, session_id TEXT,
    transport TEXT, payload TEXT NOT NULL
  )`)
  db.run(`CREATE TABLE IF NOT EXISTS token_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL, ts INTEGER NOT NULL,
    cumul_input INTEGER NOT NULL DEFAULT 0,
    cumul_output INTEGER NOT NULL DEFAULT 0,
    context_pct REAL NOT NULL DEFAULT 0.0
  )`)
  return db
}

export function makeDaemon() {
  return Effect.gen(function* () {
    const config = yield* AgentsOfficeConfig

    const db = initDb(config.db)
    const storeRaw = db.prepare("INSERT INTO raw_events (ts, session_id, transport, payload) VALUES (?, ?, ?, ?)")
    const upsertSession = db.prepare(`INSERT INTO sessions (session_id, source, label, cwd, agent_type, context_window_limit, started_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET label = excluded.label, source = excluded.source`)
    const updateTokens = db.prepare("UPDATE sessions SET input_tokens = input_tokens + ?, output_tokens = output_tokens + ?, cache_read_tokens = cache_read_tokens + ? WHERE session_id = ?")
    const updateTokensCumulative = db.prepare("UPDATE sessions SET input_tokens = ?, output_tokens = ?, cache_read_tokens = ? WHERE session_id = ?")
    const endSessionStmt = db.prepare("UPDATE sessions SET ended_at = ? WHERE session_id = ?")
    const insertTokenSnapshot = db.prepare("INSERT INTO token_snapshots (session_id, ts, cumul_input, cumul_output, context_pct) VALUES (?, ?, ?, ?, ?)")

    const eventQueue = yield* Queue.unbounded<readonly [AgentEvent, string]>()
    const stateRef = yield* Ref.make(createInitialState(config.maxDesks))
    const metaRef = yield* Ref.make(createMeta())

    // Event processing loop with DB persistence
    yield* Effect.fork(
      Stream.fromQueue(eventQueue).pipe(
        Stream.runForEach(([event, transport]) =>
          Ref.update(stateRef, (s) => {
            const meta = createMeta()
            const now = Date.now()
            const next = applyEvent(s, meta, event as any, now, transport)
            s.nextLabelN = next.nextLabelN

            // Persist to DB
            try {
              if (event.type === "sessionStart") {
                upsertSession.run(
                  event.sessionId, event.source, "", event.cwd,
                  event.agentType ?? null, event.contextWindowLimit ?? 200000, now,
                )
              }
              if (event.type === "rename") {
                const sid = getSessionId(s, event.agentId)
                if (sid) db.run("UPDATE sessions SET label = ? WHERE session_id = ?", event.label, sid)
              }
              if (event.type === "tokenUsage") {
                const sid = getSessionId(s, event.agentId)
                if (sid) {
                  if (event.cumulative) {
                    updateTokensCumulative.run(event.input, event.output, event.cacheRead ?? 0, sid)
                  } else {
                    updateTokens.run(event.input, event.output, event.cacheRead ?? 0, sid)
                  }
                  if (event.total) {
                    const pct = event.total > 0 ? ((event.input + event.output) / event.total) * 100 : 0
                    insertTokenSnapshot.run(sid, now, event.input, event.output, pct)
                  }
                }
              }
              if (event.type === "sessionEnd") {
                const sid = getSessionId(s, event.agentId)
                if (sid) endSessionStmt.run(now, sid)
              }
            } catch (e) {
              console.warn("db persist error:", e)
            }

            return next
          }),
        ),
      ),
    )

    // Tick loop (GC, sweep, expire)
    yield* Effect.fork(
      Effect.repeat(
        Effect.gen(function* () {
          const now = Date.now()
          yield* Ref.update(stateRef, (s) => { tick(s, createMeta(), now); return s })
        }),
        Schedule.spaced(1000),
      ),
    )

    // WebSocket clients (frontend)
    const clients = new Set<WebSocket>()
    // Hook connection clients (forwarders)
    const hookConns = new Set<WebSocket>()

    // HTTP server
    const server = Bun.serve({
      port: config.port,
      websocket: {
        open(ws) {
          if ((ws as any).data?.type === "hook") hookConns.add(ws)
          else clients.add(ws)
        },
        close(ws) {
          hookConns.delete(ws)
          clients.delete(ws)
        },
        message(ws, msg) {
          if (!hookConns.has(ws)) return
          let parsed: Record<string, unknown>
          try { parsed = JSON.parse(msg as string) } catch { return }
          if (parsed.type === "ping") {
            try { ws.send(JSON.stringify({ type: "pong" })) } catch {}
            return
          }
          if (parsed.type === "pong") return

          // Store raw event
          try {
            const sid = (parsed.session_id as string) ?? null
            db.insert(rawEvents).values({
              ts: Date.now(), sessionId: sid, transport: "remote-hook", payload: msg as string,
            }).run()
          } catch {}

          const result = decodeHookPayload(parsed, hashAgentId)
          if (Either.isRight(result)) {
            for (const ev of result.right.events) {
              Queue.unsafeOffer(eventQueue, [ev, "remote-hook"])
            }
          }
        },
      },
      fetch(req, server) {
        const url = new URL(req.url)

        // WebSocket upgrade — frontend
        if (url.pathname === "/ws") {
          const success = server.upgrade(req)
          if (success) return new Response(null, { status: 101 })
          return new Response("WebSocket upgrade failed", { status: 400 })
        }

        // WebSocket upgrade — hook forwarder
        if (url.pathname === "/hook") {
          const expected = config.password ? Redacted.value(config.password) : undefined
          const pw = url.searchParams.get("password")
          if (!expected || !pw || expected !== pw) {
            return new Response("unauthorized", { status: 401 })
          }
          const success = server.upgrade(req, { data: { type: "hook" } })
          if (success) return new Response(null, { status: 101 })
          return new Response("WebSocket upgrade failed", { status: 400 })
        }

        // API: /api/scene
        if (url.pathname === "/api/scene" && req.method === "GET") {
          const state = Ref.unsafeGet(stateRef)
          const wire = sceneStateToWire(state, Date.now())
          return new Response(JSON.stringify(wire), {
            headers: { "content-type": "application/json" },
          })
        }

        // Health check
        if (url.pathname === "/health") {
          return new Response(JSON.stringify({ ok: true }), {
            headers: { "content-type": "application/json" },
          })
        }

        // Default: serve static files or 404
        return new Response("Not Found", { status: 404 })
      },
    })

    // Broadcast loop
    yield* Effect.fork(
      Effect.repeat(
        Effect.sync(() => {
          if (clients.size === 0) return
          const state = Ref.unsafeGet(stateRef)
          const wire = sceneStateToWire(state, Date.now())
          const json = JSON.stringify({ type: "scene", data: wire })
          for (const ws of clients) {
            try { ws.send(json) } catch { clients.delete(ws) }
          }
        }),
        Schedule.spaced(1000),
      ),
    )

    console.log(`daemon running on http://localhost:${config.port}`)

    return { eventQueue, stateRef, metaRef, server, clients }
  })
}

function sceneStateToWire(state: ReducerState, nowMs: number): any {
  const agents: Record<string, any> = {}
  for (const [key, slot] of state.agents) {
    agents[key] = slotToWire(slot)
  }
  return { agents, max_desks: state.maxDesks, now_ms: nowMs }
}

function slotToWire(slot: any): any {
  const state: any = slot.state.type === "idle" ? { type: "Idle" }
    : slot.state.type === "active" ? { type: "Active", activity: slot.state.activity, tool_use_id: slot.state.toolUseId ?? null, detail: slot.state.detail ?? null }
    : { type: "Waiting", reason: slot.state.reason }

  return {
    agent_id: slot.agentId,
    source: slot.source,
    session_id: slot.sessionId,
    cwd: slot.cwd,
    label: slot.label,
    origin: slot.origin,
    machine_name: slot.machineName ?? null,
    state,
    state_started_at_ms: slot.stateStartedAt,
    last_event_at_ms: slot.lastEventAt,
    created_at_ms: slot.createdAt,
    exiting_at_ms: slot.exitingAt ?? null,
    desk_index: slot.deskIndex,
    tool_call_count: slot.toolCallCount,
    active_ms: slot.activeMs,
    parent_id: slot.parentId ?? null,
    current_tool: slot.currentTool ?? null,
    agent_type: slot.agentType ?? null,
    session_total_tokens: slot.sessionTotalTokens,
    context_total_tokens: slot.contextTotalTokens,
    context_input_tokens: slot.contextInputTokens,
    token_input_total: slot.tokenInputTotal,
    token_output_total: slot.tokenOutputTotal,
    cache_read_tokens: slot.cacheReadTokens,
    context_window_limit: slot.contextWindowLimit,
    model_name: slot.modelName ?? null,
    completed_children: slot.completedChildren.map((c: any) => ({
      agent_id: c.agentId, label: c.label, agent_type: c.agentType,
      tool_call_count: c.toolCallCount, active_ms: c.activeMs,
      token_input_total: c.tokenInputTotal, token_output_total: c.tokenOutputTotal,
      cache_read_tokens: c.cacheReadTokens, model_name: c.modelName,
    })),
  }
}
