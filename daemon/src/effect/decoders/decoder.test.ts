import { describe, test, expect } from "bun:test"
import { Either } from "effect"
import { decodeHookPayload, makeToolDetail, describeToolTarget, getStr, getObj, getNum } from "./hook-decoder"
import { decodeCcLine, ccSessionEnded, ccDeriveLabel } from "./cc-jsonl"
import { decodeAgLine, deriveAgLabel } from "./ag-jsonl"
import { decodeOcEvent, ocDeriveLabel, extractSessionId, extractTokensFromEvent, extractModelIdFromEvent } from "./oc-sse"
import type { OcSseEvent } from "./oc-sse"

function fakeHash(_domain: string, key: string): number {
  return key.length
}

describe("decodeHookPayload", () => {
  test("SessionStart", () => {
    const result = decodeHookPayload({
      hook_event_name: "SessionStart",
      session_id: "s1",
      transcript_path: "/home/.claude/projects/p/sessions/s1",
      cwd: "/home/project",
      source: "hook",
    }, fakeHash)
    expect(Either.isRight(result)).toBe(true)
    if (Either.isRight(result)) {
      expect(result.right.events).toHaveLength(1)
      expect(result.right.events[0].type).toBe("sessionStart")
    }
  })

  test("missing hook_event_name returns error", () => {
    const result = decodeHookPayload({ session_id: "s1", transcript_path: "/tmp/t" }, fakeHash)
    expect(Either.isLeft(result)).toBe(true)
  })

  test("PreToolUse", () => {
    const result = decodeHookPayload({
      hook_event_name: "PreToolUse",
      session_id: "s1",
      transcript_path: "/tmp/t",
      tool_name: "Read",
      tool_input: { file_path: "src/main.ts" },
      tool_use_id: "tu1",
    }, fakeHash)
    expect(Either.isRight(result)).toBe(true)
    if (Either.isRight(result)) {
      expect(result.right.events[0].type).toBe("activityStart")
      if (result.right.events[0].type === "activityStart") {
        expect(result.right.events[0].toolUseId).toBe("tu1")
      }
    }
  })

  test("PostToolUse with token usage", () => {
    const result = decodeHookPayload({
      hook_event_name: "PostToolUse",
      session_id: "s1",
      transcript_path: "/tmp/t",
      tool_use_id: "tu1",
      usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 10 },
    }, fakeHash)
    expect(Either.isRight(result)).toBe(true)
    if (Either.isRight(result)) {
      expect(result.right.events).toHaveLength(2)
      expect(result.right.events[0].type).toBe("activityEnd")
      expect(result.right.events[1].type).toBe("tokenUsage")
      if (result.right.events[1].type === "tokenUsage") {
        expect(result.right.events[1].input).toBe(90)
        expect(result.right.events[1].cacheRead).toBe(10)
      }
    }
  })

  test("Notification", () => {
    const result = decodeHookPayload({
      hook_event_name: "Notification",
      session_id: "s1",
      transcript_path: "/tmp/t",
      message: "waiting for approval",
    }, fakeHash)
    expect(Either.isRight(result)).toBe(true)
    if (Either.isRight(result)) {
      expect(result.right.events[0].type).toBe("waiting")
      if (result.right.events[0].type === "waiting") {
        expect(result.right.events[0].reason).toBe("waiting for approval")
      }
    }
  })

  test("SessionEnd", () => {
    const result = decodeHookPayload({
      hook_event_name: "SessionEnd",
      session_id: "s1",
      transcript_path: "/tmp/t",
    }, fakeHash)
    expect(Either.isRight(result)).toBe(true)
    if (Either.isRight(result)) {
      expect(result.right.events[0].type).toBe("sessionEnd")
    }
  })

  test("Rename", () => {
    const result = decodeHookPayload({
      hook_event_name: "Rename",
      session_id: "s1",
      transcript_path: "/tmp/t",
      label: "my-agent",
    }, fakeHash)
    expect(Either.isRight(result)).toBe(true)
    if (Either.isRight(result)) {
      expect(result.right.events[0].type).toBe("rename")
      if (result.right.events[0].type === "rename") {
        expect(result.right.events[0].label).toBe("my-agent")
      }
    }
  })

  test("TokenUpdate", () => {
    const result = decodeHookPayload({
      hook_event_name: "TokenUpdate",
      session_id: "s1",
      transcript_path: "/tmp/t",
      usage: { input_tokens: 200, output_tokens: 100, total_tokens: 300 },
    }, fakeHash)
    expect(Either.isRight(result)).toBe(true)
    if (Either.isRight(result)) {
      expect(result.right.events[0].type).toBe("tokenUsage")
      if (result.right.events[0].type === "tokenUsage") {
        expect(result.right.events[0].cumulative).toBe(true)
        expect(result.right.events[0].total).toBe(300)
      }
    }
  })

  test("unsupported hook_event_name returns error", () => {
    const result = decodeHookPayload({
      hook_event_name: "UnknownEvent",
      session_id: "s1",
      transcript_path: "/tmp/t",
    }, fakeHash)
    expect(Either.isLeft(result)).toBe(true)
  })

  test("Stop decoder", () => {
    const result = decodeHookPayload({
      hook_event_name: "Stop",
      session_id: "s1",
      transcript_path: "/tmp/t",
    }, fakeHash)
    expect(Either.isRight(result)).toBe(true)
    if (Either.isRight(result)) {
      expect(result.right.events[0].type).toBe("activityEnd")
    }
  })

  test("StopFailure decoder", () => {
    const result = decodeHookPayload({
      hook_event_name: "StopFailure",
      session_id: "s1",
      transcript_path: "/tmp/t",
      error: "timeout",
    }, fakeHash)
    expect(Either.isRight(result)).toBe(true)
    if (Either.isRight(result)) {
      expect(result.right.events).toHaveLength(2)
      expect(result.right.events[1].type).toBe("waiting")
    }
  })

  test("ModelUpdate decoder", () => {
    const result = decodeHookPayload({
      hook_event_name: "ModelUpdate",
      session_id: "s1",
      transcript_path: "/tmp/t",
      model_id: "claude-sonnet-4",
      context_window_limit: 200000,
    }, fakeHash)
    expect(Either.isRight(result)).toBe(true)
    if (Either.isRight(result)) {
      expect(result.right.events[0].type).toBe("modelUpdate")
      if (result.right.events[0].type === "modelUpdate") {
        expect(result.right.events[0].modelId).toBe("claude-sonnet-4")
      }
    }
  })

  test("PermissionDenied decoder", () => {
    const result = decodeHookPayload({
      hook_event_name: "PermissionDenied",
      session_id: "s1",
      transcript_path: "/tmp/t",
      tool_use_id: "tu1",
    }, fakeHash)
    expect(Either.isRight(result)).toBe(true)
    if (Either.isRight(result)) {
      expect(result.right.events[0].type).toBe("activityEnd")
    }
  })
})

