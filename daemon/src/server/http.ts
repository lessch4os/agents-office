import { Effect, Either, HashMap, Queue, Redacted, Ref, Stream, Schedule } from "effect"
import { AgentsOfficeConfig } from "../services/config"
import type { AgentEvent } from "../schemas/agent-event"
import { hashAgentId } from "../schemas/agent-id"
import { decodeHookPayload } from "../decoders/hook-decoder"
import { applyEvent, createInitialState, createMeta, tick, ReducerState } from "../state/reducer"
import { createDb, type Db } from "../db"
import { sessions, rawEvents, tokenSnapshots, modelPricing } from "../db/schema"
import { eq, sql, desc, isNull } from "drizzle-orm"
import { seedPricing, resetPricingToDefaults } from "../services/pricing"
import { addTag, removeTag } from "../services/session-store"
import { startHookSocket } from "../sources/hook-socket"
import { getLogger } from "../services/logger"

const log = getLogger()

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function getSessionId(state: ReducerState, agentId: number): string | undefined {
  const key = String(agentId)
  const opt = HashMap.get(state.agents, key)
  return opt._tag === "Some" ? opt.value.sessionId : undefined
}

export function makeDaemon() {
  return Effect.gen(function* () {
    const config = yield* AgentsOfficeConfig

    const { db } = createDb(config.db)
    try { seedPricing(db) } catch (e) { log.warn("seedPricing failed", { error: String(e) }) }

    const eventQueue = yield* Queue.unbounded<readonly [AgentEvent, string]>()
    const stateRef = yield* Ref.make(createInitialState(config.maxDesks))
    const metaRef = yield* Ref.make(createMeta())

    // Hook socket — receive events from hook shim + OC plugin
    const hookServer = startHookSocket(config.socket, (event, transport) => {
      Queue.unsafeOffer(eventQueue, [event, transport])
    })
    log.info("hook socket started", { socket: config.socket })

    // Event processing loop with DB persistence
    yield* Effect.forkDaemon(
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
                db.insert(sessions).values({
                  sessionId: event.sessionId,
                  source: event.source,
                  label: "",
                  cwd: event.cwd,
                  agentType: event.agentType ?? null,
                  contextWindowLimit: event.contextWindowLimit ?? 200000,
                  startedAt: now,
                }).onConflictDoUpdate({
                  target: sessions.sessionId,
                  set: { label: sql`excluded.label`, source: sql`excluded.source` },
                }).run()
              }
              if (event.type === "rename") {
                const sid = getSessionId(s, event.agentId)
                if (sid) {
                  db.update(sessions).set({ label: event.label }).where(eq(sessions.sessionId, sid)).run()
                }
              }
              if (event.type === "tokenUsage") {
                const sid = getSessionId(s, event.agentId)
                if (sid) {
                  if (event.cumulative) {
                    db.update(sessions).set({
                      inputTokens: event.input,
                      outputTokens: event.output,
                      cacheReadTokens: event.cacheRead ?? 0,
                    }).where(eq(sessions.sessionId, sid)).run()
                  } else {
                    db.update(sessions).set({
                      inputTokens: sql`input_tokens + ${event.input}`,
                      outputTokens: sql`output_tokens + ${event.output}`,
                      cacheReadTokens: sql`cache_read_tokens + ${event.cacheRead ?? 0}`,
                    }).where(eq(sessions.sessionId, sid)).run()
                  }
                  if (event.total) {
                    const pct = event.total > 0 ? ((event.input + event.output) / event.total) * 100 : 0
                    db.insert(tokenSnapshots).values({
                      sessionId: sid, ts: now,
                      cumulInput: event.input, cumulOutput: event.output, contextPct: pct,
                    }).run()
                  }
                }
              }
              if (event.type === "sessionEnd") {
                const sid = getSessionId(s, event.agentId)
                if (sid) {
                  db.update(sessions).set({ endedAt: now }).where(eq(sessions.sessionId, sid)).run()
                }
              }
            } catch (e) {
              log.warn("db persist error", { error: String(e) })
            }

            return next
          }),
        ),
      ),
    )

    // Tick loop (GC, sweep, expire)
    yield* Effect.forkDaemon(
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
    // Cached scene state for synchronous API access
    let cachedSceneJson = JSON.stringify({ type: "scene", data: { agents: {}, max_desks: config.maxDesks, now_ms: Date.now() } })
    let cachedSceneWire = { agents: {}, max_desks: config.maxDesks, now_ms: Date.now() }

    const server = Bun.serve({
      port: config.port,
      websocket: {
        open(ws) {
          if ((ws as any).data?.type === "hook") hookConns.add(ws)
          else {
            clients.add(ws)
            try { ws.send(cachedSceneJson) } catch {}
          }
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
      async fetch(req, server) {
        const url = new URL(req.url)

        // WebSocket upgrade — frontend (must be sync, before any await)
        if (url.pathname === "/ws") {
          const success = server.upgrade(req)
          if (success) return new Response(null, { status: 101 })
          return new Response("WebSocket upgrade failed", { status: 400 })
        }

        // WebSocket upgrade — hook forwarder (must be sync)
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
          return new Response(JSON.stringify(cachedSceneWire), {
            headers: { "content-type": "application/json" },
          })
        }

        // API: /api/sessions/**
        if (url.pathname.startsWith("/api/sessions")) {
          return await handleSessionsApi(url, req, db)
        }

        // API: /api/pricing/**
        if (url.pathname.startsWith("/api/pricing")) {
          return await handlePricingApi(url, req, db)
        }

        // Health check
        if (url.pathname === "/health") {
          return new Response(JSON.stringify({ ok: true }), {
            headers: { "content-type": "application/json" },
          })
        }

        // Default: serve static files from webRoot or 404
        if (config.webRoot) {
          const filePath = url.pathname === "/" ? "/index.html" : url.pathname
          const filePathAbs = config.webRoot + filePath
          try {
            const file = Bun.file(filePathAbs)
            const stat = file.size
            if (stat > 0 || filePathAbs.endsWith("/index.html")) return new Response(file)
          } catch {}
        }
        return new Response("Not Found", { status: 404 })
      },
    })

    // Broadcast loop
    yield* Effect.forkDaemon(
      Effect.repeat(
        Effect.gen(function* () {
          const state = yield* Ref.get(stateRef)
          const wire = sceneStateToWire(state, Date.now())
          cachedSceneWire = wire
          cachedSceneJson = JSON.stringify({ type: "scene", data: wire })
          if (clients.size === 0) return
          for (const ws of clients) {
            try { ws.send(cachedSceneJson) } catch { clients.delete(ws) }
          }
        }),
        Schedule.spaced(1000),
      ),
    )

      log.info(`daemon running on http://localhost:${config.port}`, { port: config.port })

    return { eventQueue, stateRef, metaRef, server, clients, hookServer }
  })
}

