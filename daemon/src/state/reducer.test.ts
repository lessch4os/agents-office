import { describe, test, expect } from "bun:test"
import { HashMap } from "effect"
import { applyEvent, createInitialState, createMeta, tick, nextFreeDesk, AgentSlot, MAX_FLOORS } from "./reducer"

function slotDesk(d: number): AgentSlot {
  return { deskIndex: d } as AgentSlot
}

function getAgent(state: ReturnType<typeof createInitialState>, id: number): any {
  const opt = HashMap.get(state.agents, String(id))
  return opt._tag === "Some" ? opt.value : undefined
}

describe("nextFreeDesk", () => {
  test("returns 0 for empty scene", () => {
    expect(nextFreeDesk(HashMap.empty(), 16)).toBe(0)
  })

  test("next desk after occupied", () => {
    const agents = HashMap.make<string, AgentSlot>(["1", slotDesk(0)])
    expect(nextFreeDesk(agents, 16)).toBe(1)
  })

  test("returns undefined when all desks full", () => {
    let agents = HashMap.empty<string, AgentSlot>()
    for (let i = 0; i < 16 * MAX_FLOORS; i++) agents = HashMap.set(agents, String(i), slotDesk(i))
    expect(nextFreeDesk(agents, 1)).toBeUndefined()
  })
})

describe("SessionStart", () => {
  test("creates a new agent slot", () => {
    const state = createInitialState()
    const meta = createMeta()
    const next = applyEvent(state, meta, { type: "sessionStart", agentId: 42, source: "hook", sessionId: "s42", cwd: "/home/project" }, 1000, "hook")
    const slot = getAgent(next, 42)
    expect(slot).toBeDefined()
    expect(slot.sessionId).toBe("s42")
    expect(slot.state.type).toBe("idle")
  })

  test("ignores duplicate session start", () => {
    const state = createInitialState()
    const meta = createMeta()
    const s1 = applyEvent(state, meta, { type: "sessionStart", agentId: 42, source: "hook", sessionId: "s42", cwd: "/home/project" }, 1000, "hook")
    const s2 = applyEvent(s1, meta, { type: "sessionStart", agentId: 42, source: "hook", sessionId: "s42", cwd: "/home/project" }, 1001, "hook")
    const slot = getAgent(s2, 42)
    expect(slot).toBeDefined()
  })

  test("drops session when all desks occupied", () => {
    const state = { ...createInitialState(1), maxDesks: 1 }
    const meta = createMeta()
    const totalDesks = 1 * MAX_FLOORS
    let s = state
    for (let i = 0; i < totalDesks; i++) {
      s = applyEvent(s, meta, { type: "sessionStart", agentId: i + 1, source: "hook", sessionId: `s${i + 1}`, cwd: "/home/project" }, 1000 + i, "hook")
    }
    const over = applyEvent(s, meta, { type: "sessionStart", agentId: 99, source: "hook", sessionId: "overflow", cwd: "/home/project" }, 2000, "hook")
    expect(getAgent(over, 99)).toBeUndefined()
  })
})

describe("ActivityStart/End", () => {
  test("activityStart sets active state", () => {
    const state = createInitialState()
    const meta = createMeta()
    const s1 = applyEvent(state, meta, { type: "sessionStart", agentId: 42, source: "hook", sessionId: "s42", cwd: "/p" }, 1000, "hook")
    const s2 = applyEvent(s1, meta, { type: "activityStart", agentId: 42, activity: "typing", toolUseId: "t1", detail: { type: "generic", toolName: "Read", display: "Read: file.ts" } }, 2000, "hook")
    const slot = getAgent(s2, 42)
    expect(slot.state.type).toBe("active")
  })

  test("activityEnd transitions to pending idle", () => {
    const state = createInitialState()
    const meta = createMeta()
    const s1 = applyEvent(state, meta, { type: "sessionStart", agentId: 42, source: "hook", sessionId: "s42", cwd: "/p" }, 1000, "hook")
    const s2 = applyEvent(s1, meta, { type: "activityStart", agentId: 42, activity: "typing", toolUseId: "t1" }, 2000, "hook")
    const s3 = applyEvent(s2, meta, { type: "activityEnd", agentId: 42, toolUseId: "t1" }, 3000, "hook")
    const slot = getAgent(s3, 42)
    expect(slot.pendingIdleAt).toBe(3000)
  })
})

