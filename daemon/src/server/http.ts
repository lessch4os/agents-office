import fs from "fs"
import { Either, HashMap, Stream, Effect } from "effect"
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
import { makeJsonlWatcherSource } from "../sources/jsonl-watcher"
import { decodeCcLine, ccSessionEnded, ccDeriveLabel } from "../decoders/cc-jsonl"
import { toolDetailDisplay, toolDetailToolName } from "../schemas/agent-event"
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

export function makeDaemon(cfg: {
  port: number; socket: string; db: string; maxDesks: number; webRoot: string | undefined;
  password: string | undefined;
}) {
  const { db } = createDb(cfg.db)
  try { seedPricing(db) } catch (e) { log.warn("seedPricing failed", { error: String(e) }) }

  let state = createInitialState(cfg.maxDesks)
  const eventBuf: Array<readonly [AgentEvent, string]> = []

  // Tool start tracking for activity log duration_ms
  const toolStartInfo = new Map<string, { ts: number; toolName?: string; detail?: string }>()
  function broadcastLogEntry(entry: {
    agent_id: number; timestamp_ms: number; tool_name: string | null;
    detail: string; log_type: string; truncated: boolean;
    tool_input?: string; duration_ms?: number;
  }): void {
    const msg = JSON.stringify({ type: "log", data: entry })
    for (const ws of clients) {
      try { ws.send(msg) } catch { clients.delete(ws) }
    }
  }

  // Hook socket — receive events from hook shim + OC plugin
  const hookServer = startHookSocket(cfg.socket, (event, transport) => {
    eventBuf.push([event, transport])
  }, (parsed, raw) => {
    try {
      const sid = (parsed.session_id as string) ?? null
      db.insert(rawEvents).values({
        ts: Date.now(), sessionId: sid, transport: "hook", payload: raw,
      }).run()
    } catch {}
  })
  log.warn("hook socket started", { socket: cfg.socket })

  // JSONL watcher — reads CC transcript files for token data (hooks don't carry usage)
  const ccRoot = `${process.env.HOME}/.claude/projects`
  try {
    if (fs.existsSync(ccRoot)) {
      Effect.runPromise(
        Effect.gen(function* () {
          const source = yield* makeJsonlWatcherSource(ccRoot, "claude-code", decodeCcLine, ccDeriveLabel, ccSessionEnded)
          yield* Stream.runForEach(source.events, ([ev, transport]) =>
            Effect.sync(() => { eventBuf.push([ev, transport]) }),
          )
        }),
      ).catch((e) => log.warn("jsonl watcher failed", { error: String(e) }))
      log.warn("jsonl watcher started", { root: ccRoot })
    } else {
      log.warn("jsonl watcher skipped — no CC projects dir", { root: ccRoot })
    }
  } catch (e) {
    log.warn("jsonl watcher init failed", { error: String(e) })
  }

  // Event processing — non-blocking, reads from eventBuf via polling
  const processInterval = setInterval(() => {
    while (eventBuf.length > 0) {
      const [event, transport] = eventBuf.shift()!
      const meta = createMeta()
      const now = Date.now()

      // Auto-create session for orphaned token events (e.g. OpenCode plugin
      // reconnected after daemon restart — sessionStart was in previous run)
      if (event.type === "tokenUsage" || event.type === "activityStart") {
        const key = String(event.agentId)
        const slotOpt = HashMap.get(state.agents, key)
        if (slotOpt._tag === "None") {
          const syntheticSid = `auto-${event.agentId.toString(16)}`
          const startEvent: AgentEvent = {
            type: "sessionStart", agentId: event.agentId,
            source: transport, sessionId: syntheticSid, cwd: "",
          }
          state = applyEvent(state, meta, startEvent as any, now, transport)
          try {
            db.insert(sessions).values({
              sessionId: syntheticSid, source: transport, label: "",
              cwd: "", agentType: null, contextWindowLimit: 200000, startedAt: now,
            }).onConflictDoUpdate({
              target: sessions.sessionId,
              set: { label: sql`excluded.label`, source: sql`excluded.source` },
            }).run()
          } catch (e) {
            log.warn("db persist error", { error: String(e) })
          }
        }
      }

      state = applyEvent(state, meta, event as any, now, transport)

      try {
        if (event.type === "sessionStart") {
          db.insert(sessions).values({
            sessionId: event.sessionId,
            parentSessionId: (event as any).parentSessionId ?? null,
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
          const sid = getSessionId(state, event.agentId)
          if (sid) {
            db.update(sessions).set({ label: event.label }).where(eq(sessions.sessionId, sid)).run()
          }
        }
        if (event.type === "tokenUsage") {
          const sid = getSessionId(state, event.agentId)
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
          const sid = getSessionId(state, event.agentId)
          if (sid) {
            db.update(sessions).set({ endedAt: now }).where(eq(sessions.sessionId, sid)).run()
          }
        }
      } catch (e) {
        log.warn("db persist error", { error: String(e) })
      }

      // Broadcast activity log entries to WebSocket clients
      switch (event.type) {
        case "activityStart": {
          if (event.toolUseId) {
            toolStartInfo.set(event.toolUseId, {
              ts: now,
              toolName: event.detail ? toolDetailToolName(event.detail) ?? undefined : undefined,
              detail: event.detail ? toolDetailDisplay(event.detail) : event.activity,
            })
          }
          broadcastLogEntry({
            agent_id: event.agentId,
            timestamp_ms: now,
            tool_name: event.detail ? toolDetailToolName(event.detail) ?? null : null,
            detail: event.detail ? toolDetailDisplay(event.detail) : event.activity,
            log_type: event.activity === "typing" ? "tool_start" : "thought",
            truncated: false,
          })
          break
        }
        case "activityEnd": {
          const info = event.toolUseId ? toolStartInfo.get(event.toolUseId) : undefined
          broadcastLogEntry({
            agent_id: event.agentId,
            timestamp_ms: now,
            tool_name: info?.toolName ?? null,
            detail: info?.detail ?? "",
            log_type: "tool_result",
            truncated: false,
            duration_ms: info ? now - info.ts : undefined,
          })
          if (event.toolUseId) toolStartInfo.delete(event.toolUseId)
          break
        }
        case "waiting": {
          broadcastLogEntry({
            agent_id: event.agentId,
            timestamp_ms: now,
            tool_name: null,
            detail: event.reason,
            log_type: "waiting",
            truncated: false,
          })
          break
        }
      }
    }
  }, 100)

  // Tick loop (GC, sweep, expire)
  setInterval(() => {
    const now = Date.now()
    tick(state, createMeta(), now)
  }, 1000)

  // WebSocket clients (frontend)
  const clients = new Set<WebSocket>()
  // Hook connection clients (forwarders)
  const hookConns = new Set<WebSocket>()
  // Cached scene state for synchronous API access
  let cachedSceneJson = JSON.stringify({ type: "scene", data: { agents: {}, max_desks: cfg.maxDesks, now_ms: Date.now() } })
  let cachedSceneWire = { agents: {}, max_desks: cfg.maxDesks, now_ms: Date.now() }

  const server = Bun.serve({
    port: cfg.port,
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

        try {
          const sid = (parsed.session_id as string) ?? null
          db.insert(rawEvents).values({
            ts: Date.now(), sessionId: sid, transport: "remote-hook", payload: msg as string,
          }).run()
        } catch {}

        const result = decodeHookPayload(parsed, hashAgentId)
        if (Either.isRight(result)) {
          for (const ev of result.right.events) {
            eventBuf.push([ev, "remote-hook"])
          }
        }
      },
    },
    async fetch(req, server) {
      const url = new URL(req.url)

      if (url.pathname === "/ws") {
        const success = server.upgrade(req)
        if (success) return new Response(null, { status: 101 })
        return new Response("WebSocket upgrade failed", { status: 400 })
      }

      if (url.pathname === "/hook") {
        const expected = cfg.password
        const pw = url.searchParams.get("password")
        if (!expected || !pw || expected !== pw) {
          return new Response("unauthorized", { status: 401 })
        }
        const success = server.upgrade(req, { data: { type: "hook" } })
        if (success) return new Response(null, { status: 101 })
        return new Response("WebSocket upgrade failed", { status: 400 })
      }

      if (url.pathname === "/api/scene" && req.method === "GET") {
        return json(cachedSceneWire)
      }

      if (url.pathname.startsWith("/api/sessions")) {
        return await handleSessionsApi(url, req, db)
      }

      if (url.pathname.startsWith("/api/pricing")) {
        return await handlePricingApi(url, req, db)
      }

      if (url.pathname === "/health") {
        return json({ ok: true })
      }

      if (cfg.webRoot) {
        const filePath = url.pathname === "/" ? "/index.html" : url.pathname
        const filePathAbs = cfg.webRoot + filePath
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
  setInterval(() => {
    const wire = sceneStateToWire(state, Date.now())
    cachedSceneWire = wire
    cachedSceneJson = JSON.stringify({ type: "scene", data: wire })
    if (clients.size === 0) return
    for (const ws of clients) {
      try { ws.send(cachedSceneJson) } catch { clients.delete(ws) }
    }
  }, 1000)

  log.warn("daemon running", { port: cfg.port })

  return { state, server, clients, hookServer, processInterval }
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
