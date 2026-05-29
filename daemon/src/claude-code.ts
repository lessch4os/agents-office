import { basename } from "path";
import { AgentId } from "./agent-id";
import { AgentEvent, Activity } from "./types";
import { describeToolTarget, makeToolDetail } from "./decoder";

// ── CC block decoder interface ─────────────────────────────────────

export interface CcBlockDecoder {
  blockType: string;
  decode(block: Record<string, unknown>, agentId: AgentId, source: string): AgentEvent[];
}

// ── Individual block decoders ──────────────────────────────────────

const toolUseDecoder: CcBlockDecoder = {
  blockType: "tool_use",
  decode(block, agentId) {
    const id = typeof block["id"] === "string" ? block["id"] as string : undefined;
    const name = typeof block["name"] === "string" ? block["name"] as string : "?";
    const input = block["input"];

    const target = describeToolTarget(name, input);
    return [{
      type: "activityStart" as const,
      agentId,
      activity: "typing" as Activity,
      toolUseId: id ?? null,
      detail: makeToolDetail(name, target),
    }];
  },
};

const toolResultDecoder: CcBlockDecoder = {
  blockType: "tool_result",
  decode(block, agentId) {
    const id = typeof block["tool_use_id"] === "string" ? block["tool_use_id"] as string : undefined;
    return [{
      type: "activityEnd" as const,
      agentId,
      toolUseId: id ?? null,
    }];
  },
};

// ── Registry ───────────────────────────────────────────────────────

const blockDecoders = new Map<string, CcBlockDecoder>([
  [toolUseDecoder.blockType, toolUseDecoder],
  [toolResultDecoder.blockType, toolResultDecoder],
]);

export function registerCcBlockDecoder(decoder: CcBlockDecoder): void {
  blockDecoders.set(decoder.blockType, decoder);
}

// ── Token usage extraction ─────────────────────────────────────────

function extractTokenUsage(usageObj: Record<string, unknown>, agentId: AgentId): AgentEvent | null {
  const rawInput = typeof usageObj["input_tokens"] === "number" ? (usageObj["input_tokens"] as number) : 0;
  const cacheRead = typeof usageObj["cache_read_input_tokens"] === "number" ? (usageObj["cache_read_input_tokens"] as number) : 0;
  const input = Math.max(0, rawInput - cacheRead);
  const output = typeof usageObj["output_tokens"] === "number" ? (usageObj["output_tokens"] as number) : 0;
  if (input === 0 && output === 0) return null;

  const tokenEvent: { type: "tokenUsage"; agentId: AgentId; input: number; output: number; cacheRead?: number } = {
    type: "tokenUsage", agentId, input, output,
  };
  if (cacheRead > 0) tokenEvent.cacheRead = cacheRead;
  return tokenEvent;
}

// ── Line decoder ───────────────────────────────────────────────────

export function decodeCcLine(
  transcriptPath: string,
  source: string,
  json: Record<string, unknown>,
): AgentEvent[] {
  const agentId = AgentId.fromParts(source, transcriptPath);
  const out: AgentEvent[] = [];

  const attribution = json["attributionAgent"];
  if (typeof attribution === "string") {
    const label = attribution.split(":").pop() ?? attribution;
    out.push({ type: "rename", agentId, label });
  }

  const message = json["message"];
  if (!message || typeof message !== "object" || Array.isArray(message)) return out;
  const msgObj = message as Record<string, unknown>;

  const ty = json["type"];
  const content = msgObj["content"];

  if (ty === "assistant" && Array.isArray(content)) {
    // Extract token usage from assistant message
    const usage = msgObj["usage"];
    if (usage && typeof usage === "object" && !Array.isArray(usage)) {
      const tokenEvent = extractTokenUsage(usage as Record<string, unknown>, agentId);
      if (tokenEvent) out.push(tokenEvent);
    }

    // Decode content blocks
    for (const block of content) {
      if (!block || typeof block !== "object" || Array.isArray(block)) continue;
      const bobj = block as Record<string, unknown>;
      const btype = bobj["type"];
      if (typeof btype !== "string") continue;

      const decoder = blockDecoders.get(btype);
      if (decoder) {
        out.push(...decoder.decode(bobj, agentId, source));
      }
    }
  } else if (ty === "user" && Array.isArray(content)) {
    for (const block of content) {
      if (!block || typeof block !== "object" || Array.isArray(block)) continue;
      const bobj = block as Record<string, unknown>;
      const btype = bobj["type"];
      if (typeof btype !== "string") continue;

      const decoder = blockDecoders.get(btype);
      if (decoder) {
        out.push(...decoder.decode(bobj, agentId, source));
      }
    }
  }

  return out;
}

// ── Session-ended checker ──────────────────────────────────────────

export function ccSessionEnded(tail: Uint8Array): boolean {
  const text = new TextDecoder().decode(tail);
  let lastIsEnd = false;

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (typeof parsed !== "object" || Array.isArray(parsed)) continue;

    const subtype = parsed["subtype"];
    const hook = parsed["hook_event_name"];

    if (subtype === "session_start") lastIsEnd = false;
    if (subtype === "session_end" || hook === "SessionEnd") lastIsEnd = true;
  }

  return lastIsEnd;
}

// ── Label deriver ──────────────────────────────────────────────────

export function ccDeriveLabel(path: string, cwd: string): string {
  const isSubagent = path.includes("subagents");
  if (isSubagent) return "subagent";

  const base = basename(cwd);
  if (base && base !== "/") {
    return `cc\u00b7${base}`;
  }
  return "cc";
}


