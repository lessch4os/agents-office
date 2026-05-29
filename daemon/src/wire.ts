import type { ActivityState, AgentSlot, SceneState } from "./state";

// ── Wire types (matches web/src/types.ts) ─────────────────────────

export interface WireScene {
  agents: Record<number, WireSlot>;
  max_desks: number;
  now_ms: number;
}

export interface WireCompletedChild {
  agent_id: number;
  label: string;
  agent_type: string | null;
  tool_call_count: number;
  active_ms: number;
  token_input_total: number;
  token_output_total: number;
  cache_read_tokens: number;
  model_name: string | null;
}

export interface WireSlot {
  agent_id: number;
  source: string;
  session_id: string;
  cwd: string;
  label: string;
  origin: string;
  machine_name: string | null;
  state: WireActivityState;
  state_started_at_ms: number;
  last_event_at_ms: number;
  created_at_ms: number;
  exiting_at_ms: number | null;
  desk_index: number;
  tool_call_count: number;
  active_ms: number;
  parent_id: number | null;
  current_tool: string | null;
  agent_type: string | null;
  session_total_tokens: number;
  context_total_tokens: number;
  context_input_tokens: number;
  token_input_total: number;
  token_output_total: number;
  cache_read_tokens: number;
  context_window_limit: number;
  model_name: string | null;
  completed_children: WireCompletedChild[];
}

export type WireActivityState =
  | { type: "Idle" }
  | {
      type: "Active";
      activity: string;
      tool_use_id: string | null;
      detail: string | null;
    }
  | { type: "Waiting"; reason: string };

// ── Conversion helpers ─────────────────────────────────────────────

function activityStateToWire(s: ActivityState): WireActivityState {
  switch (s.type) {
    case "idle":
      return { type: "Idle" };
    case "active":
      return {
        type: "Active",
        activity: s.activity,
        tool_use_id: s.toolUseId,
        detail: s.detail,
      };
    case "waiting":
      return { type: "Waiting", reason: s.reason };
  }
}

export function slotToWire(slot: AgentSlot): WireSlot {
  return {
    agent_id: slot.agentId.toNumber(),
    source: slot.source,
    session_id: slot.sessionId,
    cwd: slot.cwd,
    label: slot.label,
    origin: slot.origin,
    machine_name: slot.machineName,
    state: activityStateToWire(slot.state),
    state_started_at_ms: slot.stateStartedAt,
    last_event_at_ms: slot.lastEventAt,
    created_at_ms: slot.createdAt,
    exiting_at_ms: slot.exitingAt,
    desk_index: slot.deskIndex,
    tool_call_count: slot.toolCallCount,
    active_ms: slot.activeMs,
    parent_id: slot.parentId !== null ? slot.parentId.toNumber() : null,
    current_tool: slot.currentTool,
    agent_type: slot.agentType,
    session_total_tokens: slot.sessionTotalTokens,
    context_total_tokens: slot.contextTotalTokens,
    context_input_tokens: slot.contextInputTokens,
    token_input_total: slot.tokenInputTotal,
    token_output_total: slot.tokenOutputTotal,
    cache_read_tokens: slot.cacheReadTokens,
    context_window_limit: slot.contextWindowLimit,
    model_name: slot.modelName,
    completed_children: slot.completedChildren.map((c) => ({
      agent_id: c.agentId,
      label: c.label,
      agent_type: c.agentType,
      tool_call_count: c.toolCallCount,
      active_ms: c.activeMs,
      token_input_total: c.tokenInputTotal,
      token_output_total: c.tokenOutputTotal,
      cache_read_tokens: c.cacheReadTokens,
      model_name: c.modelName,
    })),
  };
}

export function sceneToWire(scene: SceneState, nowMs: number): WireScene {
  const agents: Record<number, WireSlot> = {};
  for (const slot of scene.agents.values()) {
    agents[slot.agentId.toNumber()] = slotToWire(slot);
  }
  return {
    agents,
    max_desks: scene.maxDesks,
    now_ms: nowMs,
  };
}
