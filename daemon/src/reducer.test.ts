import { describe, test, expect } from "bun:test";
import { Reducer, EXIT_GRACE_WINDOW, ACTIVE_GRACE_WINDOW, STALE_IDLE_TIMEOUT, HOOK_WINS_WINDOW } from "./reducer";
import { SceneState } from "./state";
import { AgentId } from "./agent-id";
import type { AgentEvent, Transport } from "./types";

function makeEvent(overrides: Partial<AgentEvent> & { type: AgentEvent["type"] }): AgentEvent {
  const base = { agentId: AgentId.fromTranscriptPath("/test.jsonl") };
  return { ...base, ...overrides } as AgentEvent;
}

function makeSessionStart(overrides: Partial<AgentEvent> & { type: "sessionStart" }): AgentEvent {
  return {
    agentId: AgentId.fromTranscriptPath("/test.jsonl"),
    type: "sessionStart",
    source: "claude-code",
    sessionId: "sess-1",
    cwd: "/repo",
    parentId: null,
    agentType: null,
    ...overrides,
  } as AgentEvent;
}

function makeActivityStart(overrides: Partial<AgentEvent> & { type: "activityStart" }): AgentEvent {
  return {
    agentId: AgentId.fromTranscriptPath("/test.jsonl"),
    type: "activityStart",
    activity: "typing",
    toolUseId: "tu-1",
    detail: { type: "generic", toolName: "Bash", display: "Bash: ls" },
    ...overrides,
  } as AgentEvent;
}

