import { describe, it, expect } from "bun:test";
import { decodeOcEvent, ocDeriveLabel, extractTokensFromEvent, extractSessionId } from "./opencode-sse-decoder";
import { AgentId } from "./agent-id";

const SOURCE = "opencode";

function makeId(sessionId: string): AgentId {
  return AgentId.fromParts(SOURCE, sessionId);
}

describe("ocDeriveLabel", () => {
  it("returns oc·basename for a normal cwd", () => {
    expect(ocDeriveLabel("/home/user/my-project")).toBe("oc·my-project");
  });
  it("returns oc for root cwd", () => {
    expect(ocDeriveLabel("/")).toBe("oc");
  });
  it("returns oc for empty cwd", () => {
    expect(ocDeriveLabel("")).toBe("oc");
  });
});

describe("extractTokensFromEvent", () => {
  it("returns null for events without tokens", () => {
    const result = extractTokensFromEvent({
      type: "session.created",
      properties: { id: "sess-1" },
    });
    expect(result).toBeNull();
  });

  it("extracts tokens from message.updated", () => {
    const result = extractTokensFromEvent({
      type: "message.updated",
      properties: {
        info: {
          sessionID: "sess-1",
          role: "assistant",
          tokens: { input: 50000, output: 2000 },
        },
      },
    });
    expect(result).toEqual({ input: 50000, output: 2000 });
  });

  it("extracts tokens from message.part.updated", () => {
    const result = extractTokensFromEvent({
      type: "message.part.updated",
      properties: {
        part: {
          sessionID: "sess-1",
          type: "step-finish",
          tokens: { input: 30000, output: 1000 },
        },
      },
    });
    expect(result).toEqual({ input: 30000, output: 1000 });
  });

  it("returns null for message.updated without tokens", () => {
    const result = extractTokensFromEvent({
      type: "message.updated",
      properties: { info: { sessionID: "sess-1", role: "assistant" } },
    });
    expect(result).toBeNull();
  });

  it("returns null when both input and output are zero", () => {
    const result = extractTokensFromEvent({
      type: "message.updated",
      properties: {
        info: {
          sessionID: "sess-1",
          role: "assistant",
          tokens: { input: 0, output: 0 },
        },
      },
    });
    expect(result).toBeNull();
  });
});

describe("decodeOcEvent", () => {
  it("decodes session.created into sessionStart + rename", () => {
    const id = makeId("sess-1");
    const events = decodeOcEvent(id, SOURCE, {
      type: "session.created",
      properties: { id: "sess-1", directory: "/home/user/my-project" },
    }, "oc·my-project");
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("sessionStart");
    expect(events[1].type).toBe("rename");
  });
  it("decodes session.created with minimal props", () => {
    const id = makeId("sess-2");
    const events = decodeOcEvent(id, SOURCE, {
      type: "session.created",
      properties: { id: "sess-2" },
    }, "oc·");
    expect(events).toHaveLength(2);
  });
  it("decodes session.deleted into sessionEnd", () => {
    const id = makeId("sess-3");
    const events = decodeOcEvent(id, SOURCE, {
      type: "session.deleted",
      properties: { id: "sess-3" },
    }, "oc·x");
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("sessionEnd");
  });
  it("decodes session.error into activityEnd", () => {
    const id = makeId("sess-4");
    const events = decodeOcEvent(id, SOURCE, {
      type: "session.error",
      properties: { id: "sess-4" },
    }, "oc·x");
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("activityEnd");
  });
  it("returns empty array for unknown event types", () => {
    const id = makeId("sess-5");
    const events = decodeOcEvent(id, SOURCE, {
      type: "unknown.event",
      properties: { id: "sess-5" },
    }, "oc·x");
    expect(events).toHaveLength(0);
  });
});
