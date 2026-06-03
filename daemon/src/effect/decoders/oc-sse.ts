import type { AgentEvent } from "../schemas/agent-event"

export interface OcSseEvent {
  type: string
  properties: Record<string, unknown>
}

export function decodeOcEvent(
  agentId: number,
  source: string,
  event: OcSseEvent,
  label: string,
  lookupContextLimit: (modelId: string) => number,
): AgentEvent[] {
  switch (event.type) {
    case "session.created":
      return decodeSessionCreated(agentId, source, event, label, lookupContextLimit)
    case "session.deleted":
      return [{ type: "sessionEnd", agentId }]
    case "session.error":
      return [{ type: "activityEnd", agentId, toolUseId: undefined }]
    default:
      return []
  }
}

function decodeSessionCreated(
  agentId: number,
  source: string,
  event: OcSseEvent,
  label: string,
  lookupContextLimit: (modelId: string) => number,
): AgentEvent[] {
  const props = event.properties
  const sessionId = extractSessionIdFromProps(props)
  const cwd = typeof props.directory === "string" ? props.directory : ""
  const modelId = extractModelIdFromProps(props)
  return [
    {
      type: "sessionStart",
      agentId,
      source,
      sessionId,
      cwd,
      parentId: undefined,
      agentType: "opencode",
      contextWindowLimit: lookupContextLimit(modelId),
    },
    { type: "rename", agentId, label },
  ]
}

export function ocDeriveLabel(cwd: string): string {
  const normalized = cwd.replace(/\/+$/, "")
  const idx = normalized.lastIndexOf("/")
  const base = idx >= 0 ? normalized.slice(idx + 1) : normalized
  if (base && base !== "/") return `oc\u00b7${base}`
  return "oc"
}

export function extractSessionId(event: OcSseEvent): string | null {
  const props = event.properties
  if (!props || typeof props !== "object") return null
  const id = extractSessionIdFromProps(props)
  if (id) return id
  const info = props.info as Record<string, unknown> | undefined
  if (info && typeof info === "object") {
    const sid = info.sessionID
    if (typeof sid === "string" && sid.length > 0) return sid
    const infoId = info.id
    if (typeof infoId === "string" && infoId.length > 0) return infoId
  }
  return null
}

function extractSessionIdFromProps(props: Record<string, unknown>): string | null {
  const id = props.id
  return typeof id === "string" && id.length > 0 ? id : null
}

export function extractTokensFromEvent(event: OcSseEvent): { input: number; output: number } | null {
  const props = event.properties
  if (!props || typeof props !== "object") return null
  const info = props.info as Record<string, unknown> | undefined
  if (info && typeof info === "object") {
    const tokens = info.tokens as Record<string, unknown> | undefined
    if (tokens && typeof tokens === "object") {
      const input = typeof tokens.input === "number" ? tokens.input : 0
      const output = typeof tokens.output === "number" ? tokens.output : 0
      if (input > 0 || output > 0) return { input, output }
    }
  }
  const part = props.part as Record<string, unknown> | undefined
  if (part && typeof part === "object") {
    const tokens = part.tokens as Record<string, unknown> | undefined
    if (tokens && typeof tokens === "object") {
      const input = typeof tokens.input === "number" ? tokens.input : 0
      const output = typeof tokens.output === "number" ? tokens.output : 0
      if (input > 0 || output > 0) return { input, output }
    }
  }
  return null
}

export function extractModelIdFromEvent(event: OcSseEvent): string | null {
  const props = event.properties
  if (!props || typeof props !== "object") return null
  return extractModelIdFromProps(props)
}

function extractModelIdFromProps(props: Record<string, unknown>): string | null {
  const info = props.info as Record<string, unknown> | undefined
  if (info && typeof info === "object") {
    const modelId = info.modelID
    if (typeof modelId === "string" && modelId.length > 0) return modelId
  }
  return null
}
