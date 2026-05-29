import { describe, test, expect } from "bun:test";
import { SceneState } from "./state";
import { AgentId } from "./agent-id";
import { sceneToWire } from "./wire";

describe("sceneToWire", () => {
  test("empty scene produces empty agents", () => {
    const scene = new SceneState(16);
    const wire = sceneToWire(scene, 1000);
    expect(wire.agents).toEqual({});
    expect(wire.max_desks).toBe(16);
    expect(wire.now_ms).toBe(1000);
  });

  test("agent state serializes correctly", () => {
    const scene = new SceneState(16);
    const id = AgentId.fromTranscriptPath("/test/path.jsonl");
    const now = Date.now();
    scene.agents.set(id.value, {
      agentId: id,
      source: "claude-code",
      sessionId: "session-1",
      cwd: "/repo",
      label: "cc·repo",
      state: { type: "idle" },
      stateStartedAt: now,
      createdAt: now,
      lastEventAt: now,
      exitingAt: null,
      pendingIdleAt: null,
      deskIndex: 0,
      toolCallCount: 5,
      activeMs: 12000,
      unknownCwd: false,
      parentId: null,
      currentTool: null,
      agentType: null,
      sessionTotalTokens: 0,
      contextTotalTokens: 0,
      contextInputTokens: 0,
      tokenInputTotal: 0,
      tokenOutputTotal: 0,
      cacheReadTokens: 0,
      contextWindowLimit: 200_000,
      modelName: null,
      completedChildren: [],
    });

    const wire = sceneToWire(scene, now);
    const agents = Object.values(wire.agents);
    expect(agents).toHaveLength(1);
    const a = agents[0];
    expect(a.agent_id).toBe(id.toNumber());
    expect(a.source).toBe("claude-code");
    expect(a.session_id).toBe("session-1");
    expect(a.cwd).toBe("/repo");
    expect(a.label).toBe("cc·repo");
    expect(a.state).toEqual({ type: "Idle" });
    expect(a.desk_index).toBe(0);
    expect(a.tool_call_count).toBe(5);
    expect(a.active_ms).toBe(12000);
    expect(a.exiting_at_ms).toBeNull();
    expect(a.parent_id).toBeNull();
    expect(a.current_tool).toBeNull();
    expect(a.agent_type).toBeNull();
  });

  test("active state includes activity and detail", () => {
    const scene = new SceneState(16);
    const id = AgentId.fromTranscriptPath("/test/path.jsonl");
    const now = Date.now();
    scene.agents.set(id.value, {
      agentId: id,
      source: "claude-code",
      sessionId: "s1",
      cwd: "/repo",
      label: "cc·repo",
      state: {
        type: "active",
        activity: "typing",
        toolUseId: "tool-1",
        detail: "Bash: ls -la",
      },
      stateStartedAt: now,
      createdAt: now,
      lastEventAt: now,
      exitingAt: null,
      pendingIdleAt: null,
      deskIndex: 0,
      toolCallCount: 3,
      activeMs: 5000,
      unknownCwd: false,
      parentId: null,
      currentTool: "Bash",
      agentType: null,
      sessionTotalTokens: 0,
      contextTotalTokens: 0,
      contextInputTokens: 0,
      tokenInputTotal: 0,
      tokenOutputTotal: 0,
      cacheReadTokens: 0,
      contextWindowLimit: 200_000,
      modelName: null,
      completedChildren: [],
    });

    const wire = sceneToWire(scene, now);
    const a = Object.values(wire.agents)[0];
    expect(a.state).toEqual({
      type: "Active",
      activity: "typing",
      tool_use_id: "tool-1",
      detail: "Bash: ls -la",
    });
    expect(a.current_tool).toBe("Bash");
  });

  test("exiting agent has exiting_at_ms set", () => {
    const scene = new SceneState(16);
    const id = AgentId.fromTranscriptPath("/test/path.jsonl");
    const now = Date.now();
    scene.agents.set(id.value, {
      agentId: id,
      source: "claude-code",
      sessionId: "s1",
      cwd: "/repo",
      label: "cc·repo",
      state: { type: "idle" },
      stateStartedAt: now,
      createdAt: now,
      lastEventAt: now,
      exitingAt: now - 2000,
      pendingIdleAt: null,
      deskIndex: 0,
      toolCallCount: 0,
      activeMs: 0,
      unknownCwd: false,
      parentId: null,
      currentTool: null,
      agentType: null,
      sessionTotalTokens: 0,
      contextTotalTokens: 0,
      contextInputTokens: 0,
      tokenInputTotal: 0,
      tokenOutputTotal: 0,
      cacheReadTokens: 0,
      contextWindowLimit: 200_000,
      modelName: null,
      completedChildren: [],
    });

    const wire = sceneToWire(scene, now);
    const a = Object.values(wire.agents)[0];
    expect(a.exiting_at_ms).toBe(now - 2000);
  });
});
