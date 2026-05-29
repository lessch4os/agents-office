import { describe, test, expect } from "bun:test";
import { decodeHookPayload, describeToolTarget, makeToolDetail } from "./decoder";

describe("makeToolDetail", () => {
  test("Task returns task type", () => {
    const d = makeToolDetail("Task", "");
    expect(d).toEqual({ type: "task" });
  });

  test("Agent returns task type", () => {
    const d = makeToolDetail("Agent", "");
    expect(d).toEqual({ type: "task" });
  });

  test("Bash returns generic with description", () => {
    const d = makeToolDetail("Bash", ": ls -la");
    expect(d).toEqual({ type: "generic", toolName: "Bash", display: "Bash: ls -la" });
  });
});

describe("describeToolTarget", () => {
  test("extracts file_path for Edit", () => {
    const result = describeToolTarget("Edit", { file_path: "src/main.ts" });
    expect(result).toBe(": src/main.ts");
  });

  test("extracts command for Bash", () => {
    const result = describeToolTarget("Bash", { command: "cargo build" });
    expect(result).toBe(": cargo build");
  });

  test("extracts pattern for Grep", () => {
    const result = describeToolTarget("Grep", { pattern: "fn main" });
    expect(result).toBe(": fn main");
  });

  test("truncates long values", () => {
    const long = "a".repeat(200);
    const result = describeToolTarget("Bash", { command: long });
    expect(result).toBe(`: ${"a".repeat(80)}…`);
  });

  test("returns empty for unknown tool", () => {
    const result = describeToolTarget("Unknown", { foo: "bar" });
    expect(result).toBe("");
  });

  test("returns empty for null input", () => {
    const result = describeToolTarget("Bash", null);
    expect(result).toBe("");
  });

  test("returns empty for undefined input", () => {
    const result = describeToolTarget("Bash", undefined);
    expect(result).toBe("");
  });
});