describe("makeToolDetail", () => {
  test("Task tool returns task type", () => {
    const detail = makeToolDetail("Task", "")
    expect(detail.type).toBe("task")
  })

  test("Agent tool returns task type", () => {
    const detail = makeToolDetail("Agent", "")
    expect(detail.type).toBe("task")
  })

  test("Read tool returns generic type", () => {
    const detail = makeToolDetail("Read", ": src/file.ts")
    expect(detail.type).toBe("generic")
    if (detail.type === "generic") {
      expect(detail.toolName).toBe("Read")
      expect(detail.display).toBe("Read:: src/file.ts")
    }
  })
})

describe("describeToolTarget", () => {
  test("returns path for file tools", () => {
    const result = describeToolTarget("Read", { file_path: "src/main.ts" })
    expect(result).toBe(": src/main.ts")
  })

  test("truncates long values", () => {
    const long = "a".repeat(100)
    const result = describeToolTarget("Read", { file_path: long })
    expect(result).toHaveLength(83)
    expect(result.endsWith("\u2026")).toBe(true)
  })

  test("returns empty for unknown tool", () => {
    const result = describeToolTarget("Unknown", { file_path: "x" })
    expect(result).toBe("")
  })
})

describe("decodeCcLine", () => {
  test("tool_use block", () => {
    const events = decodeCcLine("/tmp/t", "jsonl", 42, {
      type: "assistant",
      message: {
        content: [{ type: "tool_use", id: "tu1", name: "Read", input: { file_path: "src/main.ts" } }],
      },
    })
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe("activityStart")
  })

  test("attribution generates rename", () => {
    const events = decodeCcLine("/tmp/t", "jsonl", 42, {
      attributionAgent: "plugin:agent-1",
      type: "assistant",
      message: { content: [] },
    })
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe("rename")
    if (events[0].type === "rename") {
      expect(events[0].label).toBe("agent-1")
    }
  })

  test("empty content returns no events", () => {
    const events = decodeCcLine("/tmp/t", "jsonl", 42, {
      type: "assistant",
      message: { content: [] },
    })
    expect(events).toEqual([])
  })
})

