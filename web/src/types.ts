export interface WireCompletedChild {
  agent_id: number
  label: string
  agent_type: string | null
  tool_call_count: number
  active_ms: number
  token_input_total: number
  token_output_total: number
  cache_read_tokens: number
  model_name: string | null
}

export interface WireAgent {
  agent_id: number
  source: string
  session_id: string
  cwd: string
  label: string
  origin: string
  machine_name: string | null
  state: WireActivityState
  state_started_at_ms: number
  last_event_at_ms: number
  created_at_ms: number
  exiting_at_ms: number | null
  desk_index: number
  tool_call_count: number
  active_ms: number
  parent_id: number | null
  current_tool: string | null
  agent_type: string | null
  session_total_tokens: number
  context_total_tokens: number
  context_input_tokens: number
  token_input_total: number
  token_output_total: number
  cache_read_tokens: number
  context_window_limit: number
  model_name: string | null
  completed_children: WireCompletedChild[]
}

export type WireActivityState =
  | { type: "Idle" }
  | { type: "Active"; activity: string; tool_use_id: string | null; detail: string | null }
  | { type: "Waiting"; reason: string }

export interface WireScene {
  agents: Record<number, WireAgent>
  max_desks: number
  now_ms: number
}

export type WireLogType = "tool_start" | "tool_result" | "thought" | "error" | "waiting"

export interface WireLogEntry {
  agent_id: number
  timestamp_ms: number
  tool_name: string | null
  detail: string
  log_type: WireLogType
  truncated: boolean
  tool_input?: string
  duration_ms?: number
}

// ── Session history types ────────────────────────────────────────────

export interface WireSessionSummary {
  session_id: string
  parent_session_id: string | null
  source: string
  label: string
  cwd: string
  agent_type: string | null
  context_window_limit: number
  started_at: number
  ended_at: number | null
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  tool_call_count: number
  active_ms: number
  cost_usd: number
  cache_hit_rate: number
  tags: string[]
  model_name: string | null
}

export interface WireTokenSnapshot {
  ts: number
  cumul_input: number
  cumul_output: number
  cumul_cache: number
  context_pct: number
}

export interface WireSessionDetail extends WireSessionSummary {
  snapshots: WireTokenSnapshot[]
  children: WireSessionSummary[]
  total_cost_usd: number
}

export interface WireSessionComparison {
  a: WireSessionDetail
  b: WireSessionDetail
  diff: {
    cost_usd: number
    input_tokens: number
    output_tokens: number
    cache_read_tokens: number
    cache_hit_rate_delta: number
    tool_call_count: number
    active_ms: number
    total_cost_usd: number
  }
}
