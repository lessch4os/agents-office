import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { SessionStore } from "./session-store";
import { PricingManager } from "./pricing";
import { AgentId } from "./agent-id";
import type { AgentEvent } from "./types";
import type { AgentSlot } from "./state";
import type { ActivityState } from "./state";

// ── Helpers ────────────────────────────────────────────────────────

function makeStore(): SessionStore {
  const pricing = new PricingManager(new Database(":memory:"));
  return new SessionStore(":memory:", pricing);
}

const agentA = AgentId.fromTranscriptPath("/test/a.jsonl");
const agentB = AgentId.fromTranscriptPath("/test/b.jsonl");
const agentC = AgentId.fromTranscriptPath("/test/c.jsonl");

const noAgents: Map<bigint, AgentSlot> = new Map();

function makeSlot(overrides: Partial<AgentSlot> = {}): AgentSlot {
  return {
    agentId: agentA,
    source: "claude-code",
    sessionId: "sess-a",
    cwd: "/repo",
    label: "repo",
    state: { type: "idle" } as ActivityState,
    stateStartedAt: 1000,
    lastEventAt: 1000,
    createdAt: 1000,
    exitingAt: null,
    pendingIdleAt: null,
    deskIndex: 0,
    toolCallCount: 0,
    activeMs: 0,
    unknownCwd: false,
    parentId: null,
    currentTool: null,
    agentType: null,
    sessionTotalTokens: 0,
    contextInputTokens: 0,
    tokenInputTotal: 0,
    tokenOutputTotal: 0,
    cacheReadTokens: 0,
    contextWindowLimit: 200_000,
    modelName: null,
    ...overrides,
  };
}

function sessionStart(overrides: Partial<Extract<AgentEvent, { type: "sessionStart" }>> = {}): AgentEvent {
  return {
    type: "sessionStart",
    agentId: agentA,
    source: "claude-code",
    sessionId: "sess-a",
    cwd: "/repo",
    parentId: null,
    agentType: null,
    contextWindowLimit: 200_000,
    ...overrides,
  };
}

// ── PricingManager ─────────────────────────────────────────────────

describe("PricingManager", () => {
  test("computeCostUsd for known model uses correct rates", () => {
    const pm = new PricingManager(new Database(":memory:"));
    // deepseek-v4-flash: $0.15/M input, $0.60/M output, $0.07/M cache
    const cost = pm.computeCostUsd("deepseek-v4-flash", 1_000_000, 0, 0);
    expect(cost).toBeCloseTo(0.15);

    const cost2 = pm.computeCostUsd("deepseek-v4-flash", 0, 1_000_000, 0);
    expect(cost2).toBeCloseTo(0.60);

    const cost3 = pm.computeCostUsd("deepseek-v4-flash", 0, 0, 1_000_000);
    expect(cost3).toBeCloseTo(0.07);
  });

  test("computeCostUsd for unknown model uses fallback", () => {
    const pm = new PricingManager(new Database(":memory:"));
    const cost = pm.computeCostUsd("nonexistent-model", 1_000_000, 0, 0);
    expect(cost).toBeCloseTo(3.0);
  });

  test("computeCostUsd with null model uses fallback", () => {
    const pm = new PricingManager(new Database(":memory:"));
    expect(pm.computeCostUsd(null, 0, 1_000_000, 0)).toBeCloseTo(15.0);
  });

  test("zero inputs give zero cost", () => {
    const pm = new PricingManager(new Database(":memory:"));
    expect(pm.computeCostUsd("deepseek-v4-flash", 0, 0, 0)).toBe(0);
  });

  test("mixed usage with known model", () => {
    const pm = new PricingManager(new Database(":memory:"));
    // 10k input + 2k output + 50k cache at sonnet rates = 0.03 + 0.03 + 0.015 = 0.075
    expect(pm.computeCostUsd("claude-sonnet-4", 10_000, 2_000, 50_000)).toBeCloseTo(0.075);
  });

  test("set updates pricing and source becomes 'user'", () => {
    const pm = new PricingManager(new Database(":memory:"));
    pm.set("deepseek-v4-flash", 1.0, 2.0, 0.1);
    const cost = pm.computeCostUsd("deepseek-v4-flash", 1_000_000, 0, 0);
    expect(cost).toBeCloseTo(1.0);
    const rows = pm.list();
    const row = rows.find((r) => r.model_name === "deepseek-v4-flash");
    expect(row?.source).toBe("user");
  });

  test("list returns all models", () => {
    const pm = new PricingManager(new Database(":memory:"));
    const rows = pm.list();
    expect(rows.length).toBeGreaterThanOrEqual(13);
    expect(rows.some((r) => r.model_name === "deepseek-v4-flash")).toBe(true);
    expect(rows.some((r) => r.model_name === "claude-sonnet-4")).toBe(true);
  });

  test("resetToDefaults reverts to default pricing", () => {
    const pm = new PricingManager(new Database(":memory:"));
    pm.set("deepseek-v4-flash", 99, 99, 99);
    pm.resetToDefaults();
    expect(pm.computeCostUsd("deepseek-v4-flash", 1_000_000, 0, 0)).toBeCloseTo(0.15);
  });

  test("auto-adds unknown model on get", () => {
    const pm = new PricingManager(new Database(":memory:"));
    pm.get("brand-new-model");
    const rows = pm.list();
    const row = rows.find((r) => r.model_name === "brand-new-model");
    expect(row).toBeTruthy();
    expect(row!.source).toBe("auto");
  });
});