describe("ccSessionEnded", () => {
  test("detects session end", () => {
    const tail = new TextEncoder().encode(
      '{"subtype":"session_start","some":"data"}\n{"subtype":"session_end"}\n',
    )
    expect(ccSessionEnded(tail)).toBe(true)
  })

  test("returns false for session start only", () => {
    const tail = new TextEncoder().encode('{"subtype":"session_start"}\n')
    expect(ccSessionEnded(tail)).toBe(false)
  })

  test("detects SessionEnd hook", () => {
    const tail = new TextEncoder().encode(
      '{"subtype":"session_start"}\n{"hook_event_name":"SessionEnd"}\n',
    )
    expect(ccSessionEnded(tail)).toBe(true)
  })
})

describe("ccDeriveLabel", () => {
  test("returns subagent for subagent paths", () => {
    expect(ccDeriveLabel("/home/.claude/projects/p/subagents/s1", "/home/project")).toBe("subagent")
  })

  test("derives label from cwd basename", () => {
    expect(ccDeriveLabel("/path/to/transcript", "/home/user/my-project")).toBe("cc\u00b7my-project")
  })

  test("falls back to cc for root", () => {
    expect(ccDeriveLabel("/transcript", "/")).toBe("cc")
  })
})

describe("decodeAgLine", () => {
  test("PLANNER_RESPONSE with tool calls", () => {
    const events = decodeAgLine("/tmp/t", "jsonl", 42, {
      step_index: 1,
      type: "PLANNER_RESPONSE",
      tool_calls: [{ name: "read_file", args: { FilePath: "/tmp/test.txt" } }],
    })
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe("activityStart")
  })

  test("ask_permission generates waiting", () => {
    const events = decodeAgLine("/tmp/t", "jsonl", 42, {
      step_index: 1,
      type: "PLANNER_RESPONSE",
      tool_calls: [{ name: "ask_permission" }],
    })
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe("waiting")
  })

  test("ending non-initial step", () => {
    const events = decodeAgLine("/tmp/t", "jsonl", 42, {
      step_index: 2,
      type: "tool_result",
    })
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe("activityEnd")
  })

  test("step without step_index returns empty", () => {
    const events = decodeAgLine("/tmp/t", "jsonl", 42, { type: "PLANNER_RESPONSE" })
    expect(events).toEqual([])
  })
})

describe("deriveAgLabel", () => {
  test("derives label from cwd", () => {
    expect(deriveAgLabel("/home/user/my-project")).toBe("ag\u00b7my-project")
  })
})