// ── Sessions API ───────────────────────────────────────────────────

async function handleSessionsApi(url: URL, req: Request, db: Db): Promise<Response> {
  const p = url.pathname
  const method = req.method

  // GET /api/sessions/compare?a=&b=
  if (method === "GET" && p === "/api/sessions/compare") {
    const a = url.searchParams.get("a")
    const b = url.searchParams.get("b")
    if (!a || !b) return json({ error: "a and b required" }, 400)
    const sa = getSessionDetail(db, a)
    const sb = getSessionDetail(db, b)
    if (!sa || !sb) return json({ error: "session not found" }, 404)
    return json({
      a: sa, b: sb,
      diff: {
        cost_usd: sa.cost_usd - sb.cost_usd,
        input_tokens: sa.input_tokens - sb.input_tokens,
        output_tokens: sa.output_tokens - sb.output_tokens,
        cache_read_tokens: sa.cache_read_tokens - sb.cache_read_tokens,
        cache_hit_rate_delta: sa.cache_hit_rate - sb.cache_hit_rate,
        tool_call_count: sa.tool_call_count - sb.tool_call_count,
        active_ms: sa.active_ms - sb.active_ms,
        total_cost_usd: sa.total_cost_usd - sb.total_cost_usd,
      },
    })
  }

  // POST /api/sessions/:id/tag  body: { tag: string }
  if (method === "POST" && p.endsWith("/tag")) {
    const id = p.slice("/api/sessions/".length, -"/tag".length)
    if (!id) return json({ error: "invalid path" }, 400)
    let body: any
    try { body = await req.json() } catch { return json({ error: "invalid json" }, 400) }
    if (typeof body.tag !== "string") return json({ error: "tag must be string" }, 400)
    addTag(db, id, body.tag)
    return json({ ok: true })
  }

  // DELETE /api/sessions/:id/tag/:name
  const tagMatch = p.match(/^\/api\/sessions\/(.+)\/tag\/(.+)$/)
  if (method === "DELETE" && tagMatch) {
    removeTag(db, tagMatch[1], tagMatch[2])
    return json({ ok: true })
  }

  // GET /api/sessions/:id
  const idMatch = p.match(/^\/api\/sessions\/([^/]+)$/)
  if (method === "GET" && idMatch) {
    const detail = getSessionDetail(db, idMatch[1])
    if (!detail) return json({ error: "not found" }, 404)
    return json(detail)
  }

  // GET /api/sessions
  if (method === "GET" && p === "/api/sessions") {
    const limit = Math.min(200, parseInt(url.searchParams.get("limit") ?? "50", 10))
    const offset = parseInt(url.searchParams.get("offset") ?? "0", 10)
    const tag = url.searchParams.get("tag")
    const source = url.searchParams.get("source")
    let query = db.select().from(sessions).orderBy(desc(sessions.startedAt)).limit(limit).offset(offset)
    if (source) {
      query = db.select().from(sessions).where(eq(sessions.source, source)).orderBy(desc(sessions.startedAt)).limit(limit).offset(offset) as any
    }
    const rows = query.all() as any[]
    let filtered = rows.map(rowToSummary)
    if (tag) {
      filtered = filtered.filter((r: any) => r.tags.includes(tag))
    }
    return json(filtered)
  }

  return json({ error: "not found" }, 404)
}

