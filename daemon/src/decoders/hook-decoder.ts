import { Array, Either, HashMap } from "effect"
import { AgentEvent } from "../schemas/agent-event"

export function getStr(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key]
  return typeof v === "string" ? v : undefined
}

export function getObj(obj: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const v = obj[key]
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>
  return undefined
}

export function getNum(obj: Record<string, unknown>, key: string): number | undefined {
  const v = obj[key]
  return typeof v === "number" ? v : undefined
}

function extractTokens(usage: Record<string, unknown>): { input: number; output: number; cacheRead: number } {
  const rawInput = getNum(usage, "input_tokens") ?? 0
  const cacheRead = getNum(usage, "cache_read_input_tokens") ?? 0
  const input = Math.max(0, rawInput - cacheRead)
  const output = getNum(usage, "output_tokens") ?? 0
  return { input, output, cacheRead }
}

function makeTokenEvent(
  agentId: number,
  input: number,
  output: number,
  cacheRead: number,
  cumulative?: boolean,
  total?: number,
): AgentEvent {
  const event: AgentEvent = {
    type: "tokenUsage",
    agentId,
    input,
    output,
  }
  if (cacheRead > 0) event.cacheRead = cacheRead
  if (cumulative !== undefined) event.cumulative = cumulative
  if (total !== undefined) event.total = total
  return event
}

export function makeToolDetail(toolName: string, target: string): { type: "task" } | { type: "generic"; toolName: string; display: string } {
  if (toolName === "Task" || toolName === "Agent") {
    return { type: "task" }
  }
  return { type: "generic", toolName, display: `${toolName}:${target}` }
}

const toolTargetKeys = HashMap.make<string, string>(
  ["Write", "file_path"],
  ["Edit", "file_path"],
  ["MultiEdit", "file_path"],
  ["Read", "file_path"],
  ["Bash", "command"],
  ["Grep", "pattern"],
  ["Glob", "pattern"],
)

export function registerToolTargetKey(tool: string, key: string): void {
  HashMap.set(toolTargetKeys, tool, key)
}

export function describeToolTarget(tool: string, input: unknown): string {
  if (!input || typeof input !== "object" || Array.isArray(input)) return ""

  const key = HashMap.get(toolTargetKeys, tool).pipe(Array.fromOption).at(0)
  if (!key) return ""

  const v = (input as Record<string, unknown>)[key]
  if (typeof v !== "string") return ""

  const s = v
  if (s.length === 0) return ""

  const truncated = s.length > 80 ? s.slice(0, 80) + "\u2026" : s
  return `: ${truncated}`
}

function makeCtx(v: Record<string, unknown>, sourceOverride?: string) {
  const sessionId = getStr(v, "session_id")!
  const transcriptPath = getStr(v, "transcript_path")!
  const agentType = getStr(v, "agent_type") ?? null
  const payloadSource = getStr(v, "source") ?? null
  const rawSource = sourceOverride ?? agentType ?? payloadSource ?? "claude-code"
  const source = rawSource === "opencode" ? "opencode" : "claude-code"
  return { agentId: 0, source, sessionId, transcriptPath, agentType }
}

export type HookDecodeResult = {
  events: AgentEvent[]
  ctx: { agentId: number; source: string; sessionId: string; transcriptPath: string; agentType: string | null }
}

export function decodeHookPayload(
  v: Record<string, unknown>,
  hashAgentIdFn: (domain: string, key: string) => number,
  sourceOverride?: string,
): Either.Either<HookDecodeResult, string> {
  const event = getStr(v, "hook_event_name")
  if (!event) return Either.left("missing hook_event_name")
  const sessionId = getStr(v, "session_id")
  if (!sessionId) return Either.left("missing session_id")
  const transcriptPath = getStr(v, "transcript_path")
  if (!transcriptPath) return Either.left("missing transcript_path")

  const ctx = makeCtx(v, sourceOverride)
  ctx.agentId = hashAgentIdFn(ctx.source, transcriptPath)

  const decode = decoders[event as keyof typeof decoders]
  if (!decode) return Either.left(`unsupported hook_event_name: ${event}`)

  return Either.right({ events: decode(v, ctx), ctx })
}