describe("OC SSE decoder", () => {
  const fakeLookup = (_: string) => 200000

  test("session.created returns start + rename", () => {
    const events = decodeOcEvent(42, "sse", {
      type: "session.created",
      properties: { id: "s1", directory: "/home/project", info: { modelID: "claude-sonnet-4" } },
    }, "oc\u00b7project", fakeLookup)
    expect(events).toHaveLength(2)
    expect(events[0].type).toBe("sessionStart")
    expect(events[1].type).toBe("rename")
  })

  test("session.deleted returns end", () => {
    const events = decodeOcEvent(42, "sse", {
      type: "session.deleted",
      properties: {},
    }, "", fakeLookup)
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe("sessionEnd")
  })

  test("session.error returns activityEnd", () => {
    const events = decodeOcEvent(42, "sse", {
      type: "session.error",
      properties: {},
    }, "", fakeLookup)
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe("activityEnd")
  })

  test("unknown event returns empty", () => {
    const events = decodeOcEvent(42, "sse", {
      type: "unknown.event",
      properties: {},
    }, "", fakeLookup)
    expect(events).toEqual([])
  })
})

describe("ocDeriveLabel", () => {
  test("derives label from cwd", () => {
    expect(ocDeriveLabel("/home/user/my-project")).toBe("oc\u00b7my-project")
  })
})

describe("extractSessionId", () => {
  test("extracts from properties.id", () => {
    const event: OcSseEvent = { type: "session.created", properties: { id: "sess_123" } }
    expect(extractSessionId(event)).toBe("sess_123")
  })

  test("extracts from info.sessionID", () => {
    const event: OcSseEvent = { type: "session.created", properties: { info: { sessionID: "sess_456" } } }
    expect(extractSessionId(event)).toBe("sess_456")
  })

  test("returns null when no id found", () => {
    const event: OcSseEvent = { type: "session.created", properties: {} }
    expect(extractSessionId(event)).toBeNull()
  })
})

describe("extractTokensFromEvent", () => {
  test("extracts from info.tokens", () => {
    const event: OcSseEvent = { type: "step.finish", properties: { info: { tokens: { input: 100, output: 50 } } } }
    const result = extractTokensFromEvent(event)
    expect(result).toEqual({ input: 100, output: 50 })
  })

  test("extracts from part.tokens", () => {
    const event: OcSseEvent = { type: "step.finish", properties: { part: { tokens: { input: 200, output: 100 } } } }
    const result = extractTokensFromEvent(event)
    expect(result).toEqual({ input: 200, output: 100 })
  })

  test("returns null when no tokens found", () => {
    const event: OcSseEvent = { type: "step.finish", properties: {} }
    expect(extractTokensFromEvent(event)).toBeNull()
  })
})

describe("extractModelIdFromEvent", () => {
  test("extracts from info.modelID", () => {
    const event: OcSseEvent = { type: "session.created", properties: { info: { modelID: "claude-sonnet-4" } } }
    expect(extractModelIdFromEvent(event)).toBe("claude-sonnet-4")
  })

  test("returns null when no modelID", () => {
    const event: OcSseEvent = { type: "session.created", properties: {} }
    expect(extractModelIdFromEvent(event)).toBeNull()
  })
})

describe("getStr / getObj / getNum", () => {
  test("getStr returns string value", () => {
    expect(getStr({ a: "hello" }, "a")).toBe("hello")
  })

  test("getStr returns undefined for non-string", () => {
    expect(getStr({ a: 42 }, "a")).toBeUndefined()
  })

  test("getObj returns object value", () => {
    expect(getObj({ a: { b: 1 } }, "a")).toEqual({ b: 1 })
  })

  test("getObj returns undefined for array", () => {
    expect(getObj({ a: [1, 2] }, "a")).toBeUndefined()
  })

  test("getNum returns number value", () => {
    expect(getNum({ a: 42 }, "a")).toBe(42)
  })

  test("getNum returns undefined for string", () => {
    expect(getNum({ a: "42" }, "a")).toBeUndefined()
  })
})
