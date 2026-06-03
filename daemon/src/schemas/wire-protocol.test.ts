import { describe, test, expect } from "bun:test"
import { Schema } from "@effect/schema"
import { WireScene, WireAgent, WireActivityState, WireSessionSummary, WireSessionDetail, WireSessionComparison, WireTokenSnapshot } from "./wire-protocol"

describe("WireActivityState", () => {
  test("Idle", () => {
    const d = Schema.decodeSync(WireActivityState)({ type: "Idle" })
    expect(d).toEqual({ type: "Idle" })
  })

  test("Active", () => {
    const d = Schema.decodeSync(WireActivityState)({
      type: "Active", activity: "typing", tool_use_id: "t1", detail: "edit",
    })
    expect(d.type).toBe("Active")
    expect(d.tool_use_id).toBe("t1")
  })

  test("Waiting", () => {
    const d = Schema.decodeSync(WireActivityState)({ type: "Waiting", reason: "input" })
    expect(d.reason).toBe("input")
  })
})

describe("WireAgent", () => {
  function minimalAgent(): Omit<WireAgent, "completed_children"> {
    return {
      agent_id: 1,
      source: "hook",
      session_id: "s1",
      cwd: "/home",
      label: "agent",
      origin: "local",
      state: { type: "Idle" },
      state_started_at_ms: 1000,
      last_event_at_ms: 1000,
      created_at_ms: 1000,
      desk_index: 0,
      tool_call_count: 3,
      active_ms: 5000,
      session_total_tokens: 0,
      context_total_tokens: 0,
      context_input_tokens: 0,
      token_input_total: 100,
      token_output_total: 50,
      cache_read_tokens: 10,
      context_window_limit: 200000,
      completed_children: [],
    }
  }

  test("minimal agent round-trip", () => {
    const agent = minimalAgent()
    const encoded = Schema.encodeSync(WireAgent)(agent)
    const decoded = Schema.decodeSync(WireAgent)(encoded)
    expect(decoded.agent_id).toBe(1)
    expect(decoded.completed_children).toEqual([])
  })
})

describe("WireScene", () => {
  test("basic scene", () => {
    const scene: WireScene = {
      agents: {},
      max_desks: 16,
      now_ms: 1000,
    }
    const encoded = Schema.encodeSync(WireScene)(scene)
    const decoded = Schema.decodeSync(WireScene)(encoded)
    expect(decoded.max_desks).toBe(16)
    expect(decoded.now_ms).toBe(1000)
    expect(decoded.agents).toEqual({})
  })

  test("scene with one agent", () => {
    const scene: WireScene = {
      agents: {
        "1": {
          agent_id: 1, source: "hook", session_id: "s1", cwd: "/",
          label: "a", origin: "local", state: { type: "Idle" },
          state_started_at_ms: 0, last_event_at_ms: 0, created_at_ms: 0,
          desk_index: 0, tool_call_count: 0, active_ms: 0,
          session_total_tokens: 0, context_total_tokens: 0, context_input_tokens: 0,
          token_input_total: 0, token_output_total: 0, cache_read_tokens: 0,
          context_window_limit: 200000, completed_children: [],
        },
      },
      max_desks: 16,
      now_ms: 5000,
    }
    const encoded = Schema.encodeSync(WireScene)(scene)
    const decoded = Schema.decodeSync(WireScene)(encoded)
    expect(Object.keys(decoded.agents)).toHaveLength(1)
    expect(decoded.agents["1"].label).toBe("a")
  })
})

describe("Session wire types", () => {
  function summary(): WireSessionSummary {
    return {
      session_id: "s1", source: "hook", label: "test", cwd: "/",
      context_window_limit: 200000,
      started_at: 1000, input_tokens: 100, output_tokens: 50,
      cache_read_tokens: 10, tool_call_count: 5, active_ms: 30000,
      cost_usd: 0.05, cache_hit_rate: 0.2, tags: ["dev"],
    }
  }

  test("WireSessionSummary round-trip", () => {
    const s = summary()
    const encoded = Schema.encodeSync(WireSessionSummary)(s)
    const decoded = Schema.decodeSync(WireSessionSummary)(encoded)
    expect(decoded.session_id).toBe("s1")
    expect(decoded.tags).toEqual(["dev"])
  })

  test("WireSessionDetail round-trip", () => {
    const detail: WireSessionDetail = {
      ...summary(),
      snapshots: [{ ts: 1000, cumul_input: 100, cumul_output: 50, cumul_cache: 10, context_pct: 50 }],
      children: [],
      total_cost_usd: 0.05,
    }
    const encoded = Schema.encodeSync(WireSessionDetail)(detail)
    const decoded = Schema.decodeSync(WireSessionDetail)(encoded)
    expect(decoded.snapshots).toHaveLength(1)
    expect(decoded.total_cost_usd).toBe(0.05)
  })

  test("WireSessionComparison round-trip", () => {
    const base = summary()
    const detail = (id: string): WireSessionDetail => ({
      ...base,
      session_id: id,
      snapshots: [],
      children: [],
      total_cost_usd: 0.1,
    })
    const comp: WireSessionComparison = {
      a: detail("s1"),
      b: detail("s2"),
      diff: {
        cost_usd: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0,
        cache_hit_rate_delta: 0, tool_call_count: 0, active_ms: 0, total_cost_usd: 0,
      },
    }
    const encoded = Schema.encodeSync(WireSessionComparison)(comp)
    const decoded = Schema.decodeSync(WireSessionComparison)(encoded)
    expect(decoded.a.session_id).toBe("s1")
    expect(decoded.b.session_id).toBe("s2")
  })
})
