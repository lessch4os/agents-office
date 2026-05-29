import { AgentId } from "./agent-id";
import { AgentEvent, EventHandler } from "./types";
import type { Logger } from "./logger";
import { decodeOcEvent, ocDeriveLabel, OcSseEvent, extractSessionId, extractTokensFromEvent, extractModelIdFromEvent } from "./opencode-sse-decoder";

const RECONNECT_DELAY_MS = 5000;

type SdkEventStream = {
  stream: AsyncIterable<OcSseEvent>;
};

type SessionRecord = {
  agentId: AgentId;
  cwd: string;
  label: string;
  prevInputTokens: number;
  prevOutputTokens: number;
  modelId: string | null;
};

export class OpenCodeSseWatcher {
  private closed = false;
  private abortController: AbortController | null = null;

  constructor(
    private baseUrl: string,
    private source: string,
    private emit: EventHandler,
    private log: Logger,
  ) {}

  async run(): Promise<void> {
    while (!this.closed) {
      try {
        await this.connectAndStream();
      } catch (e) {
        if (this.closed) break;
        this.log.warn(`[opencode-sse] connection failed: ${e}. retrying in ${RECONNECT_DELAY_MS}ms`);
        await sleep(RECONNECT_DELAY_MS);
      }
    }
  }

  private async connectAndStream(): Promise<void> {
    const { createOpencodeClient } = await tryImportSdk();
    if (!createOpencodeClient) {
      this.log.warn("[opencode-sse] @opencode-ai/sdk not available. skipping SSE watcher.");
      await sleep(RECONNECT_DELAY_MS * 6);
      return;
    }

    this.log.verbose(`[opencode-sse] connecting to ${this.baseUrl}`);

    const client = createOpencodeClient({ baseUrl: this.baseUrl });
    this.abortController = new AbortController();

    const events: SdkEventStream = await client.event.subscribe();
    this.log.info(`[opencode-sse] connected to ${this.baseUrl}`);

    const sessions = new Map<string, SessionRecord>();

    for await (const event of events.stream) {
      if (this.closed) break;

      const sessionId = extractSessionId(event);
      if (!sessionId) continue;

      let record = sessions.get(sessionId);
      if (!record) {
        const cwd = extractCwd(event) ?? "";
        const label = ocDeriveLabel(cwd);
        record = {
          agentId: AgentId.fromParts(this.source, sessionId),
          cwd,
          label,
          prevInputTokens: 0,
          prevOutputTokens: 0,
          modelId: null,
        };
        sessions.set(sessionId, record);
      }

      // Handle token events — compute delta from last known values
      if (event.type === "message.updated" || event.type === "message.part.updated") {
        const tokens = extractTokensFromEvent(event);
        if (tokens) {
          const inputDelta = Math.max(0, tokens.input - record.prevInputTokens);
          const outputDelta = Math.max(0, tokens.output - record.prevOutputTokens);
          record.prevInputTokens = tokens.input;
          record.prevOutputTokens = tokens.output;
          if (inputDelta > 0 || outputDelta > 0) {
            this.emit("jsonl", {
              type: "tokenUsage",
              agentId: record.agentId,
              input: tokens.input,
              output: tokens.output,
              cumulative: true,
            });
          }
        }

        // Check for model ID update and emit a new contextWindowLimit if changed
        const modelId = extractModelIdFromEvent(event);
        if (modelId && modelId !== record.modelId) {
          record.modelId = modelId;
        }
      }

      // Decode state-change events through the pure decoder
      const evts = decodeOcEvent(record.agentId, this.source, event, record.label);
      for (const ev of evts) {
        this.emit("jsonl", ev);
      }

      if (event.type === "session.deleted") {
        sessions.delete(sessionId);
      }
    }
  }

  close(): void {
    this.closed = true;
    this.abortController?.abort();
  }
}

function extractCwd(event: OcSseEvent): string | null {
  const props = event.properties;
  if (!props || typeof props !== "object") return null;
  const directory = (props as Record<string, unknown>).directory;
  return typeof directory === "string" && directory.length > 0 ? directory : null;
}

async function tryImportSdk(): Promise<{ createOpencodeClient: Function | null }> {
  try {
    const mod = await import("@opencode-ai/sdk");
    const fn = (mod as Record<string, unknown>).createOpencodeClient;
    return { createOpencodeClient: typeof fn === "function" ? fn : null };
  } catch {
    return { createOpencodeClient: null };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
