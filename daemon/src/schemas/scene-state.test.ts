import { describe, test, expect } from "bun:test"
import { Schema } from "@effect/schema"
import { SceneState, AgentSlot, ActivityState } from "./scene-state"

describe("ActivityState", () => {
  test("Idle", () => {
    const decoded = Schema.decodeSync(ActivityState)({ type: "Idle" })
    expect(decoded.type).toBe("Idle")
  })

  test("Active", () => {
    const decoded = Schema.decodeSync(ActivityState)({
      type: "Active",
      activity: "typing",
      toolUseId: "t1",
      detail: "Editing file",
    })
    expect(decoded.type).toBe("Active")
    expect(decoded.activity).toBe("typing")
  })

  test("Waiting", () => {
    const decoded = Schema.decodeSync(ActivityState)({
      type: "Waiting",
      reason: "awaiting input",
    })
    expect(decoded.type).toBe("Waiting")
    expect(decoded.reason).toBe("awaiting input")
  })
})

describe("AgentSlot", () => {
  function minimalSlot(): Omit<AgentSlot, "completedChildren"> {
    return {
      agentId: 1,
      source: "hook",
      sessionId: "s1",
      cwd: "/home/user",
      label: "agent-1",
      origin: "local",
      state: { type: "Idle" },
      stateStartedAtMs: 1000,
      lastEventAtMs: 1000,
      createdAtMs: 1000,
      deskIndex: 0,
      toolCallCount: 5,
      activeMs: 60000,
      sessionTotalTokens: 0,
      contextTotalTokens: 0,
      contextInputTokens: 0,
      tokenInputTotal: 150,
      tokenOutputTotal: 75,
      cacheReadTokens: 10,
      contextWindowLimit: 200000,
      completedChildren: [],
    }
  }

  test("minimal slot round-trip", () => {
    const slot = minimalSlot()
    const encoded = Schema.encodeSync(AgentSlot)(slot)
    const decoded = Schema.decodeSync(AgentSlot)(encoded)
    expect(decoded.agentId).toBe(1)
    expect(decoded.completedChildren).toEqual([])
  })

  test("slot with optional fields", () => {
    const slot = {
      ...minimalSlot(),
      machineName: "host-1",
      exitingAtMs: 2000,
      parentId: 0,
      currentTool: "Read",
      agentType: "claude-code",
      modelName: "claude-sonnet-4",
    }
    const encoded = Schema.encodeSync(AgentSlot)(slot)
    const decoded = Schema.decodeSync(AgentSlot)(encoded)
    expect(decoded.machineName).toBe("host-1")
    expect(decoded.modelName).toBe("claude-sonnet-4")
  })

  test("slot with completed children", () => {
    const slot = {
      ...minimalSlot(),
      completedChildren: [
        { agentId: 2, label: "subagent-1", toolCallCount: 3, activeMs: 10000, tokenInputTotal: 50, tokenOutputTotal: 25, cacheReadTokens: 5 },
      ],
    }
    const encoded = Schema.encodeSync(AgentSlot)(slot)
    const decoded = Schema.decodeSync(AgentSlot)(encoded)
    expect(decoded.completedChildren).toHaveLength(1)
    expect(decoded.completedChildren[0].label).toBe("subagent-1")
  })
})

describe("SceneState", () => {
  test("empty scene", () => {
    const scene = { agents: {}, maxDesks: 16 }
    const encoded = Schema.encodeSync(SceneState)(scene)
    const decoded = Schema.decodeSync(SceneState)(encoded)
    expect(decoded.agents).toEqual({})
    expect(decoded.maxDesks).toBe(16)
  })

  test("scene with agents", () => {
    const scene = {
      agents: {
        "1": {
          agentId: 1, source: "hook", sessionId: "s1", cwd: "/", label: "a",
          origin: "local", state: { type: "Idle" }, stateStartedAtMs: 0,
          lastEventAtMs: 0, createdAtMs: 0, deskIndex: 0, toolCallCount: 0,
          activeMs: 0, sessionTotalTokens: 0, contextTotalTokens: 0,
          contextInputTokens: 0, tokenInputTotal: 0, tokenOutputTotal: 0,
          cacheReadTokens: 0, contextWindowLimit: 200000, completedChildren: [],
        },
      },
      maxDesks: 32,
    }
    const encoded = Schema.encodeSync(SceneState)(scene)
    const decoded = Schema.decodeSync(SceneState)(encoded)
    expect(Object.keys(decoded.agents)).toHaveLength(1)
    expect(decoded.maxDesks).toBe(32)
  })
})