function safeNum(row: any, camel: string, snake: string, fallback = 0): number {
  const v = row[camel]
  if (typeof v === "number" && !Number.isNaN(v)) return v
  if (row[snake] != null) {
    const n = Number(row[snake])
    if (!Number.isNaN(n)) return n
  }
  return fallback
}

function safeStr(row: any, camel: string, snake: string, fallback: string | null = null): string | null {
  const v = row[camel]
  if (typeof v === "string" && v !== snake) return v
  if (row[snake] != null && typeof row[snake] === "string") return String(row[snake])
  return fallback
}

function rowToSummary(row: any): any {
  const tags: string[] = JSON.parse(row.tags ?? row.tags ?? "[]")
  return {
    session_id: safeStr(row, "sessionId", "session_id") ?? "",
    parent_session_id: safeStr(row, "parentSessionId", "parent_session_id"),
    source: safeStr(row, "source", "source") ?? "",
    label: safeStr(row, "label", "label") ?? "",
    cwd: safeStr(row, "cwd", "cwd") ?? "",
    agent_type: safeStr(row, "agentType", "agent_type"),
    context_window_limit: safeNum(row, "contextWindowLimit", "context_window_limit"),
    started_at: safeNum(row, "startedAt", "started_at"),
    ended_at: safeNum(row, "endedAt", "ended_at"),
    input_tokens: safeNum(row, "inputTokens", "input_tokens"),
    output_tokens: safeNum(row, "outputTokens", "output_tokens"),
    cache_read_tokens: safeNum(row, "cacheReadTokens", "cache_read_tokens"),
    tool_call_count: safeNum(row, "toolCallCount", "tool_call_count"),
    active_ms: safeNum(row, "activeMs", "active_ms"),
    cost_usd: safeNum(row, "costUsd", "cost_usd", 0),
    cache_hit_rate: safeNum(row, "cacheHitRate", "cache_hit_rate", 0),
    tags,
    model_name: safeStr(row, "modelName", "model_name"),
  }
}

function getSessionDetail(db: Db, id: string): any | null {
  const row = db.select().from(sessions).where(eq(sessions.sessionId, id)).get()
  if (!row) return null
  const summary = rowToSummary(row)
  const snapshots = db.select().from(tokenSnapshots).where(eq(tokenSnapshots.sessionId, id)).orderBy(tokenSnapshots.ts).all() as any[]
  const children = db.select().from(sessions).where(eq(sessions.parentSessionId, id)).orderBy(sessions.startedAt).all() as any[]
  const childCost = children.reduce((sum: number, c: any) => sum + c.costUsd, 0)
  return {
    ...summary,
    snapshots: snapshots.map((s: any) => ({
      ts: s.ts, cumul_input: s.cumulInput ?? s.cumul_input, cumul_output: s.cumulOutput ?? s.cumul_output,
      cumul_cache: s.cumulCache ?? s.cumul_cache ?? 0, context_pct: s.contextPct ?? s.context_pct,
    })),
    children: children.map(rowToSummary),
    total_cost_usd: (summary.cost_usd ?? 0) + childCost,
  }
}

// ── Pricing API ────────────────────────────────────────────────────

async function handlePricingApi(url: URL, req: Request, db: Db): Promise<Response> {
  const method = req.method

  // POST /api/pricing/reset
  if (method === "POST" && url.pathname.endsWith("/reset")) {
    resetPricingToDefaults(db)
    return json({ ok: true })
  }

  // PUT /api/pricing  body: { model_name, input_per_m, output_per_m, cache_read_per_m }
  if (method === "PUT") {
    let body: any
    try { body = await req.json() } catch { return json({ error: "invalid json" }, 400) }
    if (typeof body.model_name !== "string" || !body.model_name) return json({ error: "model_name required" }, 400)
    const input = Number(body.input_per_m)
    const output = Number(body.output_per_m)
    const cache = Number(body.cache_read_per_m ?? 0)
    if (!Number.isFinite(input) || !Number.isFinite(output) || !Number.isFinite(cache)) {
      return json({ error: "input_per_m, output_per_m, cache_read_per_m must be numbers" }, 400)
    }
    db.insert(modelPricing).values({
      modelName: body.model_name, inputPerM: input, outputPerM: output, cacheReadPerM: cache, source: "user",
    }).onConflictDoUpdate({
      target: modelPricing.modelName,
      set: { inputPerM: input, outputPerM: output, cacheReadPerM: cache, source: sql`'user'` },
    }).run()
    return json({ ok: true })
  }

  // GET /api/pricing
  if (method === "GET") {
    const rows = db.select().from(modelPricing).all() as any[]
    return json(rows.map((r) => ({
      model_name: r.modelName, input_per_m: r.inputPerM,
      output_per_m: r.outputPerM, cache_read_per_m: r.cacheReadPerM, source: r.source,
    })))
  }

  return json({ error: "not found" }, 404)
}

// ── Scene wire conversion ──────────────────────────────────────────

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
