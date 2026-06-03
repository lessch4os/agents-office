import { Schema } from "@effect/schema"

export const ActivityState = Schema.Union(
  Schema.Struct({ type: Schema.Literal("Idle") }),
  Schema.Struct({ type: Schema.Literal("Active"), activity: Schema.String, toolUseId: Schema.optional(Schema.String), detail: Schema.optional(Schema.String) }),
  Schema.Struct({ type: Schema.Literal("Waiting"), reason: Schema.String }),
)
export type ActivityState = Schema.Schema.Type<typeof ActivityState>

const CompletedChild = Schema.Struct({
  agentId: Schema.Number,
  label: Schema.String,
  agentType: Schema.optional(Schema.String),
  toolCallCount: Schema.Number,
  activeMs: Schema.Number,
  tokenInputTotal: Schema.Number,
  tokenOutputTotal: Schema.Number,
  cacheReadTokens: Schema.Number,
  modelName: Schema.optional(Schema.String),
})

export const AgentSlot = Schema.Struct({
  agentId: Schema.Number,
  source: Schema.String,
  sessionId: Schema.String,
  cwd: Schema.String,
  label: Schema.String,
  origin: Schema.String,
  machineName: Schema.optional(Schema.String),
  state: ActivityState,
  stateStartedAtMs: Schema.Number,
  lastEventAtMs: Schema.Number,
  createdAtMs: Schema.Number,
  exitingAtMs: Schema.optional(Schema.Number),
  deskIndex: Schema.Number,
  toolCallCount: Schema.Number,
  activeMs: Schema.Number,
  parentId: Schema.optional(Schema.Number),
  currentTool: Schema.optional(Schema.String),
  agentType: Schema.optional(Schema.String),
  sessionTotalTokens: Schema.Number,
  contextTotalTokens: Schema.Number,
  contextInputTokens: Schema.Number,
  tokenInputTotal: Schema.Number,
  tokenOutputTotal: Schema.Number,
  cacheReadTokens: Schema.Number,
  contextWindowLimit: Schema.Number,
  modelName: Schema.optional(Schema.String),
  completedChildren: Schema.Array(CompletedChild),
})
export type AgentSlot = Schema.Schema.Type<typeof AgentSlot>

export const SceneState = Schema.Struct({
  agents: Schema.Record({ key: Schema.String, value: AgentSlot }),
  maxDesks: Schema.Number,
})
export type SceneState = Schema.Schema.Type<typeof SceneState>