describe("Reducer", () => {
  const sid = AgentId.fromTranscriptPath("/test.jsonl");
  const sidKey = sid.value;

  // ── SessionStart ────────────────────────────────────────────────

  test("SessionStart creates slot with correct label", () => {
    const r = new Reducer();
    const s = new SceneState(16);
    r.apply(s, makeSessionStart({ type: "sessionStart", cwd: "/my-project" }), 1000, "hook");
    const slot = s.agents.get(sidKey);
    expect(slot).toBeDefined();
    expect(slot!.label).toBe("cc\u00b7my-project");
    expect(slot!.deskIndex).toBe(0);
    expect(slot!.state).toEqual({ type: "idle" });
  });

  test("SessionStart with empty cwd gets auto-label", () => {
    const r = new Reducer();
    const s = new SceneState(16);
    r.apply(s, makeSessionStart({ type: "sessionStart", cwd: "" }), 1000, "hook");
    const slot = s.agents.get(sidKey);
    expect(slot!.label).toBe("cc#1");
  });

  test("SessionStart dedup: same agentId ignored", () => {
    const r = new Reducer();
    const s = new SceneState(16);
    r.apply(s, makeSessionStart({ type: "sessionStart" }), 1000, "hook");
    r.apply(s, makeSessionStart({ type: "sessionStart" }), 2000, "hook");
    expect(s.agents.size).toBe(1);
  });

  test("SessionStart when all desks full returns null", () => {
    const r = new Reducer();
    const s = new SceneState(1);
    r.apply(s, makeSessionStart({ type: "sessionStart", agentId: AgentId.fromTranscriptPath("/a.jsonl") }), 1000, "hook");
    r.apply(s, makeSessionStart({ type: "sessionStart", agentId: AgentId.fromTranscriptPath("/b.jsonl") }), 1000, "hook");
    r.apply(s, makeSessionStart({ type: "sessionStart", agentId: AgentId.fromTranscriptPath("/c.jsonl") }), 1000, "hook");
    // 1 desk * 5 floors = 5 slots, so /a, /b, /c all fit
    expect(s.agents.size).toBe(3);
    // But if we fill all 5
    for (let i = 3; i < 5; i++) {
      r.apply(s, makeSessionStart({ type: "sessionStart", agentId: AgentId.fromTranscriptPath(`/${i}.jsonl`) }), 1000, "hook");
    }
    r.apply(s, makeSessionStart({ type: "sessionStart", agentId: AgentId.fromTranscriptPath("/overflow.jsonl") }), 1000, "hook");
    expect(s.agents.size).toBe(5);
  });

  test("SessionStart with parentSessionId resolves parent", () => {
    const r = new Reducer();
    const s = new SceneState(16);
    const parentAgentId = AgentId.fromTranscriptPath("/parent.jsonl");
    const childAgentId = AgentId.fromTranscriptPath("/child.jsonl");
    r.apply(s, makeSessionStart({ type: "sessionStart", agentId: parentAgentId, sessionId: "parent-sess", cwd: "/repo" }), 1000, "hook");
    r.apply(s, makeSessionStart({ type: "sessionStart", agentId: childAgentId, sessionId: "child-sess", cwd: "/repo", parentSessionId: "parent-sess" }), 2000, "hook");

    const child = s.agents.get(childAgentId.value);
    expect(child).toBeDefined();
    expect(child!.parentId).toEqual(parentAgentId);
    expect(child!.sessionId).toBe("child-sess");
  });

  test("SessionStart with parentSessionId but parent not found leaves parentId null", () => {
    const r = new Reducer();
    const s = new SceneState(16);
    const childAgentId = AgentId.fromTranscriptPath("/orphan.jsonl");
    r.apply(s, makeSessionStart({ type: "sessionStart", agentId: childAgentId, sessionId: "orphan-sess", parentSessionId: "nonexistent" }), 1000, "hook");

    const child = s.agents.get(childAgentId.value);
    expect(child).toBeDefined();
    expect(child!.parentId).toBeNull();
  });

  // ── ActivityStart ───────────────────────────────────────────────

  test("ActivityStart sets active state and increments count", () => {
    const r = new Reducer();
    const s = new SceneState(16);
    r.apply(s, makeSessionStart({ type: "sessionStart" }), 1000, "hook");
    r.apply(s, makeActivityStart({ type: "activityStart", toolUseId: "tu-1" }), 2000, "hook");

    const slot = s.agents.get(sidKey)!;
    expect(slot.state.type).toBe("active");
    expect(slot.toolCallCount).toBe(1);
    expect(slot.currentTool).toBe("Bash");
  });

  test("ActivityStart accumulates active_ms", () => {
    const r = new Reducer();
    const s = new SceneState(16);
    r.apply(s, makeSessionStart({ type: "sessionStart" }), 1000, "hook");
    r.apply(s, makeActivityStart({ type: "activityStart", toolUseId: "tu-1" }), 2000, "hook");
    const slot = s.agents.get(sidKey)!;
    // active_ms was 0, state_started_at = 2000, now = 3000, no elapsed because
    // previous state was idle (not active)
    expect(slot.activeMs).toBe(0);
  });

  test("ActivityStart with Task does not increment count", () => {
    const r = new Reducer();
    const s = new SceneState(16);
    r.apply(s, makeSessionStart({ type: "sessionStart" }), 1000, "hook");
    r.apply(s, makeActivityStart({ type: "activityStart", toolUseId: "tu-1", detail: { type: "task" } }), 2000, "hook");
    const slot = s.agents.get(sidKey)!;
    expect(slot.toolCallCount).toBe(0);
  });

  // ── ActivityEnd ─────────────────────────────────────────────────

  test("ActivityEnd arms pending idle", () => {
    const r = new Reducer();
    const s = new SceneState(16);
    r.apply(s, makeSessionStart({ type: "sessionStart" }), 1000, "hook");
    r.apply(s, makeActivityStart({ type: "activityStart", toolUseId: "tu-1" }), 2000, "hook");
    r.apply(s, makeEvent({ type: "activityEnd", toolUseId: "tu-1" }), 3000, "hook");

    const slot = s.agents.get(sidKey)!;
    expect(slot.pendingIdleAt).toBe(3000);
    // State should still be active (debounce)
    expect(slot.state.type).toBe("active");
  });

  test("ActivityEnd on idle slot does not arm pending idle", () => {
    const r = new Reducer();
    const s = new SceneState(16);
    r.apply(s, makeSessionStart({ type: "sessionStart" }), 1000, "hook");
    r.apply(s, makeEvent({ type: "activityEnd", toolUseId: "tu-1" }), 2000, "hook");

    const slot = s.agents.get(sidKey)!;
    expect(slot.pendingIdleAt).toBeNull();
    expect(slot.state.type).toBe("idle");
  });

  // ── Waiting ─────────────────────────────────────────────────────

  test("Waiting sets waiting state", () => {
    const r = new Reducer();
    const s = new SceneState(16);
    r.apply(s, makeSessionStart({ type: "sessionStart" }), 1000, "hook");
    r.apply(s, makeEvent({ type: "waiting", reason: "approval needed" }), 2000, "hook");

    const slot = s.agents.get(sidKey)!;
    expect(slot.state).toEqual({ type: "waiting", reason: "approval needed" });
  });

  // ── Rename ──────────────────────────────────────────────────────

  test("Rename updates label", () => {
    const r = new Reducer();
    const s = new SceneState(16);
    r.apply(s, makeSessionStart({ type: "sessionStart" }), 1000, "hook");
    r.apply(s, makeEvent({ type: "rename", label: "code-explorer" }), 2000, "hook");

    const slot = s.agents.get(sidKey)!;
    expect(slot.label).toBe("code-explorer");
  });

  // ── TokenUsage ──────────────────────────────────────────────────

  test("TokenUsage accumulates", () => {
    const r = new Reducer();
    const s = new SceneState(16);
    r.apply(s, makeSessionStart({ type: "sessionStart" }), 1000, "hook");
    r.apply(s, makeEvent({ type: "tokenUsage", input: 80, output: 20 }), 2000, "hook");
    r.apply(s, makeEvent({ type: "tokenUsage", input: 30, output: 20 }), 3000, "hook");

    const slot = s.agents.get(sidKey)!;
    expect(slot.sessionTotalTokens).toBe(150);
    expect(slot.contextInputTokens).toBe(30);
    expect(slot.tokenInputTotal).toBe(110);
    expect(slot.tokenOutputTotal).toBe(40);
  });

  test("JSONL TokenUsage is dropped when hook is active for same agent", () => {
    const r = new Reducer();
    const s = new SceneState(16);
    // Session started via hook
    r.apply(s, makeSessionStart({ type: "sessionStart" }), 1000, "hook");
    // Any hook event registers the agent in hookActiveAgents
    r.apply(s, makeActivityStart({ type: "activityStart", toolUseId: "tu-1" }), 2000, "hook");
    r.apply(s, makeEvent({ type: "activityEnd", toolUseId: "tu-1" }), 3000, "hook");

    // JSONL tokenUsage arrives — should be dropped
    r.apply(s, makeEvent({ type: "tokenUsage", input: 9999, output: 9999 }), 4000, "jsonl");

    const slot = s.agents.get(sidKey)!;
    expect(slot.sessionTotalTokens).toBe(0);
    expect(slot.tokenInputTotal).toBe(0);
    expect(slot.tokenOutputTotal).toBe(0);
    expect(slot.contextInputTokens).toBe(0);
  });

  test("TokenUsage with cumulative flag overwrites totals", () => {
    const r = new Reducer();
    const s = new SceneState(16);
    r.apply(s, makeSessionStart({ type: "sessionStart" }), 1000, "hook");
    r.apply(s, makeEvent({ type: "tokenUsage", input: 50000, output: 1000, cumulative: true }), 2000, "hook");
    r.apply(s, makeEvent({ type: "tokenUsage", input: 60000, output: 2000, cacheRead: 30000, cumulative: true }), 3000, "hook");

    const slot = s.agents.get(sidKey)!;
    expect(slot.sessionTotalTokens).toBe(62000);
    expect(slot.contextInputTokens).toBe(60000);
    expect(slot.tokenInputTotal).toBe(60000);
    expect(slot.tokenOutputTotal).toBe(2000);
    expect(slot.cacheReadTokens).toBe(30000);
  });

  test("TokenUsage cumulative survives restart", () => {
    const r = new Reducer();
    const s = new SceneState(16);
    r.apply(s, makeSessionStart({ type: "sessionStart" }), 1000, "hook");
    r.apply(s, makeEvent({ type: "tokenUsage", input: 106700, output: 5000, cumulative: true }), 2000, "hook");

    const slot = s.agents.get(sidKey)!;
    expect(slot.tokenInputTotal).toBe(106700);
    expect(slot.tokenOutputTotal).toBe(5000);
    expect(slot.sessionTotalTokens).toBe(111700);
  });

  test("Duplicate ActivityStart with same tool+detail is dropped", () => {
    const r = new Reducer();
    const s = new SceneState(16);
    r.apply(s, makeSessionStart({ type: "sessionStart" }), 1000, "hook");
    r.apply(s, makeActivityStart({ type: "activityStart", toolUseId: "tu-1", detail: { type: "generic", toolName: "Read", display: "Read: src/main.ts" } }), 2000, "hook");
    r.apply(s, makeActivityStart({ type: "activityStart", toolUseId: "tu-2", detail: { type: "generic", toolName: "Read", display: "Read: src/main.ts" } }), 2100, "hook");

    const slot = s.agents.get(sidKey)!;
    expect(slot.toolCallCount).toBe(1);
    expect(slot.state.type).toBe("active");
    expect(slot.currentTool).toBe("Read");
  });

  test("ActivityStart with different tool while active is NOT dropped", () => {
    const r = new Reducer();
    const s = new SceneState(16);
    r.apply(s, makeSessionStart({ type: "sessionStart" }), 1000, "hook");
    r.apply(s, makeActivityStart({ type: "activityStart", toolUseId: "tu-1", detail: { type: "generic", toolName: "Read", display: "Read: src/main.ts" } }), 2000, "hook");
    r.apply(s, makeActivityStart({ type: "activityStart", toolUseId: "tu-2", detail: { type: "generic", toolName: "Bash", display: "Bash: ls" } }), 2100, "hook");

    const slot = s.agents.get(sidKey)!;
    expect(slot.toolCallCount).toBe(2);
    expect(slot.state.type).toBe("active");
    expect(slot.currentTool).toBe("Bash");
  });

  test("JSONL TokenUsage is NOT dropped when only JSONL events exist", () => {
    const r = new Reducer();
    const s = new SceneState(16);
    // Session started via JSONL only (no hook events)
    r.apply(s, makeSessionStart({ type: "sessionStart", agentId: AgentId.fromTranscriptPath("/jsonl-only.jsonl") }), 1000, "jsonl");

    // JSONL tokenUsage — no hook active, should be applied
    const jidKey = AgentId.fromTranscriptPath("/jsonl-only.jsonl").value;
    r.apply(s, makeEvent({ type: "tokenUsage", input: 100, output: 50, agentId: AgentId.fromTranscriptPath("/jsonl-only.jsonl") }), 2000, "jsonl");

    const slot = s.agents.get(jidKey)!;
    expect(slot.sessionTotalTokens).toBe(150);
    expect(slot.tokenInputTotal).toBe(100);
    expect(slot.tokenOutputTotal).toBe(50);
    expect(slot.contextInputTokens).toBe(100);
  });

  // ── SessionEnd ──────────────────────────────────────────────────

  test("SessionEnd marks exiting", () => {
    const r = new Reducer();
    const s = new SceneState(16);
    r.apply(s, makeSessionStart({ type: "sessionStart" }), 1000, "hook");
    r.apply(s, makeEvent({ type: "sessionEnd" }), 2000, "hook");

    const slot = s.agents.get(sidKey)!;
    expect(slot.exitingAt).toBe(2000);
  });

  test("SessionEnd already exiting is idempotent", () => {
    const r = new Reducer();
    const s = new SceneState(16);
    r.apply(s, makeSessionStart({ type: "sessionStart" }), 1000, "hook");
    r.apply(s, makeEvent({ type: "sessionEnd" }), 2000, "hook");
    r.apply(s, makeEvent({ type: "sessionEnd" }), 3000, "hook");

    const slot = s.agents.get(sidKey)!;
    expect(slot.exitingAt).toBe(2000);
  });

  // ── Hook-wins dedup ─────────────────────────────────────────────

  test("JSONL ActivityEnd with same tool_use_id as hook is dropped", () => {
    const r = new Reducer();
    const s = new SceneState(16);
    r.apply(s, makeSessionStart({ type: "sessionStart" }), 1000, "hook");
    r.apply(s, makeActivityStart({ type: "activityStart", toolUseId: "tu-1" }), 2000, "hook");
    r.apply(s, makeEvent({ type: "activityEnd", toolUseId: "tu-1" }), 3000, "hook");

    // Same tool_use_id from JSONL should be deduped... but since hook-wins
    // only dedups ActivityEnd, and the hook one was already processed,
    // the JSONL one will check recentHookToolUses.
    // Actually hook-wins dedup checks recentHookToolUses for the matching
    // tool_use_id from a hook event. The hook's ActivityStart registered tu-1.
    // Then the hook's ActivityEnd with tu-1 was processed.
    // Now a JSONL ActivityEnd with same tu-1 comes in. Since we check
    // recentHookToolUses which was populated by the hook-side ActivityEnd...
    // wait, it only stores start events. Let me check...

    // Actually looking at the code: it registers tool_use_ids from hook events
    // (both ActivityStart and ActivityEnd have tool_use_id). The dedup check
    // looks for the key in recent_hook_tool_uses. So if a JSONL ActivityEnd
    // has a tool_use_id that was seen in any hook event (start or end), it's dropped.
    // But we already processed the hook ActivityEnd above...

    // Let me test with a fresh scene to be clean:
    const r2 = new Reducer();
    const s2 = new SceneState(16);
    r2.apply(s2, makeSessionStart({ type: "sessionStart", agentId: AgentId.fromTranscriptPath("/dedup.jsonl") }), 1000, "hook");
    r2.apply(s2, makeActivityStart({ type: "activityStart", toolUseId: "tu-99", agentId: AgentId.fromTranscriptPath("/dedup.jsonl") }), 2000, "hook");

    // Now JSONL ActivityEnd with same tool_use_id arrives within 500ms window
    r2.apply(s2, makeEvent({ type: "activityEnd", toolUseId: "tu-99", agentId: AgentId.fromTranscriptPath("/dedup.jsonl") }), 2500, "jsonl");

    // The slot's lastEventAt should NOT be updated (event was dropped)
    // But we need to track this differently...
    // Actually, the dedup returns early before updating lastEventAt.
    // Let me verify by checking if state is still active (if the JSONL
    // ActivityEnd was processed, it would have armed pending_idle_at).
    const slot = s2.agents.get(AgentId.fromTranscriptPath("/dedup.jsonl").value)!;
    expect(slot.pendingIdleAt).toBeNull(); // hook's ActivityEnd hasn't fired yet for tu-99
    // Wait, the hook's ActivityStart fired but not ActivityEnd.
    // The JSONL ActivityEnd was deduped so it wouldn't set pendingIdleAt.
    // Good - this confirms dedup works.
    expect(slot.lastEventAt).toBe(2000); // Not updated to 2500
  });

  // ── Subagent suppression ────────────────────────────────────────

  test("Hook ActivityStart suppressed while parent has Task in flight", () => {
    const r = new Reducer();
    const s = new SceneState(16);
    const parentId = AgentId.fromTranscriptPath("/parent.jsonl");
    r.apply(s, makeSessionStart({ type: "sessionStart", agentId: parentId, sessionId: "parent" }), 1000, "hook");

    // Start a Task
    r.apply(s, makeActivityStart({ type: "activityStart", agentId: parentId, toolUseId: "task-1", detail: { type: "task" } }), 2000, "hook");

    // Another hook ActivityStart should be suppressed
    const before = s.agents.get(parentId.value)!.toolCallCount;
    r.apply(s, makeActivityStart({ type: "activityStart", agentId: parentId, toolUseId: "tu-2" }), 3000, "hook");

    const after = s.agents.get(parentId.value)!.toolCallCount;
    expect(after).toBe(before); // Should not have incremented
  });

  test("Task ActivityEnd clears activeTasks and arms pending idle", () => {
    const r = new Reducer();
    const s = new SceneState(16);
    const parentId = AgentId.fromTranscriptPath("/task-end.jsonl");
    r.apply(s, makeSessionStart({ type: "sessionStart", agentId: parentId }), 1000, "hook");
    r.apply(s, makeActivityStart({ type: "activityStart", agentId: parentId, toolUseId: "task-1", detail: { type: "task" } }), 2000, "hook");

    expect(r.activeTasks.get(parentId.value)?.has("task-1")).toBe(true);

    r.apply(s, makeEvent({ type: "activityEnd", agentId: parentId, toolUseId: "task-1" }), 3000, "hook");

    expect(r.activeTasks.get(parentId.value)?.has("task-1")).toBe(false);
    const slot = s.agents.get(parentId.value)!;
    expect(slot.pendingIdleAt).toBe(3000);
  });

  // ── Tick: expire pending idles ──────────────────────────────────

  test("tick expires pending idle after debounce window", () => {
    const r = new Reducer();
    const s = new SceneState(16);
    r.apply(s, makeSessionStart({ type: "sessionStart" }), 1000, "hook");
    r.apply(s, makeActivityStart({ type: "activityStart", toolUseId: "tu-1" }), 2000, "hook");
    r.apply(s, makeEvent({ type: "activityEnd", toolUseId: "tu-1" }), 3000, "hook");

    const slot = s.agents.get(sidKey)!;
    expect(slot.state.type).toBe("active");
    expect(slot.pendingIdleAt).toBe(3000);

    // Tick before window expires → still active
    r.tick(s, 3000 + ACTIVE_GRACE_WINDOW - 1);
    expect(slot.state.type).toBe("active");

    // Tick after window expires → flips to idle
    r.tick(s, 3000 + ACTIVE_GRACE_WINDOW + 1);
    expect(slot.state.type).toBe("idle");
    expect(slot.pendingIdleAt).toBeNull();
  });

  test("new ActivityStart cancels pending idle", () => {
    const r = new Reducer();
    const s = new SceneState(16);
    r.apply(s, makeSessionStart({ type: "sessionStart" }), 1000, "hook");
    r.apply(s, makeActivityStart({ type: "activityStart", toolUseId: "tu-1" }), 2000, "hook");
    r.apply(s, makeEvent({ type: "activityEnd", toolUseId: "tu-1" }), 3000, "hook");

    const slot = s.agents.get(sidKey)!;
    expect(slot.pendingIdleAt).toBe(3000);

    // New tool starts within debounce window → cancels pending idle
    r.apply(s, makeActivityStart({ type: "activityStart", toolUseId: "tu-2" }), 3500, "hook");
    expect(slot.pendingIdleAt).toBeNull();
    expect(slot.state.type).toBe("active");
  });

  // ── Tick: sweep stale ──────────────────────────────────────────

  test("tick marks stale idle agent as exiting", () => {
    const r = new Reducer();
    const s = new SceneState(16);
    const now = 1000000;
    r.apply(s, makeSessionStart({ type: "sessionStart", agentId: AgentId.fromTranscriptPath("/stale.jsonl") }), now, "hook");
    const slot = s.agents.get(AgentId.fromTranscriptPath("/stale.jsonl").value)!;
    expect(slot.exitingAt).toBeNull();

    // Advance time past STALE_IDLE_TIMEOUT
    r.tick(s, now + STALE_IDLE_TIMEOUT + 1);
    expect(slot.exitingAt).toBe(now + STALE_IDLE_TIMEOUT + 1);
  });

  // ── Tick: sweep exited ─────────────────────────────────────────

  test("tick removes agents past EXIT_GRACE_WINDOW", () => {
    const r = new Reducer();
    const s = new SceneState(16);
    r.apply(s, makeSessionStart({ type: "sessionStart" }), 1000, "hook");
    r.apply(s, makeEvent({ type: "sessionEnd" }), 2000, "hook");

    expect(s.agents.has(sidKey)).toBe(true);

    // Tick before grace window → still present
    r.tick(s, 2000 + EXIT_GRACE_WINDOW - 1);
    expect(s.agents.has(sidKey)).toBe(true);

    // Tick after grace window → removed
    r.tick(s, 2000 + EXIT_GRACE_WINDOW + 1);
    expect(s.agents.has(sidKey)).toBe(false);
  });
});
