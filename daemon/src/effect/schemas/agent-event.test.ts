import { describe, test, expect } from "bun:test"
import { Schema } from "@effect/schema"
import { Either } from "effect"
import { AgentEvent, Activity, ToolDetail, Transport, LogType, WireLogEntry, TaggedEvent, eventAgentId, eventToolUseId, toolDetailDisplay, toolDetailToolName, toolDetailIsTask } from "./agent-event"

describe("Activity", () => {
  test("valid activities", () => {
    expect(Schema.decodeSync(Activity)("typing")).toBe("typing")
    expect(Schema.decodeSync(Activity)("reading")).toBe("reading")
    expect(Schema.decodeSync(Activity)("thinking")).toBe("thinking")
  })

  test("invalid activity", () => {
    const result = Schema.decodeEither(Activity)("sleeping")
    expect(Either.isLeft(result)).toBe(true)
  })
})

describe("Transport", () => {
  test("valid transports", () => {
    const valid = ["hook", "jsonl", "remote-hook", "sse", "restore"] as const
    for (const t of valid) {
      expect(Schema.decodeSync(Transport)(t)).toBe(t)
    }
  })

  test("invalid transport", () => {
    expect(Either.isLeft(Schema.decodeEither(Transport)("tcp"))).toBe(true)
  })
})

describe("LogType", () => {
  test("valid log types", () => {
    const valid = ["tool_start", "tool_result", "thought", "error", "waiting"] as const
    for (const t of valid) {
      expect(Schema.decodeSync(LogType)(t)).toBe(t)
    }
  })
})

describe("ToolDetail", () => {
  test("task type", () => {
    const input = { type: "task" as const }
    const decoded = Schema.decodeSync(ToolDetail)(input)
    expect(decoded.type).toBe("task")
    expect(toolDetailDisplay(decoded)).toBe("Delegating")
    expect(toolDetailToolName(decoded)).toBeNull()
    expect(toolDetailIsTask(decoded)).toBe(true)
  })

  test("generic type", () => {
    const input = { type: "generic" as const, toolName: "Read", display: "Read: file.txt" }
    const decoded = Schema.decodeSync(ToolDetail)(input)
    expect(decoded.type).toBe("generic")
    expect(decoded.toolName).toBe("Read")
    expect(decoded.display).toBe("Read: file.txt")
    expect(toolDetailDisplay(decoded)).toBe("Read: file.txt")
    expect(toolDetailToolName(decoded)).toBe("Read")
    expect(toolDetailIsTask(decoded)).toBe(false)
  })
})

describe("AgentEvent round-trip", () => {
  const events = [
    {
      type: "sessionStart" as const,
      agentId: 42,
      source: "hook",
      sessionId: "sess_123",
      cwd: "/home/user/project",
      parentId: undefined,
      origin: undefined,
    },
    {
      type: "activityStart" as const,
      agentId: 42,
      activity: "typing" as const,
      toolUseId: "tool_1",
      detail: { type: "generic" as const, toolName: "Read", display: "Read: file.txt" },
    },
    {
      type: "activityEnd" as const,
      agentId: 42,
      toolUseId: "tool_1",
    },
    {
      type: "waiting" as const,
      agentId: 42,
      reason: "waiting for approval",
    },
    {
      type: "rename" as const,
      agentId: 42,
      label: "my-agent",
    },
    {
      type: "tokenUsage" as const,
      agentId: 42,
      input: 100,
      output: 50,
      cacheRead: 10,
    },
    {
      type: "sessionEnd" as const,
      agentId: 42,
    },
    {
      type: "modelUpdate" as const,
      agentId: 42,
      modelId: "claude-sonnet-4-20250514",
      contextWindowLimit: 200000,
    },
  ]

  for (const event of events) {
    test(`round-trip: ${event.type}`, () => {
      const encoded = Schema.encodeSync(AgentEvent)(event)
      const decoded = Schema.decodeSync(AgentEvent)(encoded)
      expect(decoded).toEqual(event)
    })
  }

  test("eventAgentId helper", () => {
    const event = Schema.decodeSync(AgentEvent)({ type: "sessionStart", agentId: 42, source: "hook", sessionId: "s", cwd: "/" })
    expect(eventAgentId(event)).toBe(42)
  })

  test("eventToolUseId helper", () => {
    const start = Schema.decodeSync(AgentEvent)({ type: "activityStart", agentId: 1, activity: "typing", toolUseId: "t1" })
    expect(eventToolUseId(start)).toBe("t1")

    const end = Schema.decodeSync(AgentEvent)({ type: "activityEnd", agentId: 1, toolUseId: "t1" })
    expect(eventToolUseId(end)).toBe("t1")

    const wait = Schema.decodeSync(AgentEvent)({ type: "waiting", agentId: 1, reason: "x" })
    expect(eventToolUseId(wait)).toBeNull()
  })
})

describe("TaggedEvent", () => {
  test("round-trip", () => {
    const input: TaggedEvent = {
      transport: "hook",
      event: { type: "sessionStart", agentId: 1, source: "hook", sessionId: "s", cwd: "/" },
    }
    const encoded = Schema.encodeSync(TaggedEvent)(input)
    const decoded = Schema.decodeSync(TaggedEvent)(encoded)
    expect(decoded).toEqual(input)
  })
})

describe("WireLogEntry", () => {
  test("round-trip with all fields", () => {
    const input: WireLogEntry = {
      agent_id: 1,
      timestamp_ms: 1000,
      tool_name: "Read",
      detail: "file.txt",
      log_type: "tool_start",
      truncated: false,
      tool_input: "file.txt",
      duration_ms: 500,
    }
    const encoded = Schema.encodeSync(WireLogEntry)(input)
    const decoded = Schema.decodeSync(WireLogEntry)(encoded)
    expect(decoded).toEqual(input)
  })

  test("round-trip with optional fields omitted", () => {
    const input = {
      agent_id: 1,
      timestamp_ms: 1000,
      detail: "done",
      log_type: "tool_result" as const,
      truncated: false,
    }
    const encoded = Schema.encodeSync(WireLogEntry)(input)
    const decoded = Schema.decodeSync(WireLogEntry)(encoded)
    expect(decoded.agent_id).toBe(1)
    expect(decoded.tool_name).toBeUndefined()
    expect(decoded.duration_ms).toBeUndefined()
  })
})
