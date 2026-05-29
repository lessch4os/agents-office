import * as net from "net";
import * as fs from "fs";
import { decodeHookPayload } from "./decoder";
import type { EventHandler } from "./types";
import type { Logger } from "./logger";

const MAX_CONCURRENT_CONNS = 128;
// No idle timeout — the plugin manages its own connection lifecycle.
// An aggressive timeout (e.g. 1s) kills connections during normal gaps
// between events (tool execute → LLM thinking → step-finish), causing
// the plugin to lose its socket mid-session.
const CONN_TIMEOUT_MS = 0;

export class HookSocketListener {
  private server: net.Server | null = null;
  private activeConns = 0;

  private constructor(
    public readonly path: string,
    private logger: Logger,
  ) {}

  static async bind(path: string, logger?: Logger): Promise<HookSocketListener> {
    try {
      await fs.promises.unlink(path);
    } catch {
      // Socket doesn't exist — that's fine
    }
    return new Promise<HookSocketListener>((resolve, reject) => {
      const server = net.createServer();
      const listener = new HookSocketListener(path, logger ?? { verbose: () => {}, info: console.log, warn: console.warn, error: console.error });
      listener.server = server;
      server.on("error", reject);
      server.listen(path, () => resolve(listener));
    });
  }

  run(emit: EventHandler, storeRaw?: (sessionId: string, source: string, hookEvent: string, payload: Record<string, unknown>) => void): void {
    if (!this.server) throw new Error("HookSocketListener not bound");
    this.server.on("connection", (socket) => {
      if (this.activeConns >= MAX_CONCURRENT_CONNS) {
        socket.destroy();
        return;
      }
      this.activeConns++;
      this.logger.verbose(`[hook] connection (active=${this.activeConns})`);
      if (CONN_TIMEOUT_MS > 0) {
        socket.setTimeout(CONN_TIMEOUT_MS, () => socket.destroy());
      }

      let buffer = "";
      socket.on("data", (data: Buffer) => {
        buffer += data.toString("utf-8");
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          let parsed: Record<string, unknown>;
          try {
            parsed = JSON.parse(trimmed);
          } catch (e) {
            this.logger.warn("malformed hook line skipped:", e);
            continue;
          }

          const event = parsed["hook_event_name"] as string | undefined;
          const sessionId = parsed["session_id"] as string | undefined;
          const toolName = parsed["tool_name"] as string | undefined;
          const shortSession = sessionId ? (sessionId.length > 16 ? sessionId.slice(0, 16) + "…" : sessionId) : "?";
          this.logger.verbose(`[hook] ${event ?? "?"} session=${shortSession}${toolName ? ` tool=${toolName}` : ""}`);

          if (storeRaw && sessionId && event) {
            const source = (parsed["source"] as string) ?? "unknown";
            storeRaw(sessionId, Date.now(), source, event, parsed);
          }

          try {
            const decoded = decodeHookPayload(parsed);
            this.logger.verbose(`[hook] → ${decoded.map((e) => e.type).join(", ")} session=${sessionId ?? "?"}`);
            for (const ev of decoded) {
              emit("hook", ev);
            }
          } catch (e) {
            this.logger.warn("hook decode error:", e);
          }
        }
      });

      socket.on("close", () => {
        this.activeConns--;
      });

      socket.on("error", () => {
        this.activeConns--;
      });
    });
  }

  close(): void {
    this.server?.close();
    const _ = this.path;
  }
}
