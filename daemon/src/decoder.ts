import { AgentId } from "./agent-id";
import { AgentEvent, Activity, ToolDetail } from "./types";

// ── Helpers ────────────────────────────────────────────────────────

export function getStr(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  return typeof v === "string" ? v : undefined;
}

export function getObj(obj: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const v = obj[key];
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return undefined;
}

export function getNum(obj: Record<string, unknown>, key: string): number | undefined {
  const v = obj[key];
  return typeof v === "number" ? v : undefined;
}

// ── Hook decode context ────────────────────────────────────────────

export type HookDecodeCtx = {
  agentId: AgentId;
  source: string;
  sessionId: string;
  transcriptPath: string;
  agentType: string | null;
};

function makeCtx(v: Record<string, unknown>): HookDecodeCtx {
  const sessionId = getStr(v, "session_id")!;
  const transcriptPath = getStr(v, "transcript_path")!;
  const agentType = getStr(v, "agent_type") ?? null;
  const source = getStr(v, "source") ?? (agentType === "opencode" ? "opencode" : "claude-code");
  const agentId = AgentId.fromParts(source, transcriptPath);
  return { agentId, source, sessionId, transcriptPath, agentType };
}

// ── Hook decoder interface ─────────────────────────────────────────

export interface HookDecoder {
  eventName: string;
  decode(v: Record<string, unknown>, ctx: HookDecodeCtx): AgentEvent[];
}

// ── Individual decoders ────────────────────────────────────────────

const sessionStartDecoder: HookDecoder = {
  eventName: "SessionStart",
  decode(v, ctx) {
    const cwd = getStr(v, "cwd") ?? "";
    const contextWindowLimit = getNum(v, "context_window_limit");
    const parentSessionId = getStr(v, "parent_session_id");
    const machineName = getStr(v, "machine_name");
    return [{
      type: "sessionStart" as const,
      agentId: ctx.agentId,
      source: ctx.source,
      sessionId: ctx.sessionId,
      cwd,
      parentId: null,
      parentSessionId,
      agentType: ctx.agentType,
      contextWindowLimit,
      machineName: machineName ?? undefined,
    }];
  },
};

const preToolUseDecoder: HookDecoder = {
  eventName: "PreToolUse",
  decode(v, ctx) {
    const toolName = getStr(v, "tool_name") ?? "?";
    const target = describeToolTarget(toolName, v["tool_input"]);
    const toolUseId = getStr(v, "tool_use_id") ?? null;
    return [{
      type: "activityStart" as const,
      agentId: ctx.agentId,
      activity: "typing" as Activity,
      toolUseId,
      detail: makeToolDetail(toolName, target),
    }];
  },
};

const postToolUseDecoder: HookDecoder = {
  eventName: "PostToolUse",
  decode(v, ctx) {
    const toolUseId = getStr(v, "tool_use_id") ?? null;
    const events: AgentEvent[] = [
      { type: "activityEnd" as const, agentId: ctx.agentId, toolUseId },
    ];
    const usage = getObj(v, "usage");
    if (usage) {
      const rawInput = getNum(usage, "input_tokens") ?? 0;
      const cacheRead = getNum(usage, "cache_read_input_tokens") ?? 0;
      const input = Math.max(0, rawInput - cacheRead);
      const output = getNum(usage, "output_tokens") ?? 0;
      if (input > 0 || output > 0) {
        const tokenEvent: { type: "tokenUsage"; agentId: AgentId; input: number; output: number; cacheRead?: number } = { type: "tokenUsage", agentId: ctx.agentId, input, output };
        if (cacheRead > 0) tokenEvent.cacheRead = cacheRead;
        events.push(tokenEvent);
      }
    }
    return events;
  },
};

const notificationDecoder: HookDecoder = {
  eventName: "Notification",
  decode(v, ctx) {
    const msg = getStr(v, "message") ?? "waiting";
    return [{ type: "waiting" as const, agentId: ctx.agentId, reason: msg }];
  },
};

