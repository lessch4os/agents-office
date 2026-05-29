import { describe, test, expect } from "bun:test";
import { SceneState, AgentSlot, MAX_FLOORS } from "./state";
import { AgentId } from "./agent-id";

function makeSlot(agentId: AgentId, deskIndex: number): AgentSlot {
  const now = Date.now();
  return {
    agentId,
    source: "claude-code",
    sessionId: "s1",
    cwd: "/repo",
    label: "cc",
    state: { type: "idle" },
    stateStartedAt: now,
    createdAt: now,
    lastEventAt: now,
    exitingAt: null,
    pendingIdleAt: null,
    deskIndex,
    toolCallCount: 0,
    activeMs: 0,
    unknownCwd: false,
    parentId: null,
    currentTool: null,
    agentType: null,
    sessionTotalTokens: 0,
  };
}

describe("SceneState", () => {
  test("nextFreeDesk starts at zero", () => {
    const s = new SceneState(4);
    expect(s.nextFreeDesk()).toBe(0);
  });

  test("nextFreeDesk returns null when full", () => {
    const s = new SceneState(2);
    for (let i = 0; i < 2 * MAX_FLOORS; i++) {
      const id = AgentId.fromTranscriptPath(`p${i}`);
      s.agents.set(id.value, makeSlot(id, i));
    }
    expect(s.nextFreeDesk()).toBeNull();
  });

  test("nextFreeDesk overflows to second floor", () => {
    const s = new SceneState(4);
    for (let i = 0; i < 4; i++) {
      const id = AgentId.fromTranscriptPath(`f${i}`);
      s.agents.set(id.value, makeSlot(id, i));
    }
    expect(s.nextFreeDesk()).toBe(4);
  });
});