describe("decodeHookPayload", () => {
  function makePayload(overrides: Record<string, unknown>): Record<string, unknown> {
    return {
      hook_event_name: "SessionStart",
      session_id: "session-1",
      transcript_path: "/tmp/test.jsonl",
      source: "claude-code",
      ...overrides,
    };
  }

  test("SessionStart", () => {
    const events = decodeHookPayload(makePayload({ cwd: "/repo" }));
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("sessionStart");
    if (events[0].type === "sessionStart") {
      expect(events[0].agentId.toNumber()).toBeGreaterThan(0);
      expect(events[0].source).toBe("claude-code");
      expect(events[0].sessionId).toBe("session-1");
      expect(events[0].cwd).toBe("/repo");
      expect(events[0].parentId).toBeNull();
      expect(events[0].agentType).toBeNull();
    }
  });

  test("SessionStart with parent_session_id", () => {
    const events = decodeHookPayload(makePayload({ cwd: "/repo", parent_session_id: "parent-sess-1" }));
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("sessionStart");
    if (events[0].type === "sessionStart") {
      expect(events[0].parentSessionId).toBe("parent-sess-1");
      expect(events[0].parentId).toBeNull();
    }
  });

  test("SessionStart without parent_session_id leaves parentSessionId undefined", () => {
    const events = decodeHookPayload(makePayload({ cwd: "/repo" }));
    expect(events).toHaveLength(1);
    if (events[0].type === "sessionStart") {
      expect(events[0].parentSessionId).toBeUndefined();
    }
  });

  test("SessionStart with agent_type", () => {
    const events = decodeHookPayload(makePayload({ cwd: "/repo", agent_type: "caveman:cavecrew-investigator" }));
    expect(events).toHaveLength(1);
    if (events[0].type === "sessionStart") {
      expect(events[0].agentType).toBe("caveman:cavecrew-investigator");
    }
  });

  test("SessionStart without source infers from agent_type", () => {
    const events = decodeHookPayload({
      hook_event_name: "SessionStart",
      session_id: "oc-session-1",
      transcript_path: "oc-uuid",
      cwd: "/repo",
      agent_type: "opencode",
    });
    expect(events).toHaveLength(1);
    if (events[0].type === "sessionStart") {
      expect(events[0].source).toBe("opencode");
      expect(events[0].agentType).toBe("opencode");
    }
  });

  test("PreToolUse", () => {
    const events = decodeHookPayload({
      hook_event_name: "PreToolUse",
      session_id: "s1",
      transcript_path: "/tmp/t.jsonl",
      tool_name: "Bash",
      tool_input: { command: "ls" },
      tool_use_id: "tu-1",
    });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("activityStart");
    if (events[0].type === "activityStart") {
      expect(events[0].activity).toBe("typing");
      expect(events[0].toolUseId).toBe("tu-1");
      expect(events[0].detail).toEqual({ type: "generic", toolName: "Bash", display: "Bash: ls" });
    }
  });

  test("PostToolUse with token usage", () => {
    const events = decodeHookPayload({
      hook_event_name: "PostToolUse",
      session_id: "s1",
      transcript_path: "/tmp/t.jsonl",
      tool_use_id: "tu-1",
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("activityEnd");
    expect(events[1].type).toBe("tokenUsage");
    if (events[1].type === "tokenUsage") {
      expect(events[1].input).toBe(100);
      expect(events[1].output).toBe(50);
    }
  });

  test("PostToolUse with token usage does not set cumulative flag", () => {
    const events = decodeHookPayload({
      hook_event_name: "PostToolUse",
      session_id: "s1",
      transcript_path: "/tmp/t.jsonl",
      tool_use_id: "tu-1",
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    expect(events).toHaveLength(2);
    if (events[1].type === "tokenUsage") {
      expect(events[1].cumulative).toBeUndefined();
    }
  });

  test("TokenUpdate sets cumulative flag", () => {
    const events = decodeHookPayload({
      hook_event_name: "TokenUpdate",
      session_id: "s1",
      transcript_path: "/tmp/t.jsonl",
      usage: { input_tokens: 50000, output_tokens: 2000 },
    });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("tokenUsage");
    if (events[0].type === "tokenUsage") {
      expect(events[0].cumulative).toBe(true);
      expect(events[0].input).toBe(50000);
      expect(events[0].output).toBe(2000);
    }
  });

  test("TokenUpdate with cache read tokens", () => {
    const events = decodeHookPayload({
      hook_event_name: "TokenUpdate",
      session_id: "s1",
      transcript_path: "/tmp/t.jsonl",
      usage: { input_tokens: 80000, output_tokens: 2000, cache_read_input_tokens: 30000 },
    });
    expect(events).toHaveLength(1);
    if (events[0].type === "tokenUsage") {
      expect(events[0].cumulative).toBe(true);
      expect(events[0].input).toBe(50000);
      expect(events[0].cacheRead).toBe(30000);
    }
  });

  test("PostToolUse without token usage", () => {
    const events = decodeHookPayload({
      hook_event_name: "PostToolUse",
      session_id: "s1",
      transcript_path: "/tmp/t.jsonl",
      tool_use_id: "tu-1",
    });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("activityEnd");
  });

  test("Notification", () => {
    const events = decodeHookPayload({
      hook_event_name: "Notification",
      session_id: "s1",
      transcript_path: "/tmp/t.jsonl",
      message: "user needs to approve",
    });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("waiting");
    if (events[0].type === "waiting") {
      expect(events[0].reason).toBe("user needs to approve");
    }
  });

  test("SessionEnd", () => {
    const events = decodeHookPayload(makePayload({ hook_event_name: "SessionEnd" }));
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("sessionEnd");
  });

  test("SubagentStart returns empty", () => {
    const events = decodeHookPayload(makePayload({ hook_event_name: "SubagentStart" }));
    expect(events).toHaveLength(0);
  });

  test("SubagentStop", () => {
    const events = decodeHookPayload({
      hook_event_name: "SubagentStop",
      session_id: "s1",
      transcript_path: "/tmp/parent.jsonl",
      agent_transcript_path: "/tmp/parent/subagents/child.jsonl",
    });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("sessionEnd");
  });

  test("Stop", () => {
    const events = decodeHookPayload(makePayload({ hook_event_name: "Stop" }));
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("activityEnd");
  });

  test("StopFailure", () => {
    const events = decodeHookPayload(makePayload({ hook_event_name: "StopFailure", error: "timeout" }));
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("activityEnd");
    expect(events[1].type).toBe("waiting");
    if (events[1].type === "waiting") {
      expect(events[1].reason).toBe("api_error:timeout");
    }
  });

  test("PermissionDenied", () => {
    const events = decodeHookPayload(makePayload({ hook_event_name: "PermissionDenied", tool_use_id: "tu-1" }));
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("activityEnd");
    if (events[0].type === "activityEnd") {
      expect(events[0].toolUseId).toBe("tu-1");
    }
  });

  test("PostToolUseFailure", () => {
    const events = decodeHookPayload(makePayload({ hook_event_name: "PostToolUseFailure", tool_use_id: "tu-1" }));
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("activityEnd");
  });

  test("PreCompact and PostCompact", () => {
    const pre = decodeHookPayload(makePayload({ hook_event_name: "PreCompact" }));
    expect(pre[0].type).toBe("activityEnd");
    const post = decodeHookPayload(makePayload({ hook_event_name: "PostCompact" }));
    expect(post[0].type).toBe("activityEnd");
  });

  test("Rename emits rename event", () => {
    const events = decodeHookPayload(makePayload({ hook_event_name: "Rename", label: "oc·my-project" }));
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("rename");
    if (events[0].type === "rename") {
      expect(events[0].label).toBe("oc·my-project");
    }
  });

  test("Rename without label throws", () => {
    expect(() =>
      decodeHookPayload(makePayload({ hook_event_name: "Rename" })),
    ).toThrow("missing label");
  });

  test("unknown event name throws", () => {
    expect(() =>
      decodeHookPayload(makePayload({ hook_event_name: "Nonsense" })),
    ).toThrow("unsupported hook_event_name");
  });

  test("missing hook_event_name throws", () => {
    expect(() =>
      decodeHookPayload({ session_id: "s1", transcript_path: "/tmp/t.jsonl" } as Record<string, unknown>),
    ).toThrow("missing hook_event_name");
  });
});