const tokenUpdateDecoder: HookDecoder = {
  eventName: "TokenUpdate",
  decode(v, ctx) {
    const usage = getObj(v, "usage");
    if (!usage) return [];
    const rawInput = getNum(usage, "input_tokens") ?? 0;
    const cacheRead = getNum(usage, "cache_read_input_tokens") ?? 0;
    const input = Math.max(0, rawInput - cacheRead);
    const output = getNum(usage, "output_tokens") ?? 0;
    if (input <= 0 && output <= 0) return [];
    const total = getNum(usage, "total_tokens") ?? undefined;
    const tokenEvent: { type: "tokenUsage"; agentId: AgentId; input: number; output: number; cacheRead?: number; cumulative?: boolean; total?: number } = { type: "tokenUsage", agentId: ctx.agentId, input, output, cumulative: true };
    if (cacheRead > 0) tokenEvent.cacheRead = cacheRead;
    if (total !== undefined) tokenEvent.total = total;
    return [tokenEvent];
  },
};

const sessionEndDecoder: HookDecoder = {
  eventName: "SessionEnd",
  decode(_v, ctx) {
    return [{ type: "sessionEnd" as const, agentId: ctx.agentId }];
  },
};

const renameDecoder: HookDecoder = {
  eventName: "Rename",
  decode(v, ctx) {
    const label = getStr(v, "label");
    if (!label) throw new Error("missing label");
    return [{ type: "rename" as const, agentId: ctx.agentId, label }];
  },
};

const subagentStartDecoder: HookDecoder = {
  eventName: "SubagentStart",
  decode() {
    return [];
  },
};

const subagentStopDecoder: HookDecoder = {
  eventName: "SubagentStop",
  decode(v, ctx) {
    const agentTranscriptPath = getStr(v, "agent_transcript_path");
    if (!agentTranscriptPath) throw new Error("missing agent_transcript_path");
    const subId = AgentId.fromParts(ctx.source, agentTranscriptPath);
    return [{ type: "sessionEnd" as const, agentId: subId }];
  },
};

const stopDecoder: HookDecoder = {
  eventName: "Stop",
  decode(_v, ctx) {
    return [{ type: "activityEnd" as const, agentId: ctx.agentId, toolUseId: null }];
  },
};

const stopFailureDecoder: HookDecoder = {
  eventName: "StopFailure",
  decode(v, ctx) {
    const err = getStr(v, "error") ?? "unknown";
    return [
      { type: "activityEnd" as const, agentId: ctx.agentId, toolUseId: null },
      { type: "waiting" as const, agentId: ctx.agentId, reason: `api_error:${err}` },
    ];
  },
};

const permissionDeniedDecoder: HookDecoder = {
  eventName: "PermissionDenied",
  decode(v, ctx) {
    const toolUseId = getStr(v, "tool_use_id") ?? null;
    return [{ type: "activityEnd" as const, agentId: ctx.agentId, toolUseId }];
  },
};

const postToolUseFailureDecoder: HookDecoder = {
  eventName: "PostToolUseFailure",
  decode(v, ctx) {
    const toolUseId = getStr(v, "tool_use_id") ?? null;
    return [{ type: "activityEnd" as const, agentId: ctx.agentId, toolUseId }];
  },
};

const modelUpdateDecoder: HookDecoder = {
  eventName: "ModelUpdate",
  decode(v, ctx) {
    const modelId = getStr(v, "model_id");
    if (!modelId) return [];
    const contextWindowLimit = getNum(v, "context_window_limit");
    return [{
      type: "modelUpdate" as const,
      agentId: ctx.agentId,
      modelId,
      contextWindowLimit,
    }];
  },
};

const preCompactDecoder: HookDecoder = {
  eventName: "PreCompact",
  decode(_v, ctx) {
    return [{ type: "activityEnd" as const, agentId: ctx.agentId, toolUseId: null }];
  },
};