const decoders = {
  SessionStart(v: Record<string, unknown>, ctx: ReturnType<typeof makeCtx>): AgentEvent[] {
    const cwd = getStr(v, "cwd") ?? ""
    const contextWindowLimit = getNum(v, "context_window_limit")
    const parentSessionId = getStr(v, "parent_session_id")
    const machineName = getStr(v, "machine_name")
    return [{
      type: "sessionStart",
      agentId: ctx.agentId,
      source: ctx.source,
      sessionId: ctx.sessionId,
      cwd,
      parentId: undefined,
      parentSessionId,
      agentType: ctx.agentType,
      contextWindowLimit,
      machineName: machineName ?? undefined,
    }]
  },

  PreToolUse(v: Record<string, unknown>, ctx: ReturnType<typeof makeCtx>): AgentEvent[] {
    const toolName = getStr(v, "tool_name") ?? "?"
    const target = describeToolTarget(toolName, v["tool_input"])
    const toolUseId = getStr(v, "tool_use_id") ?? null
    return [{
      type: "activityStart",
      agentId: ctx.agentId,
      activity: "typing",
      toolUseId: toolUseId ?? undefined,
      detail: makeToolDetail(toolName, target),
    }]
  },

  PostToolUse(v: Record<string, unknown>, ctx: ReturnType<typeof makeCtx>): AgentEvent[] {
    const toolUseId = getStr(v, "tool_use_id") ?? null
    const events: AgentEvent[] = [
      { type: "activityEnd", agentId: ctx.agentId, toolUseId: toolUseId ?? undefined },
    ]
    const usage = getObj(v, "usage")
    if (usage) {
      const { input, output, cacheRead } = extractTokens(usage)
      if (input > 0 || output > 0) {
        events.push(makeTokenEvent(ctx.agentId, input, output, cacheRead))
      }
    }
    return events
  },

  Notification(v: Record<string, unknown>, ctx: ReturnType<typeof makeCtx>): AgentEvent[] {
    const msg = getStr(v, "message") ?? "waiting"
    return [{ type: "waiting", agentId: ctx.agentId, reason: msg }]
  },

  TokenUpdate(v: Record<string, unknown>, ctx: ReturnType<typeof makeCtx>): AgentEvent[] {
    const usage = getObj(v, "usage")
    if (!usage) return []
    const { input, output, cacheRead } = extractTokens(usage)
    if (input <= 0 && output <= 0) return []
    const total = getNum(usage, "total_tokens")
    return [makeTokenEvent(ctx.agentId, input, output, cacheRead, true, total)]
  },

  SessionEnd(_v: Record<string, unknown>, ctx: ReturnType<typeof makeCtx>): AgentEvent[] {
    return [{ type: "sessionEnd", agentId: ctx.agentId }]
  },

  Rename(v: Record<string, unknown>, ctx: ReturnType<typeof makeCtx>): AgentEvent[] {
    const label = getStr(v, "label")
    if (!label) throw new Error("missing label")
    return [{ type: "rename", agentId: ctx.agentId, label }]
  },

  SubagentStart(): AgentEvent[] {
    return []
  },

  SubagentStop(v: Record<string, unknown>, ctx: ReturnType<typeof makeCtx>): AgentEvent[] {
    const agentTranscriptPath = getStr(v, "agent_transcript_path")
    if (!agentTranscriptPath) throw new Error("missing agent_transcript_path")
    const subId = ctx.agentId
    return [{ type: "sessionEnd", agentId: subId }]
  },

  Stop(_v: Record<string, unknown>, ctx: ReturnType<typeof makeCtx>): AgentEvent[] {
    return [{ type: "activityEnd", agentId: ctx.agentId, toolUseId: undefined }]
  },

  StopFailure(v: Record<string, unknown>, ctx: ReturnType<typeof makeCtx>): AgentEvent[] {
    const err = getStr(v, "error") ?? "unknown"
    return [
      { type: "activityEnd", agentId: ctx.agentId, toolUseId: undefined },
      { type: "waiting", agentId: ctx.agentId, reason: `api_error:${err}` },
    ]
  },

  PermissionDenied(v: Record<string, unknown>, ctx: ReturnType<typeof makeCtx>): AgentEvent[] {
    const toolUseId = getStr(v, "tool_use_id") ?? null
    return [{ type: "activityEnd", agentId: ctx.agentId, toolUseId: toolUseId ?? undefined }]
  },

  PostToolUseFailure(v: Record<string, unknown>, ctx: ReturnType<typeof makeCtx>): AgentEvent[] {
    const toolUseId = getStr(v, "tool_use_id") ?? null
    return [{ type: "activityEnd", agentId: ctx.agentId, toolUseId: toolUseId ?? undefined }]
  },

  PreCompact(_v: Record<string, unknown>, ctx: ReturnType<typeof makeCtx>): AgentEvent[] {
    return [{ type: "activityEnd", agentId: ctx.agentId, toolUseId: undefined }]
  },

  PostCompact(_v: Record<string, unknown>, ctx: ReturnType<typeof makeCtx>): AgentEvent[] {
    return [{ type: "activityEnd", agentId: ctx.agentId, toolUseId: undefined }]
  },

  ModelUpdate(v: Record<string, unknown>, ctx: ReturnType<typeof makeCtx>): AgentEvent[] {
    const modelId = getStr(v, "model_id")
    if (!modelId) return []
    const contextWindowLimit = getNum(v, "context_window_limit")
    return [{ type: "modelUpdate", agentId: ctx.agentId, modelId, contextWindowLimit }]
  },

  TokenDebug(): AgentEvent[] {
    return []
  },
}
