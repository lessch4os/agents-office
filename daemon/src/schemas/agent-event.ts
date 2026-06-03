import { Schema } from "@effect/schema"

export const Activity = Schema.Literal("typing", "reading", "thinking")
export type Activity = Schema.Schema.Type<typeof Activity>

export const ToolDetail = Schema.Union(
  Schema.Struct({ type: Schema.Literal("task") }),
  Schema.Struct({ type: Schema.Literal("generic"), toolName: Schema.String, display: Schema.String }),
)
export type ToolDetail = Schema.Schema.Type<typeof ToolDetail>

export const Transport = Schema.Literal("hook", "jsonl", "remote-hook", "sse", "restore")
export type Transport = Schema.Schema.Type<typeof Transport>

export const LogType = Schema.Literal("tool_start", "tool_result", "thought", "error", "waiting")
export type LogType = Schema.Schema.Type<typeof LogType>

const NullableNumber = Schema.NullOr(Schema.Number)

export const AgentEvent = Schema.Union(
  Schema.Struct({ type: Schema.Literal("sessionStart"), agentId: Schema.Number, source: Schema.String, sessionId: Schema.String, cwd: Schema.String, parentId: Schema.optional(NullableNumber), parentSessionId: Schema.optional(Schema.String), agentType: Schema.optional(Schema.String), contextWindowLimit: Schema.optional(Schema.Number), origin: Schema.optional(Schema.String), machineName: Schema.optional(Schema.String) }),
  Schema.Struct({ type: Schema.Literal("activityStart"), agentId: Schema.Number, activity: Activity, toolUseId: Schema.optional(Schema.String), detail: Schema.optional(ToolDetail) }),
  Schema.Struct({ type: Schema.Literal("activityEnd"), agentId: Schema.Number, toolUseId: Schema.optional(Schema.String) }),
  Schema.Struct({ type: Schema.Literal("waiting"), agentId: Schema.Number, reason: Schema.String }),
  Schema.Struct({ type: Schema.Literal("rename"), agentId: Schema.Number, label: Schema.String }),
  Schema.Struct({ type: Schema.Literal("tokenUsage"), agentId: Schema.Number, input: Schema.Number, output: Schema.Number, cacheRead: Schema.optional(Schema.Number), cumulative: Schema.optional(Schema.Boolean), total: Schema.optional(Schema.Number) }),
  Schema.Struct({ type: Schema.Literal("sessionEnd"), agentId: Schema.Number }),
  Schema.Struct({ type: Schema.Literal("modelUpdate"), agentId: Schema.Number, modelId: Schema.String, contextWindowLimit: Schema.optional(Schema.Number) }),
)
export type AgentEvent = Schema.Schema.Type<typeof AgentEvent>

export const TaggedEvent = Schema.Struct({
  transport: Transport,
  event: AgentEvent,
})
export type TaggedEvent = Schema.Schema.Type<typeof TaggedEvent>

export const WireLogEntry = Schema.Struct({
  agent_id: Schema.Number,
  timestamp_ms: Schema.Number,
  tool_name: Schema.optional(Schema.String),
  detail: Schema.String,
  log_type: LogType,
  truncated: Schema.Boolean,
  tool_input: Schema.optional(Schema.String),
  duration_ms: Schema.optional(Schema.Number),
})
export type WireLogEntry = Schema.Schema.Type<typeof WireLogEntry>

export function eventAgentId(event: AgentEvent): number {
  return event.agentId
}

export function eventToolUseId(event: AgentEvent): string | null {
  switch (event.type) {
    case "activityStart":
      return event.toolUseId ?? null
    case "activityEnd":
      return event.toolUseId ?? null
    default:
      return null
  }
}

export function toolDetailDisplay(detail: ToolDetail): string {
  switch (detail.type) {
    case "task":
      return "Delegating"
    case "generic":
      return detail.display
  }
}

export function toolDetailToolName(detail: ToolDetail): string | null {
  switch (detail.type) {
    case "task":
      return null
    case "generic":
      return detail.toolName
  }
}

export function toolDetailIsTask(detail: ToolDetail): boolean {
  return detail.type === "task"
}
