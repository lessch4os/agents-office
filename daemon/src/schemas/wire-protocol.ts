import { Schema } from "@effect/schema"

export const WireActivityState = Schema.Union(
  Schema.Struct({ type: Schema.Literal("Idle") }),
  Schema.Struct({ type: Schema.Literal("Active"), activity: Schema.String, tool_use_id: Schema.optional(Schema.String), detail: Schema.optional(Schema.String) }),
  Schema.Struct({ type: Schema.Literal("Waiting"), reason: Schema.String }),
)
export type WireActivityState = Schema.Schema.Type<typeof WireActivityState>

const WireCompletedChild = Schema.Struct({
  agent_id: Schema.Number,
  label: Schema.String,
  agent_type: Schema.optional(Schema.String),
  tool_call_count: Schema.Number,
  active_ms: Schema.Number,
  token_input_total: Schema.Number,
  token_output_total: Schema.Number,
  cache_read_tokens: Schema.Number,
  model_name: Schema.optional(Schema.String),
})

export const WireAgent = Schema.Struct({
  agent_id: Schema.Number,
  source: Schema.String,
  session_id: Schema.String,
  cwd: Schema.String,
  label: Schema.String,
  origin: Schema.String,
  machine_name: Schema.optional(Schema.String),
  state: WireActivityState,
  state_started_at_ms: Schema.Number,
  last_event_at_ms: Schema.Number,
  created_at_ms: Schema.Number,
  exiting_at_ms: Schema.optional(Schema.Number),
  desk_index: Schema.Number,
  tool_call_count: Schema.Number,
  active_ms: Schema.Number,
  parent_id: Schema.optional(Schema.Number),
  current_tool: Schema.optional(Schema.String),
  agent_type: Schema.optional(Schema.String),
  session_total_tokens: Schema.Number,
  context_total_tokens: Schema.Number,
  context_input_tokens: Schema.Number,
  token_input_total: Schema.Number,
  token_output_total: Schema.Number,
  cache_read_tokens: Schema.Number,
  context_window_limit: Schema.Number,
  model_name: Schema.optional(Schema.String),
  completed_children: Schema.Array(WireCompletedChild),
})
export type WireAgent = Schema.Schema.Type<typeof WireAgent>

export const WireScene = Schema.Struct({
  agents: Schema.Record({ key: Schema.String, value: WireAgent }),
  max_desks: Schema.Number,
  now_ms: Schema.Number,
})
export type WireScene = Schema.Schema.Type<typeof WireScene>

export const WireSessionSummary = Schema.Struct({
  session_id: Schema.String,
  parent_session_id: Schema.optional(Schema.String),
  source: Schema.String,
  label: Schema.String,
  cwd: Schema.String,
  agent_type: Schema.optional(Schema.String),
  context_window_limit: Schema.Number,
  started_at: Schema.Number,
  ended_at: Schema.optional(Schema.Number),
  input_tokens: Schema.Number,
  output_tokens: Schema.Number,
  cache_read_tokens: Schema.Number,
  tool_call_count: Schema.Number,
  active_ms: Schema.Number,
  cost_usd: Schema.Number,
  cache_hit_rate: Schema.Number,
  tags: Schema.Array(Schema.String),
  model_name: Schema.optional(Schema.String),
})
export type WireSessionSummary = Schema.Schema.Type<typeof WireSessionSummary>

export const WireTokenSnapshot = Schema.Struct({
  ts: Schema.Number,
  cumul_input: Schema.Number,
  cumul_output: Schema.Number,
  cumul_cache: Schema.Number,
  context_pct: Schema.Number,
})
export type WireTokenSnapshot = Schema.Schema.Type<typeof WireTokenSnapshot>

export const WireSessionDetail = Schema.Struct({
  ...WireSessionSummary.fields,
  snapshots: Schema.Array(WireTokenSnapshot),
  children: Schema.Array(WireSessionSummary),
  total_cost_usd: Schema.Number,
})
export type WireSessionDetail = Schema.Schema.Type<typeof WireSessionDetail>

export const WireSessionComparison = Schema.Struct({
  a: WireSessionDetail,
  b: WireSessionDetail,
  diff: Schema.Struct({
    cost_usd: Schema.Number,
    input_tokens: Schema.Number,
    output_tokens: Schema.Number,
    cache_read_tokens: Schema.Number,
    cache_hit_rate_delta: Schema.Number,
    tool_call_count: Schema.Number,
    active_ms: Schema.Number,
    total_cost_usd: Schema.Number,
  }),
})
export type WireSessionComparison = Schema.Schema.Type<typeof WireSessionComparison>
