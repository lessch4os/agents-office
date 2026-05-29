import { AgentId } from "./agent-id";
import type { Activity } from "./types";

// ── Constants ──────────────────────────────────────────────────────

export const MAX_FLOORS = 5;

// ── ActivityState ──────────────────────────────────────────────────

export type ActivityState =
  | { type: "idle" }
  | {
      type: "active";
      activity: Activity;
      toolUseId: string | null;
      detail: string | null;
    }
  | { type: "waiting"; reason: string };

// ── CompletedChildInfo ─────────────────────────────────────────────

export interface CompletedChildInfo {
  agentId: number;
  label: string;
  agentType: string | null;
  toolCallCount: number;
  activeMs: number;
  tokenInputTotal: number;
  tokenOutputTotal: number;
  cacheReadTokens: number;
  modelName: string | null;
}

// ── AgentSlot ──────────────────────────────────────────────────────

export interface AgentSlot {
  agentId: AgentId;
  source: string;
  sessionId: string;
  cwd: string;
  label: string;
  state: ActivityState;
  stateStartedAt: number;
  lastEventAt: number;
  createdAt: number;
  exitingAt: number | null;
  pendingIdleAt: number | null;
  deskIndex: number;
  toolCallCount: number;
  activeMs: number;
  unknownCwd: boolean;
  parentId: AgentId | null;
  currentTool: string | null;
  agentType: string | null;
  sessionTotalTokens: number;
  contextTotalTokens: number;
  contextInputTokens: number;
  tokenInputTotal: number;
  tokenOutputTotal: number;
  cacheReadTokens: number;
  contextWindowLimit: number;
  modelName: string | null;
  completedChildren: CompletedChildInfo[];
}

export function cloneSlot(slot: AgentSlot): AgentSlot {
  return { ...slot, completedChildren: [...slot.completedChildren] };
}

// ── SceneState ─────────────────────────────────────────────────────

export class SceneState {
  agents: Map<bigint, AgentSlot> = new Map();

  constructor(public maxDesks: number) {}

  nextFreeDesk(): number | null {
    const occupied = new Set<number>();
    for (const slot of this.agents.values()) {
      occupied.add(slot.deskIndex);
    }
    const total = this.maxDesks * MAX_FLOORS;
    for (let i = 0; i < total; i++) {
      if (!occupied.has(i)) return i;
    }
    return null;
  }

  clone(): SceneState {
    const s = new SceneState(this.maxDesks);
    for (const [key, slot] of this.agents) {
      s.agents.set(key, cloneSlot(slot));
    }
    return s;
  }
}