describe("Waiting", () => {
  test("sets waiting state", () => {
    const state = createInitialState()
    const meta = createMeta()
    const s1 = applyEvent(state, meta, { type: "sessionStart", agentId: 42, source: "hook", sessionId: "s42", cwd: "/p" }, 1000, "hook")
    const s2 = applyEvent(s1, meta, { type: "waiting", agentId: 42, reason: "approval" }, 2000, "hook")
    const slot = getAgent(s2, 42)
    expect(slot.state.type).toBe("waiting")
    expect(slot.state.reason).toBe("approval")
  })
})

describe("TokenUsage", () => {
  test("incremental token usage", () => {
    const state = createInitialState()
    const meta = createMeta()
    const s1 = applyEvent(state, meta, { type: "sessionStart", agentId: 42, source: "hook", sessionId: "s42", cwd: "/p" }, 1000, "hook")
    const s2 = applyEvent(s1, meta, { type: "tokenUsage", agentId: 42, input: 100, output: 50 }, 2000, "hook")
    const s3 = applyEvent(s2, meta, { type: "tokenUsage", agentId: 42, input: 50, output: 25 }, 3000, "hook")
    const slot = getAgent(s3, 42)
    expect(slot.tokenInputTotal).toBe(150)
    expect(slot.tokenOutputTotal).toBe(75)
  })

  test("cumulative token usage overwrites", () => {
    const state = createInitialState()
    const meta = createMeta()
    const s1 = applyEvent(state, meta, { type: "sessionStart", agentId: 42, source: "hook", sessionId: "s42", cwd: "/p" }, 1000, "hook")
    const s2 = applyEvent(s1, meta, { type: "tokenUsage", agentId: 42, input: 100, output: 50, cumulative: true }, 2000, "hook")
    const s3 = applyEvent(s2, meta, { type: "tokenUsage", agentId: 42, input: 200, output: 100, cumulative: true }, 3000, "hook")
    const slot = getAgent(s3, 42)
    expect(slot.tokenInputTotal).toBe(200)
  })
})

describe("Rename", () => {
  test("updates label", () => {
    const state = createInitialState()
    const meta = createMeta()
    const s1 = applyEvent(state, meta, { type: "sessionStart", agentId: 42, source: "hook", sessionId: "s42", cwd: "/p" }, 1000, "hook")
    const s2 = applyEvent(s1, meta, { type: "rename", agentId: 42, label: "new-label" }, 2000, "hook")
    const slot = getAgent(s2, 42)
    expect(slot.label).toBe("new-label")
  })
})

describe("SessionEnd", () => {
  test("marks agent as exiting", () => {
    const state = createInitialState()
    const meta = createMeta()
    const s1 = applyEvent(state, meta, { type: "sessionStart", agentId: 42, source: "hook", sessionId: "s42", cwd: "/p" }, 1000, "hook")
    const s2 = applyEvent(s1, meta, { type: "sessionEnd", agentId: 42 }, 2000, "hook")
    const slot = getAgent(s2, 42)
    expect(slot.exitingAt).toBe(2000)
  })

  test("cascade: parent end marks children as exiting", () => {
    const state = createInitialState()
    const meta = createMeta()
    const s1 = applyEvent(state, meta, { type: "sessionStart", agentId: 1, source: "jsonl", sessionId: "parent", cwd: "/p" }, 1000, "jsonl")
    const s2 = applyEvent(s1, meta, { type: "sessionStart", agentId: 2, source: "jsonl", sessionId: "child", cwd: "/p/sub", parentId: 1 }, 1001, "jsonl")
    const s3 = applyEvent(s2, meta, { type: "sessionEnd", agentId: 1 }, 2000, "jsonl")
    const child = getAgent(s3, 2)
    expect(child.exitingAt).toBe(2000)
  })
})

