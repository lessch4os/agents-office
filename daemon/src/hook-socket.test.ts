import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import * as net from "net";
import * as crypto from "crypto";
import { HookSocketListener } from "./hook-socket";
import type { AgentEvent, Transport } from "./types";

const SOCKET_PATH = `/tmp/test-hook-${crypto.randomUUID()}.sock`;

describe("HookSocketListener", () => {
  let listener: HookSocketListener;
  const received: Array<{ transport: Transport; event: AgentEvent }> = [];

  beforeAll(async () => {
    listener = await HookSocketListener.bind(SOCKET_PATH);
    listener.run((transport, event) => {
      received.push({ transport, event });
    });
  });

  afterAll(() => {
    listener.close();
  });

  test("accepts connection and decodes SessionStart", async () => {
    const payload = {
      hook_event_name: "SessionStart",
      session_id: "sess-1",
      transcript_path: "/tmp/test.jsonl",
      cwd: "/repo",
    };

    await sendPayload(payload);

    // Wait for async processing
    await Bun.sleep(100);

    expect(received.length).toBeGreaterThanOrEqual(1);
    const entry = received.find((r) => r.event.type === "sessionStart");
    expect(entry).toBeDefined();
    if (entry?.event.type === "sessionStart") {
      expect(entry.event.sessionId).toBe("sess-1");
      expect(entry.event.cwd).toBe("/repo");
    }
  });

  test("skips empty lines", async () => {
    const socket = net.createConnection(SOCKET_PATH);
    await new Promise<void>((resolve) => {
      socket.on("connect", () => {
        socket.write("\n\n");
        socket.end();
        resolve();
      });
    });
    await Bun.sleep(50);
    // Should not throw or add events
  });

  test("handles PreToolUse payload", async () => {
    const before = received.length;
    const payload = {
      hook_event_name: "PreToolUse",
      session_id: "sess-2",
      transcript_path: "/tmp/test2.jsonl",
      tool_name: "Bash",
      tool_input: { command: "ls -la" },
      tool_use_id: "tu-1",
    };

    await sendPayload(payload);
    await Bun.sleep(100);

    const newEntries = received.slice(before);
    const activityStart = newEntries.find((r) => r.event.type === "activityStart");
    expect(activityStart).toBeDefined();
  });
});

function sendPayload(payload: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(SOCKET_PATH, () => {
      socket.write(JSON.stringify(payload) + "\n");
      socket.end();
    });
    socket.on("error", reject);
    socket.on("close", resolve);
  });
}
