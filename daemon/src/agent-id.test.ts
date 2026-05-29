import { describe, test, expect } from "bun:test";
import { AgentId } from "./agent-id";

describe("AgentId", () => {
  test("fromTranscriptPath is deterministic", () => {
    const path = "/Users/me/.claude/projects/x/abc.jsonl";
    const a = AgentId.fromTranscriptPath(path);
    const b = AgentId.fromTranscriptPath(path);
    expect(a.equals(b)).toBe(true);
    expect(a.toNumber()).toBe(b.toNumber());
  });

  test("fromTranscriptPath differs per path", () => {
    const a = AgentId.fromTranscriptPath("/Users/me/.claude/projects/x/abc.jsonl");
    const b = AgentId.fromTranscriptPath("/Users/me/.claude/projects/x/def.jsonl");
    expect(a.equals(b)).toBe(false);
  });

  test("toString is 16-char hex", () => {
    const id = AgentId.fromTranscriptPath("x");
    expect(id.toString().length).toBe(16);
  });

  test("fromParts distinguishes source and opaque", () => {
    const cc = AgentId.fromParts("claude-code", "session-123");
    const cx = AgentId.fromParts("codex", "session-123");
    expect(cc.equals(cx)).toBe(false);
  });

  test("fromParts has domain separator", () => {
    const a = AgentId.fromParts("a", "bc");
    const b = AgentId.fromParts("ab", "c");
    expect(a.equals(b)).toBe(false);
  });

  test("fromTranscriptPath routes through fromParts", () => {
    const a = AgentId.fromTranscriptPath("/x.jsonl");
    const b = AgentId.fromParts("claude-code", "/x.jsonl");
    expect(a.equals(b)).toBe(true);
  });
});