// ── SessionStore ───────────────────────────────────────────────────

describe("SessionStore", () => {
  let store: SessionStore;

  beforeEach(() => {
    store = makeStore();
  });

  // ── sessionStart ──────────────────────────────────────────────────

  test("sessionStart creates session row", () => {
    store.onEvent(sessionStart(), makeSlot(), 1000, noAgents);
    const sessions = store.listSessions({ limit: 10, offset: 0 });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.session_id).toBe("sess-a");
    expect(sessions[0]!.source).toBe("claude-code");
    expect(sessions[0]!.cwd).toBe("/repo");
    expect(sessions[0]!.started_at).toBe(1000);
    expect(sessions[0]!.ended_at).toBeNull();
    expect(sessions[0]!.tags).toEqual([]);
    expect(sessions[0]!.cost_usd).toBe(0);
  });

  test("sessionStart is idempotent (INSERT OR IGNORE)", () => {
    store.onEvent(sessionStart(), makeSlot(), 1000, noAgents);
    store.onEvent(sessionStart(), makeSlot(), 2000, noAgents);
    const sessions = store.listSessions({ limit: 10, offset: 0 });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.started_at).toBe(1000);
  });

  test("sessionStart records parent_session_id from agents map", () => {
    const parentSlot = makeSlot({ agentId: agentB, sessionId: "sess-b" });
    const agents = new Map([[agentB.value, parentSlot]]);

    store.onEvent(sessionStart(), makeSlot(), 1000, noAgents);
    store.onEvent(
      sessionStart({ agentId: agentC, sessionId: "sess-c", parentId: agentB }),
      makeSlot({ agentId: agentC, sessionId: "sess-c" }),
      1001,
      agents,
    );

    const child = store.getSession("sess-c");
    expect(child).not.toBeNull();
    expect(child!.parent_session_id).toBe("sess-b");
  });

  // ── tokenUsage ────────────────────────────────────────────────────

  test("tokenUsage inserts snapshot and updates session tokens", () => {
    store.onEvent(sessionStart(), makeSlot(), 1000, noAgents);

    const slot = makeSlot({
      tokenInputTotal: 5_000,
      tokenOutputTotal: 1_000,
      cacheReadTokens: 20_000,
      contextInputTokens: 5_000,
      contextWindowLimit: 200_000,
    });
    store.onEvent({ type: "tokenUsage", agentId: agentA, input: 5_000, output: 1_000, cacheRead: 20_000 }, slot, 2000, noAgents);

    const detail = store.getSession("sess-a");
    expect(detail).not.toBeNull();
    expect(detail!.input_tokens).toBe(5_000);
    expect(detail!.output_tokens).toBe(1_000);
    expect(detail!.cache_read_tokens).toBe(20_000);
    expect(detail!.snapshots).toHaveLength(1);
    expect(detail!.snapshots[0]!.cumul_input).toBe(5_000);
    expect(detail!.snapshots[0]!.cumul_cache).toBe(20_000);
    expect(detail!.snapshots[0]!.context_pct).toBeCloseTo(5_000 / 200_000);
  });

  test("tokenUsage with no slot is a no-op", () => {
    store.onEvent(sessionStart(), makeSlot(), 1000, noAgents);
    store.onEvent({ type: "tokenUsage", agentId: agentA, input: 100, output: 50 }, undefined, 2000, noAgents);
    const detail = store.getSession("sess-a");
    expect(detail!.snapshots).toHaveLength(0);
    expect(detail!.input_tokens).toBe(0);
  });

  // ── rename ────────────────────────────────────────────────────────

  test("rename updates label", () => {
    store.onEvent(sessionStart(), makeSlot({ label: "old-name" }), 1000, noAgents);
    store.onEvent(
      { type: "rename", agentId: agentA, label: "new-name" },
      makeSlot({ label: "new-name" }),
      2000,
      noAgents,
    );
    const sessions = store.listSessions({ limit: 10, offset: 0 });
    expect(sessions[0]!.label).toBe("new-name");
  });

  // ── sessionEnd ────────────────────────────────────────────────────

  test("sessionEnd sets ended_at and syncs final stats", () => {
    store.onEvent(sessionStart(), makeSlot(), 1000, noAgents);

    const finalSlot = makeSlot({
      activeMs: 42_000,
      toolCallCount: 17,
      tokenInputTotal: 8_000,
      tokenOutputTotal: 3_000,
      cacheReadTokens: 50_000,
    });
    store.onEvent({ type: "sessionEnd", agentId: agentA }, finalSlot, 9999, noAgents);

    const detail = store.getSession("sess-a");
    expect(detail!.ended_at).toBe(9999);
    expect(detail!.active_ms).toBe(42_000);
    expect(detail!.tool_call_count).toBe(17);
    expect(detail!.input_tokens).toBe(8_000);
  });

  // ── listSessions ──────────────────────────────────────────────────

  test("listSessions returns newest-first", () => {
    store.onEvent(sessionStart({ sessionId: "old" }), makeSlot({ sessionId: "old" }), 1000, noAgents);
    store.onEvent(sessionStart({ sessionId: "new" }), makeSlot({ sessionId: "new" }), 2000, noAgents);
    const sessions = store.listSessions({ limit: 10, offset: 0 });
    expect(sessions[0]!.session_id).toBe("new");
    expect(sessions[1]!.session_id).toBe("old");
  });

  test("listSessions respects limit and offset", () => {
    for (let i = 0; i < 5; i++) {
      store.onEvent(
        sessionStart({ sessionId: `sess-${i}` }),
        makeSlot({ sessionId: `sess-${i}` }),
        i * 1000,
        noAgents,
      );
    }
    const page1 = store.listSessions({ limit: 2, offset: 0 });
    const page2 = store.listSessions({ limit: 2, offset: 2 });
    expect(page1).toHaveLength(2);
    expect(page2).toHaveLength(2);
    expect(page1[0]!.session_id).not.toBe(page2[0]!.session_id);
  });

  test("listSessions filters by tag", () => {
    store.onEvent(sessionStart({ sessionId: "s1" }), makeSlot({ sessionId: "s1" }), 1000, noAgents);
    store.onEvent(sessionStart({ sessionId: "s2" }), makeSlot({ sessionId: "s2" }), 2000, noAgents);
    store.tagSession("s1", "baseline");

    const tagged = store.listSessions({ limit: 10, offset: 0, tag: "baseline" });
    expect(tagged).toHaveLength(1);
    expect(tagged[0]!.session_id).toBe("s1");
  });

  test("listSessions filters by source", () => {
    store.onEvent(sessionStart({ sessionId: "cc", source: "claude-code" }), makeSlot({ sessionId: "cc" }), 1000, noAgents);
    store.onEvent(sessionStart({ sessionId: "ag", source: "antigravity" }), makeSlot({ sessionId: "ag" }), 2000, noAgents);

    const ccOnly = store.listSessions({ limit: 10, offset: 0, source: "claude-code" });
    expect(ccOnly).toHaveLength(1);
    expect(ccOnly[0]!.session_id).toBe("cc");
  });

  // ── getSession ────────────────────────────────────────────────────

  test("getSession returns null for unknown id", () => {
    expect(store.getSession("nonexistent")).toBeNull();
  });

  test("getSession includes children and total_cost_usd", () => {
    store.onEvent(sessionStart({ sessionId: "parent" }), makeSlot({ sessionId: "parent" }), 1000, noAgents);
    const parentAgents = new Map([[agentA.value, makeSlot({ sessionId: "parent" })]]);
    store.onEvent(
      sessionStart({ agentId: agentB, sessionId: "child", parentId: agentA }),
      makeSlot({ agentId: agentB, sessionId: "child" }),
      2000,
      parentAgents,
    );

    // add tokens to child — no model_name set, so fallback ($3/M input)
    const childSlot = makeSlot({ agentId: agentB, sessionId: "child", tokenInputTotal: 1_000_000, tokenOutputTotal: 0, cacheReadTokens: 0 });
    store.onEvent({ type: "tokenUsage", agentId: agentB, input: 1_000_000, output: 0 }, childSlot, 3000, noAgents);

    const detail = store.getSession("parent");
    expect(detail!.children).toHaveLength(1);
    expect(detail!.children[0]!.session_id).toBe("child");
    expect(detail!.total_cost_usd).toBeGreaterThan(detail!.cost_usd);
    expect(detail!.total_cost_usd).toBeCloseTo(3); // child has 1M input, fallback $3/M = $3
  });

  // ── tag management ────────────────────────────────────────────────

  test("tagSession adds tag", () => {
    store.onEvent(sessionStart(), makeSlot(), 1000, noAgents);
    store.tagSession("sess-a", "optimized");
    const sessions = store.listSessions({ limit: 10, offset: 0 });
    expect(sessions[0]!.tags).toContain("optimized");
  });

  test("tagSession is idempotent", () => {
    store.onEvent(sessionStart(), makeSlot(), 1000, noAgents);
    store.tagSession("sess-a", "optimized");
    store.tagSession("sess-a", "optimized");
    const sessions = store.listSessions({ limit: 10, offset: 0 });
    expect(sessions[0]!.tags.filter((t) => t === "optimized")).toHaveLength(1);
  });

  test("untagSession removes tag", () => {
    store.onEvent(sessionStart(), makeSlot(), 1000, noAgents);
    store.tagSession("sess-a", "baseline");
    store.tagSession("sess-a", "keep");
    store.untagSession("sess-a", "baseline");
    const sessions = store.listSessions({ limit: 10, offset: 0 });
    expect(sessions[0]!.tags).not.toContain("baseline");
    expect(sessions[0]!.tags).toContain("keep");
  });

  test("tag operations on unknown session are no-ops", () => {
    expect(() => store.tagSession("ghost", "x")).not.toThrow();
    expect(() => store.untagSession("ghost", "x")).not.toThrow();
  });

  // ── compareSessions ───────────────────────────────────────────────

  test("compareSessions returns correct diff", () => {
    // optimized: 10k input, 1k output, 80k cache
    store.onEvent(sessionStart({ sessionId: "opt" }), makeSlot({ sessionId: "opt" }), 1000, noAgents);
    const optSlot = makeSlot({ sessionId: "opt", tokenInputTotal: 10_000, tokenOutputTotal: 1_000, cacheReadTokens: 80_000 });
    store.onEvent({ type: "tokenUsage", agentId: agentA, input: 10_000, output: 1_000, cacheRead: 80_000 }, optSlot, 2000, noAgents);

    // baseline: 80k input, 1k output, 10k cache
    store.onEvent(sessionStart({ sessionId: "base" }), makeSlot({ sessionId: "base" }), 1000, noAgents);
    const baseSlot = makeSlot({ sessionId: "base", tokenInputTotal: 80_000, tokenOutputTotal: 1_000, cacheReadTokens: 10_000 });
    store.onEvent({ type: "tokenUsage", agentId: agentA, input: 80_000, output: 1_000, cacheRead: 10_000 }, baseSlot, 2000, noAgents);

    const cmp = store.compareSessions("opt", "base");
    expect(cmp).not.toBeNull();
    // opt should be cheaper
    expect(cmp!.a.cost_usd).toBeLessThan(cmp!.b.cost_usd);
    // diff.cost_usd < 0 means A costs less than B
    expect(cmp!.diff.cost_usd).toBeLessThan(0);
    // opt has better cache hit rate
    expect(cmp!.diff.cache_hit_rate_delta).toBeGreaterThan(0);
  });

  test("compareSessions returns null if either session missing", () => {
    store.onEvent(sessionStart(), makeSlot(), 1000, noAgents);
    expect(store.compareSessions("sess-a", "missing")).toBeNull();
    expect(store.compareSessions("missing", "sess-a")).toBeNull();
  });
});