const postCompactDecoder: HookDecoder = {
  eventName: "PostCompact",
  decode(_v, ctx) {
    return [{ type: "activityEnd" as const, agentId: ctx.agentId, toolUseId: null }];
  },
};

// TokenDebug is a no-op for the daemon — the raw_events table
// already stores the full payload via hook-socket.ts storeRawEvent.
// This decoder prevents "unsupported hook_event_name" warnings
// and allows PluginAuthorizer queries against raw_events.
const tokenDebugDecoder: HookDecoder = {
  eventName: "TokenDebug",
  decode() {
    return [];
  },
};

// ── Registry ───────────────────────────────────────────────────────

const hookDecoders = new Map<string, HookDecoder>([
  [sessionStartDecoder.eventName, sessionStartDecoder],
  [preToolUseDecoder.eventName, preToolUseDecoder],
  [postToolUseDecoder.eventName, postToolUseDecoder],
  [notificationDecoder.eventName, notificationDecoder],
  [tokenUpdateDecoder.eventName, tokenUpdateDecoder],
  [sessionEndDecoder.eventName, sessionEndDecoder],
  [renameDecoder.eventName, renameDecoder],
  [subagentStartDecoder.eventName, subagentStartDecoder],
  [subagentStopDecoder.eventName, subagentStopDecoder],
  [stopDecoder.eventName, stopDecoder],
  [stopFailureDecoder.eventName, stopFailureDecoder],
  [permissionDeniedDecoder.eventName, permissionDeniedDecoder],
  [postToolUseFailureDecoder.eventName, postToolUseFailureDecoder],
  [preCompactDecoder.eventName, preCompactDecoder],
  [postCompactDecoder.eventName, postCompactDecoder],
  [modelUpdateDecoder.eventName, modelUpdateDecoder],
  [tokenDebugDecoder.eventName, tokenDebugDecoder],
]);

export function registerHookDecoder(decoder: HookDecoder): void {
  hookDecoders.set(decoder.eventName, decoder);
}

// ── make_tool_detail ───────────────────────────────────────────────

export function makeToolDetail(toolName: string, target: string): ToolDetail {
  if (toolName === "Task" || toolName === "Agent") {
    return { type: "task" };
  }
  return { type: "generic", toolName, display: `${toolName}${target}` };
}

// ── describe_tool_target ───────────────────────────────────────────

export function describeToolTarget(tool: string, input: unknown): string {
  if (!input || typeof input !== "object" || Array.isArray(input)) return "";

  const key = matchToolTargetKey(tool);
  if (!key) return "";

  const v = (input as Record<string, unknown>)[key];
  if (typeof v !== "string") return "";

  const s = v;
  if (s.length === 0) return "";

  const truncated = s.length > 80 ? s.slice(0, 80) + "\u2026" : s;
  return `: ${truncated}`;
}

const toolTargetKeys = new Map<string, string>([
  ["Write", "file_path"],
  ["Edit", "file_path"],
  ["MultiEdit", "file_path"],
  ["Read", "file_path"],
  ["Bash", "command"],
  ["Grep", "pattern"],
  ["Glob", "pattern"],
]);

export function registerToolTargetKey(tool: string, key: string): void {
  toolTargetKeys.set(tool, key);
}

function matchToolTargetKey(tool: string): string | null {
  return toolTargetKeys.get(tool) ?? null;
}

// ── decode_hook_payload ────────────────────────────────────────────

export function decodeHookPayload(v: Record<string, unknown>): AgentEvent[] {
  const event = getStr(v, "hook_event_name");
  if (!event) throw new Error("missing hook_event_name");

  const sessionId = getStr(v, "session_id");
  if (!sessionId) throw new Error("missing session_id");

  const transcriptPath = getStr(v, "transcript_path");
  if (!transcriptPath) throw new Error("missing transcript_path");

  const decoder = hookDecoders.get(event);
  if (!decoder) throw new Error(`unsupported hook_event_name: ${event}`);

  return decoder.decode(v, makeCtx(v));
}
