import { describe, test, expect } from "bun:test";
import { decodeAgLine, agSessionEnded, deriveAgLabel } from "./antigravity";

describe("decodeAgLine", () => {
  const transcriptPath = "/tmp/brain/session-1.jsonl";
  const source = "antigravity";

  function agLine(overrides: Record<string, unknown>): Record<string, unknown> {
    return { step_index: 1, type: "PLANNER_RESPONSE", tool_calls: [], ...overrides };
  }

  test("PLANNER_RESPONSE with tool call", () => {
    const events = decodeAgLine(transcriptPath, source, agLine({
      type: "PLANNER_RESPONSE",
      step_index: 1,
      tool_calls: [
        { name: "run_command", args: { CommandLine: "ls" } },
      ],
    }));
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("activityStart");
    if (events[0].type === "activityStart") {
      expect(events[0].toolUseId).toBe("ag-1-0");
      expect(events[0].activity).toBe("typing");
    }
  });

  test("ask_permission generates waiting event", () => {
    const events = decodeAgLine(transcriptPath, source, agLine({
      step_index: 1,
      tool_calls: [{ name: "ask_permission" }],
    }));
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("waiting");
    if (events[0].type === "waiting") {
      expect(events[0].reason).toBe("asking permission");
    }
  });

  test("non-PLANNER step ends previous tool", () => {
    const events = decodeAgLine(transcriptPath, source, {
      step_index: 3,
      type: "TOOL_RESPONSE",
    });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("activityEnd");
    if (events[0].type === "activityEnd") {
      expect(events[0].toolUseId).toBe("ag-2-0");
    }
  });

  test("USER_INPUT and CONVERSATION_HISTORY are skipped", () => {
    const userInput = decodeAgLine(transcriptPath, source, {
      step_index: 2,
      type: "USER_INPUT",
    });
    expect(userInput).toHaveLength(0);

    const convHist = decodeAgLine(transcriptPath, source, {
      step_index: 2,
      type: "CONVERSATION_HISTORY",
    });
    expect(convHist).toHaveLength(0);
  });

  test("line without step_index returns empty", () => {
    const events = decodeAgLine(transcriptPath, source, { type: "irrelevant" });
    expect(events).toHaveLength(0);
  });

  test("multiple tool calls in one step", () => {
    const events = decodeAgLine(transcriptPath, source, agLine({
      step_index: 2,
      tool_calls: [
        { name: "read_file", args: { TargetFile: "a.ts" } },
        { name: "write_file", args: { TargetFile: "b.ts" } },
      ],
    }));
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("activityStart");
    expect(events[1].type).toBe("activityStart");
    if (events[0].type === "activityStart" && events[1].type === "activityStart") {
      expect(events[0].toolUseId).toBe("ag-2-0");
      expect(events[1].toolUseId).toBe("ag-2-1");
    }
  });
});

describe("agSessionEnded", () => {
  test("always returns false", () => {
    expect(agSessionEnded(new Uint8Array())).toBe(false);
    expect(agSessionEnded(new TextEncoder().encode("anything"))).toBe(false);
  });
});

describe("deriveAgLabel", () => {
  test("valid cwd returns ag·basename", () => {
    expect(deriveAgLabel("/Users/me/project")).toBe("ag·project");
  });

  test("empty cwd returns ag", () => {
    expect(deriveAgLabel("")).toBe("ag");
  });

  test("root cwd returns ag", () => {
    expect(deriveAgLabel("/")).toBe("ag");
  });
});