describe("Hook-wins dedup", () => {
  test("jsonl activity dropped when hook has recent tool use", () => {
    const state = createInitialState()
    const meta = createMeta()
    const s1 = applyEvent(state, meta, { type: "sessionStart", agentId: 42, source: "hook", sessionId: "s42", cwd: "/p" }, 1000, "hook")
    applyEvent(s1, meta, { type: "activityStart", agentId: 42, activity: "typing", toolUseId: "t1", detail: { type: "generic", toolName: "Read", display: "Read: x" } }, 1001, "hook")
    const s3 = applyEvent(s1, meta, { type: "activityStart", agentId: 42, activity: "typing", toolUseId: "t1", detail: { type: "generic", toolName: "Read", display: "Read: x" } }, 1002, "jsonl")
    const slot = getAgent(s3, 42)
    expect(slot.toolCallCount).toBe(0)
  })
})

describe("Stale agent sweeping", () => {
  test("agent with no events eventually gets marked exiting", () => {
    const state = createInitialState()
    const meta = createMeta()
    const s1 = applyEvent(state, meta, { type: "sessionStart", agentId: 42, source: "hook", sessionId: "s42", cwd: "/home/project" }, 1000, "hook")
    tick(s1, meta, 1000 + 31 * 60 * 1000 + 1)
    const slot = getAgent(s1, 42)
    expect(slot?.exitingAt).toBeGreaterThan(0)
  })
})

describe("SweepExited completedChildren", () => {
  test("child is added to parent completedChildren before parent is removed", () => {
    const state = createInitialState()
    const meta = createMeta()
    let s = state
    s = applyEvent(s, meta, { type: "sessionStart", agentId: 1, source: "jsonl", sessionId: "parent", cwd: "/p" }, 1000, "jsonl")
    s = applyEvent(s, meta, { type: "sessionStart", agentId: 2, source: "jsonl", sessionId: "child", cwd: "/p/sub", parentId: 1 }, 1001, "jsonl")
    // Child exits first
    s = applyEvent(s, meta, { type: "sessionEnd", agentId: 2 }, 2000, "jsonl")
    // Parent exits later
    s = applyEvent(s, meta, { type: "sessionEnd", agentId: 1 }, 10000, "jsonl")

    // Tick at a time when child is expired but parent is not
    tick(s, meta, 2000 + 4500 + 1) // child: 6501ms - 2000ms = 4501ms > 4500 ✓, parent: 6501ms - 10000ms < 0 ✗

    // Child was added to parent's completedChildren before removal; parent still alive
    const parent = getAgent(s, 1)
    expect(parent).toBeDefined()
    expect(parent.completedChildren.length).toBe(1)
    expect(parent.completedChildren[0].agentId).toBe(2)
    expect(HashMap.has(s.agents, String(2))).toBe(false)
  })

  test("child added to completedChildren when parent stays alive", () => {
    const state = createInitialState()
    const meta = createMeta()
    let s = state
    s = applyEvent(s, meta, { type: "sessionStart", agentId: 1, source: "jsonl", sessionId: "parent", cwd: "/p" }, 1000, "jsonl")
    s = applyEvent(s, meta, { type: "sessionStart", agentId: 2, source: "jsonl", sessionId: "child", cwd: "/p/sub", parentId: 1 }, 1001, "jsonl")
    // Only child exits — parent stays alive
    s = applyEvent(s, meta, { type: "sessionEnd", agentId: 2 }, 2000, "jsonl")

    tick(s, meta, 2000 + 4500 + 1)

    // Parent still alive, child in completedChildren
    const parent = getAgent(s, 1)
    expect(parent).toBeDefined()
    expect(parent.completedChildren.length).toBe(1)
    expect(parent.completedChildren[0].agentId).toBe(2)
    expect(HashMap.has(s.agents, String(2))).toBe(false)
  })
})

describe("Subagent suppression", () => {
  test("hook events suppressed while task in flight", () => {
    const state = createInitialState()
    const meta = createMeta()
    const s1 = applyEvent(state, meta, { type: "sessionStart", agentId: 42, source: "hook", sessionId: "s42", cwd: "/p" }, 1000, "hook")
    const s2 = applyEvent(s1, meta, { type: "activityStart", agentId: 42, activity: "typing", toolUseId: "task1", detail: { type: "task" } }, 2000, "hook")
    const s3 = applyEvent(s2, meta, { type: "activityStart", agentId: 42, activity: "typing", toolUseId: "sub1" }, 3000, "hook")
    const slot = getAgent(s3, 42)
    expect(slot.state.type).toBe("active")
  })
})
