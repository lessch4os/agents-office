import { describe, test, expect } from "bun:test";
import { decodeCcLine, ccSessionEnded, ccDeriveLabel } from "./claude-code";

describe("decodeCcLine", () => {
  const transcriptPath = "/tmp/projects/repo/abc.jsonl";
  const source = "claude-code";

  function ccLine(overrides: Record<string, unknown>): Record<string, unknown> {
    return {
      type: "assistant",
      message: { content: [] },
      ...overrides,
    };
  }

  test("assistant message with tool_use block", () => {
    const events = decodeCcLine(transcriptPath, source, ccLine({
      message: {
        content: [
          { type: "tool_use", id: "tu-1", name: "Bash", input: { command: "ls" } },
        ],
      },
    }));
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("activityStart");
    if (events[0].type === "activityStart") {
      expect(events[0].toolUseId).toBe("tu-1");
      expect(events[0].activity).toBe("typing");
      expect(events[0].detail).toEqual({
        type: "generic",
        toolName: "Bash",
        display: "Bash: ls",
      });
    }
  });

  test("assistant message with token usage", () => {
    const events = decodeCcLine(transcriptPath, source, ccLine({
      message: {
        content: [],
        usage: { input_tokens: 200, output_tokens: 30 },
      },
    }));
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("tokenUsage");
    if (events[0].type === "tokenUsage") {
      expect(events[0].input).toBe(200);
      expect(events[0].output).toBe(30);
    }
  });

  test("multiple tool_use blocks", () => {
    const events = decodeCcLine(transcriptPath, source, ccLine({
      message: {
        content: [
          { type: "tool_use", id: "tu-1", name: "Bash", input: { command: "ls" } },
          { type: "tool_use", id: "tu-2", name: "Read", input: { file_path: "src/main.ts" } },
        ],
      },
    }));
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("activityStart");
    expect(events[1].type).toBe("activityStart");
  });

  test("user message with tool_result block", () => {
    const events = decodeCcLine(transcriptPath, source, {
      type: "user",
      message: {
        content: [
          { type: "tool_result", tool_use_id: "tu-1" },
        ],
      },
    });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("activityEnd");
    if (events[0].type === "activityEnd") {
      expect(events[0].toolUseId).toBe("tu-1");
    }
  });

  test("attributionAgent triggers rename", () => {
    const events = decodeCcLine(transcriptPath, source, ccLine({
      attributionAgent: "feature-dev:code-explorer",
    }));
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("rename");
    if (events[0].type === "rename") {
      expect(events[0].label).toBe("code-explorer");
    }
  });

  test("empty message returns empty", () => {
    const events = decodeCcLine(transcriptPath, source, {});
    expect(events).toHaveLength(0);
  });

  test("non-object returns empty", () => {
    const events = decodeCcLine(transcriptPath, source, "string" as unknown as Record<string, unknown>);
    expect(events).toHaveLength(0);
  });
});

describe("ccSessionEnded", () => {
  function toBytes(s: string): Uint8Array {
    return new TextEncoder().encode(s);
  }

  test("session_end marker returns true", () => {
    const tail = JSON.stringify({ subtype: "session_end" });
    expect(ccSessionEnded(toBytes(tail))).toBe(true);
  });

  test("hook SessionEnd returns true", () => {
    const tail = JSON.stringify({ hook_event_name: "SessionEnd" });
    expect(ccSessionEnded(toBytes(tail))).toBe(true);
  });

  test("session_start without end returns false", () => {
    const tail = JSON.stringify({ subtype: "session_start" });
    expect(ccSessionEnded(toBytes(tail))).toBe(false);
  });

  test("multiple lines checks last", () => {
    const tail = [
      JSON.stringify({ subtype: "session_end" }),
      JSON.stringify({ subtype: "session_start" }),
    ].join("\n");
    expect(ccSessionEnded(toBytes(tail))).toBe(false);
  });

  test("non-JSON tail returns false", () => {
    expect(ccSessionEnded(toBytes("not json"))).toBe(false);
  });

  test("empty tail returns false", () => {
    expect(ccSessionEnded(toBytes(""))).toBe(false);
  });
});

describe("ccDeriveLabel", () => {
  test("subagent path returns subagent", () => {
    expect(ccDeriveLabel("/repo/subagents/child.jsonl", "/repo")).toBe("subagent");
  });

  test("valid cwd returns cc·basename", () => {
    expect(ccDeriveLabel("/repo/abc.jsonl", "/Users/me/project")).toBe("cc·project");
  });

  test("empty cwd returns cc", () => {
    expect(ccDeriveLabel("/repo/abc.jsonl", "")).toBe("cc");
  });

  test("root cwd returns cc", () => {
    expect(ccDeriveLabel("/repo/abc.jsonl", "/")).toBe("cc");
  });
});
