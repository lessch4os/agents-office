import { AgentId } from "./agent-id";

// ── Transport ──────────────────────────────────────────────────────

export type Transport = "hook" | "jsonl";

// ── Activity ───────────────────────────────────────────────────────

export type Activity = "typing" | "reading" | "thinking";

// ── ToolDetail ─────────────────────────────────────────────────────

export type ToolDetail =
  | { type: "task" }
  | { type: "generic"; toolName: string; display: string };

export function toolDetailDisplay(detail: ToolDetail): string {
  switch (detail.type) {
    case "task":
      return "Delegating";
    case "generic":
      return detail.display;
  }
}

export function toolDetailToolName(detail: ToolDetail): string | null {
  switch (detail.type) {
    case "task":
      return null;
    case "generic":
      return detail.toolName;
  }
}

export function toolDetailIsTask(detail: ToolDetail): boolean {
  return detail.type === "task";
}

// ── AgentEvent ─────────────────────────────────────────────────────

export type AgentEvent =
  | {
      type: "sessionStart";
      agentId: AgentId;
      source: string;
      sessionId: string;
      cwd: string;
      parentId: AgentId | null;
      parentSessionId?: string;
      agentType: string | null;
      contextWindowLimit?: number;
    }
  | {
      type: "activityStart";
      agentId: AgentId;
      activity: Activity;
      toolUseId: string | null;
      detail: ToolDetail | null;
    }
  | {
      type: "activityEnd";
      agentId: AgentId;
      toolUseId: string | null;
    }
  | {
      type: "waiting";
      agentId: AgentId;
      reason: string;
    }
  | {
      type: "rename";
      agentId: AgentId;
      label: string;
    }
  | {
      type: "tokenUsage";
      agentId: AgentId;
      input: number;
      output: number;
      cacheRead?: number;
      cumulative?: boolean;
      total?: number;
    }
  | {
      type: "sessionEnd";
      agentId: AgentId;
    }
  | {
      type: "modelUpdate";
      agentId: AgentId;
      modelId: string;
      contextWindowLimit?: number;
    };

export function eventAgentId(event: AgentEvent): AgentId {
  return event.agentId;
}

export function eventToolUseId(event: AgentEvent): string | null {
  switch (event.type) {
    case "activityStart":
      return event.toolUseId;
    case "activityEnd":
      return event.toolUseId;
    default:
      return null;
  }
}

// ── Tagged event ───────────────────────────────────────────────────

export interface TaggedEvent {
  transport: Transport;
  event: AgentEvent;
}

export type EventHandler = (transport: Transport, event: AgentEvent) => void;

// ── Wire log entry ───────────────────────────────────────────────

export type LogType = "tool_start" | "tool_result" | "thought" | "error" | "waiting";

export interface WireLogEntry {
  agent_id: number;
  timestamp_ms: number;
  tool_name: string | null;
  detail: string;
  log_type: LogType;
  truncated: boolean;
  tool_input?: string;
  duration_ms?: number;
}

function extractToolInput(toolName: string | null, display: string): string | undefined {
  if (!toolName) return undefined;
  const prefix = `${toolName}: `;
  if (display.startsWith(prefix)) {
    const input = display.slice(prefix.length);
    return input.length > 0 ? input : undefined;
  }
  return undefined;
}

export function eventToWireLogEntry(
  event: AgentEvent,
  agentIdNum: number,
  now: number,
  durationMs?: number,
): WireLogEntry | null {
  switch (event.type) {
    case "activityStart": {
      const toolName = event.detail ? toolDetailToolName(event.detail) : null;
      const display = event.detail ? toolDetailDisplay(event.detail) : event.activity;
      const toolInput = extractToolInput(toolName, display);
      return {
        agent_id: agentIdNum,
        timestamp_ms: now,
        tool_name: toolName,
        detail: toolInput ?? display,
        log_type: "tool_start",
        truncated: false,
        tool_input: toolInput,
      };
    }
    case "activityEnd": {
      return {
        agent_id: agentIdNum,
        timestamp_ms: now,
        tool_name: null,
        detail: "done",
        log_type: "tool_result",
        truncated: false,
        duration_ms: durationMs,
      };
    }
    case "waiting": {
      return {
        agent_id: agentIdNum,
        timestamp_ms: now,
        tool_name: null,
        detail: event.reason,
        log_type: "waiting",
        truncated: false,
      };
    }
    default:
      return null;
  }
}
