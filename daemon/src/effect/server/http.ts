import { Effect, Fiber, Queue, Ref, Stream, Schedule } from "effect"
import { Schema } from "@effect/schema"
import { WireScene } from "../schemas/wire-protocol"
import { AgentsOfficeConfig } from "../services/config"
import type { AgentEvent } from "../schemas/agent-event"
import { applyEvent, createInitialState, createMeta, tick, ReducerState, ReducerMeta, sweepExited } from "../state/reducer"

export function makeDaemon() {
  return Effect.gen(function* () {
    const config = yield* AgentsOfficeConfig

    const eventQueue = yield* Queue.unbounded<readonly [AgentEvent, string]>()
    const stateRef = yield* Ref.make(createInitialState(config.maxDesks))
    const metaRef = yield* Ref.make(createMeta())

    // Event processing loop
    yield* Effect.forkScoped(
      Stream.fromQueue(eventQueue).pipe(
        Stream.runForEach(([event, transport]) =>
          Ref.update(stateRef, (s) => {
            const meta = createMeta()
            const next = applyEvent(s, meta, event as any, Date.now(), transport)
            s.nextLabelN = next.nextLabelN
            return next
          }),
        ),
      ),
    )

    // Tick loop (GC, sweep, expire)
    yield* Effect.forkScoped(
      Effect.repeat(
        Effect.gen(function* () {
          const now = Date.now()
          yield* Ref.update(stateRef, (s) => { tick(s, createMeta(), now); return s })
        }),
        Schedule.spaced(1000),
      ),
    )

    // WebSocket clients
    const clients = new Set<WebSocket>()

    // HTTP server
    const server = Bun.serve({
      port: config.port,
      websocket: {
        open(ws) { clients.add(ws) },
        close(ws) { clients.delete(ws) },
        message() {},
      },
      fetch(req, server) {
        const url = new URL(req.url)

        // WebSocket upgrade
        if (url.pathname === "/ws") {
          const success = server.upgrade(req)
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
    yield* Effect.forkScoped(
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

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => { server.stop() })
    )

    console.log(`daemon running on http://localhost:${config.port}`)

    return { eventQueue, stateRef, metaRef, server, clients }
  }).pipe(Effect.scoped)
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
