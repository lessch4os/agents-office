import { AgentId } from "./agent-id";
import { AgentEvent } from "./types";
import { lookupContextLimit } from "./pricing";

export type OcSseEvent = {
  type: string;
  properties: Record<string, unknown>;
};

// ── SSE decoder interface ──────────────────────────────────────────

export interface OcSseDecoder {
  eventType: string;
  decode(agentId: AgentId, source: string, event: OcSseEvent, label: string): AgentEvent[];
}

// ── Individual SSE decoders ────────────────────────────────────────

const sessionCreatedDecoder: OcSseDecoder = {
  eventType: "session.created",
  decode(agentId, source, event, label) {
    const props = event.properties;
    const sessionId = extractSessionIdFromProps(props);
    const cwd = typeof props.directory === "string" ? props.directory : "";
    const modelId = extractModelIdFromProps(props);
    return [
      {
        type: "sessionStart",
        agentId,
        source,
        sessionId,
        cwd,
        parentId: null,
        agentType: "opencode",
        contextWindowLimit: lookupContextLimit(modelId),
      },
      { type: "rename", agentId, label },
    ];
  },
};

const sessionDeletedDecoder: OcSseDecoder = {
  eventType: "session.deleted",
  decode(_agentId, _source, _event, _label) {
    return [{ type: "sessionEnd", agentId: _agentId }];
  },
};

const sessionErrorDecoder: OcSseDecoder = {
  eventType: "session.error",
  decode(_agentId, _source, _event, _label) {
    return [{ type: "activityEnd", agentId: _agentId, toolUseId: null }];
  },
};

// ── Registry ───────────────────────────────────────────────────────

const sseDecoders = new Map<string, OcSseDecoder>([
  [sessionCreatedDecoder.eventType, sessionCreatedDecoder],
  [sessionDeletedDecoder.eventType, sessionDeletedDecoder],
  [sessionErrorDecoder.eventType, sessionErrorDecoder],
]);

export function registerOcSseDecoder(decoder: OcSseDecoder): void {
  sseDecoders.set(decoder.eventType, decoder);
}

// ── Dispatch ───────────────────────────────────────────────────────

export function decodeOcEvent(
  agentId: AgentId,
  source: string,
  event: OcSseEvent,
  label: string,
): AgentEvent[] {
  const decoder = sseDecoders.get(event.type);
  if (decoder) {
    return decoder.decode(agentId, source, event, label);
  }
  return [];
}

// ── Extractors (reusable by watcher) ───────────────────────────────

export function ocDeriveLabel(cwd: string): string {
  const normalized = cwd.replace(/\/+$/, "");
  const idx = normalized.lastIndexOf("/");
  const base = idx >= 0 ? normalized.slice(idx + 1) : normalized;
  if (base && base !== "/") return `oc\u00b7${base}`;
  return "oc";
}

export function extractSessionId(event: OcSseEvent): string | null {
  const props = event.properties;
  if (!props || typeof props !== "object") return null;

  const id = extractSessionIdFromProps(props);
  if (id) return id;

  const info = props.info as Record<string, unknown> | undefined;
  if (info && typeof info === "object") {
    const sid = info.sessionID;
    if (typeof sid === "string" && sid.length > 0) return sid;
    const infoId = info.id;
    if (typeof infoId === "string" && infoId.length > 0) return infoId;
  }

  return null;
}

export function extractTokensFromEvent(event: OcSseEvent): {
  input: number;
  output: number;
} | null {
  const props = event.properties;
  if (!props || typeof props !== "object") return null;

  const info = props.info as Record<string, unknown> | undefined;
  if (info && typeof info === "object") {
    const tokens = info.tokens as Record<string, unknown> | undefined;
    if (tokens && typeof tokens === "object") {
      const input = typeof tokens.input === "number" ? tokens.input : 0;
      const output = typeof tokens.output === "number" ? tokens.output : 0;
      if (input > 0 || output > 0) return { input, output };
    }
  }

  const part = props.part as Record<string, unknown> | undefined;
  if (part && typeof part === "object") {
    const tokens = part.tokens as Record<string, unknown> | undefined;
    if (tokens && typeof tokens === "object") {
      const input = typeof tokens.input === "number" ? tokens.input : 0;
      const output = typeof tokens.output === "number" ? tokens.output : 0;
      if (input > 0 || output > 0) return { input, output };
    }
  }

  return null;
}

export function extractModelIdFromEvent(event: OcSseEvent): string | null {
  const props = event.properties;
  if (!props || typeof props !== "object") return null;
  return extractModelIdFromProps(props);
}

function extractSessionIdFromProps(props: Record<string, unknown>): string | null {
  const id = props.id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

function extractModelIdFromProps(props: Record<string, unknown>): string | null {
  const info = props.info as Record<string, unknown> | undefined;
  if (info && typeof info === "object") {
    const modelId = info.modelID;
    if (typeof modelId === "string" && modelId.length > 0) return modelId;
  }
  return null;
}
