import { basename } from "path";
import { AgentId } from "./agent-id";
import { AgentEvent, Transport, toolDetailDisplay, toolDetailIsTask, toolDetailToolName } from "./types";
import { AgentSlot, SceneState } from "./state";

// ── Constants (all in milliseconds) ────────────────────────────────

export const HOOK_WINS_WINDOW = 500;
export const EXIT_GRACE_WINDOW = 4500;
export const ACTIVE_GRACE_WINDOW = 1500;
export const STALE_ACTIVE_TIMEOUT = 10 * 60 * 1000;
export const STALE_IDLE_TIMEOUT = 30 * 60 * 1000;
export const STALE_WAITING_TIMEOUT = 60 * 60 * 1000;
export const STALE_UNKNOWN_CWD_TIMEOUT = 3 * 60 * 1000;

// ── Apply context ──────────────────────────────────────────────────

export interface ApplyCtx {
  now: number;
  transport: Transport;
  activeTasks: Map<bigint, Set<string>>;
  hookActiveAgents: Set<string>;
  recentHookToolUses: Map<string, number>;
  nextLabelN: { value: number };
}

// ── Event handler interface ────────────────────────────────────────

export interface EventHandler {
  eventType: string;
  apply(slot: AgentSlot | null, event: AgentEvent, scene: SceneState, ctx: ApplyCtx): void;
}

// ── Transport strategy interface ───────────────────────────────────

interface TransportStrategy {
  shouldDrop(event: AgentEvent, scene: SceneState, ctx: ApplyCtx): boolean;
  onBeforeApply(event: AgentEvent, slot: AgentSlot | null, ctx: ApplyCtx): void;
}

// ── Transport strategies ───────────────────────────────────────────

const hookStrategy: TransportStrategy = {
  shouldDrop(event, scene, ctx) {
    const idKey = event.agentId.value;
    const inTask = (ctx.activeTasks.get(idKey)?.size ?? 0) > 0;
    if (event.type === "activityStart") return inTask;
    if (event.type === "activityEnd") {
      const isTaskSelfEnd =
        event.toolUseId != null &&
        ctx.activeTasks.get(idKey)?.has(event.toolUseId) === true;
      return inTask && !isTaskSelfEnd;
    }
    return false;
  },
  onBeforeApply(event, _slot, ctx) {
    const idKey = event.agentId.value;
    ctx.hookActiveAgents.add(idKey);

    const tuid = eventToolUseId(event);
    if (tuid) {
      ctx.recentHookToolUses.set(`${idKey}-${tuid}`, ctx.now);
    }

    // Clear unknown_cwd on any hook event
    const slot = _slot;
    if (slot) slot.unknownCwd = false;
  },
};

const jsonlStrategy: TransportStrategy = {
  shouldDrop(event, _scene, ctx) {
    const idKey = event.agentId.value;
    const tuid = eventToolUseId(event);
    if (tuid) {
      const key = `${idKey}-${tuid}`;
      if (ctx.recentHookToolUses.has(key)) return true;
    }
    if (event.type === "tokenUsage" && ctx.hookActiveAgents.has(idKey)) return true;
    return false;
  },
  onBeforeApply() {
    // no-op for jsonl
  },
};

const transportStrategies: Record<Transport, TransportStrategy> = {
  hook: hookStrategy,
  jsonl: jsonlStrategy,
  "remote-hook": hookStrategy,
  sse: hookStrategy,
};

// ── Individual event handlers ──────────────────────────────────────

const sessionStartHandler: EventHandler = {
  eventType: "sessionStart",
  apply(slot, event, scene, ctx) {
    if (slot) return; // already exists, ignore duplicate

    const deskIndex = scene.nextFreeDesk();
    if (deskIndex === null) {
      console.warn(
        `dropped SessionStart — all desks occupied (max_desks=${scene.maxDesks})`,
        event.agentId.toString(),
      );
      return;
    }

    const sourcePrefixes: Record<string, string> = {
      "claude-code": "cc",
      "antigravity": "ag",
      "opencode": "oc",
    };
    ctx.nextLabelN.value++;
    const hasCwd = event.cwd.length > 0 && event.cwd !== "/" && basename(event.cwd).length > 0;
    const prefix = sourcePrefixes[event.source] ?? event.source.slice(0, 2);
    const label = hasCwd
      ? `${prefix}\u00b7${basename(event.cwd)}`
      : `${prefix}#${ctx.nextLabelN.value}`;

    let parentId = event.parentId;
    if (!parentId && event.parentSessionId) {
      for (const [, existing] of scene.agents) {
        if (existing.sessionId === event.parentSessionId) {
          parentId = existing.agentId;
          break;
        }
      }
    }

    scene.agents.set(event.agentId.value, {
      agentId: event.agentId,
      source: event.source,
      sessionId: event.sessionId,
      cwd: event.cwd,
      label,
      state: { type: "idle" },
      stateStartedAt: ctx.now,
      lastEventAt: ctx.now,
      createdAt: ctx.now,
      exitingAt: null,
      pendingIdleAt: null,
      deskIndex,
      toolCallCount: 0,
      activeMs: 0,
      unknownCwd: !hasCwd,
      parentId,
      currentTool: null,
      agentType: event.agentType,
      sessionTotalTokens: 0,
      contextTotalTokens: 0,
      contextInputTokens: 0,
      tokenInputTotal: 0,
      tokenOutputTotal: 0,
      cacheReadTokens: 0,
      contextWindowLimit: event.contextWindowLimit ?? 200_000,
      completedChildren: [],
    });
  },
};

const activityStartHandler: EventHandler = {
  eventType: "activityStart",
  apply(slot, event, scene, ctx) {
    if (!slot) return;

    // Task tracking
    if (event.toolUseId && event.detail && toolDetailIsTask(event.detail)) {
      let set = ctx.activeTasks.get(event.agentId.value);
      if (!set) {
        set = new Set();
        ctx.activeTasks.set(event.agentId.value, set);
      }
      set.add(event.toolUseId);
      slot.state = {
        type: "active",
        activity: "typing",
        toolUseId: event.toolUseId,
        detail: "Delegating",
      };
      slot.stateStartedAt = ctx.now;
      slot.pendingIdleAt = null;
      return;
    }

    if (!(event.detail && toolDetailIsTask(event.detail))) {
      if (event.detail && slot.state.type === "active" && slot.pendingIdleAt === null) {
        const newToolName = toolDetailToolName(event.detail);
        const newDetail = toolDetailDisplay(event.detail);
        if (slot.currentTool === newToolName && slot.state.detail === newDetail) {
          return;
        }
      }
      slot.toolCallCount++;
    }

    if (slot.state.type === "active") {
      const elapsed = Math.max(0, ctx.now - slot.stateStartedAt);
      slot.activeMs += elapsed;
    }

    slot.state = {
      type: "active",
      activity: event.activity,
      toolUseId: event.toolUseId,
      detail: event.detail ? toolDetailDisplay(event.detail) : null,
    };
    slot.currentTool = event.detail ? toolDetailToolName(event.detail) : null;
    slot.stateStartedAt = ctx.now;
    slot.lastEventAt = ctx.now;
    slot.pendingIdleAt = null;
  },
};

const activityEndHandler: EventHandler = {
  eventType: "activityEnd",
  apply(slot, event, _scene, ctx) {
    if (!slot) return;

    // Task tracking: check if this ends a task
    if (event.toolUseId) {
      const set = ctx.activeTasks.get(event.agentId.value);
      if (set && set.has(event.toolUseId)) {
        set.delete(event.toolUseId);
        slot.lastEventAt = ctx.now;

        if (set.size === 0) {
          cascadeSessionEnd(_scene, event.agentId, ctx.now);
          slot.pendingIdleAt = ctx.now;
        }
        return;
      }
    }

    // Non-task activity end
    if (slot.state.type === "active") {
      slot.pendingIdleAt = ctx.now;
    }
    slot.lastEventAt = ctx.now;
  },
};

const waitingHandler: EventHandler = {
  eventType: "waiting",
  apply(slot, event, _scene, ctx) {
    if (!slot) return;
    slot.state = { type: "waiting", reason: event.reason };
    slot.stateStartedAt = ctx.now;
    slot.lastEventAt = ctx.now;
    slot.pendingIdleAt = null;
  },
};

const tokenUsageHandler: EventHandler = {
  eventType: "tokenUsage",
  apply(slot, event, _scene, ctx) {
    if (!slot) return;
    if (event.cumulative) {
      slot.contextInputTokens = event.input;
      slot.tokenInputTotal = event.input >>> 0;
      slot.tokenOutputTotal = event.output >>> 0;
      slot.sessionTotalTokens = (event.input + event.output) >>> 0;
      if (event.cacheRead !== undefined) {
        slot.cacheReadTokens = event.cacheRead >>> 0;
      }
    } else {
      slot.contextInputTokens = event.input;
      slot.tokenInputTotal = (slot.tokenInputTotal + event.input) >>> 0;
      slot.tokenOutputTotal = (slot.tokenOutputTotal + event.output) >>> 0;
      slot.sessionTotalTokens = (slot.sessionTotalTokens + event.input + event.output) >>> 0;
      if (event.cacheRead !== undefined) {
        slot.cacheReadTokens = (slot.cacheReadTokens + event.cacheRead) >>> 0;
      }
    }
    if (event.total !== undefined) {
      slot.contextTotalTokens = event.total >>> 0;
    }
    slot.lastEventAt = ctx.now;
  },
};

const renameHandler: EventHandler = {
  eventType: "rename",
  apply(slot, event, _scene, ctx) {
    if (!slot) return;
    if (slot.label !== event.label) {
      slot.label = event.label;
    }
    slot.lastEventAt = ctx.now;
  },
};

const modelUpdateHandler: EventHandler = {
  eventType: "modelUpdate",
  apply(slot, event, _scene, ctx) {
    if (!slot) return;
    slot.modelName = event.modelId;
    if (event.contextWindowLimit !== undefined) {
      slot.contextWindowLimit = event.contextWindowLimit;
    }
    slot.lastEventAt = ctx.now;
  },
};

const sessionEndHandler: EventHandler = {
  eventType: "sessionEnd",
  apply(slot, event, scene, ctx) {
    if (slot && slot.exitingAt === null) {
      slot.exitingAt = ctx.now;
    }
    cascadeSessionEnd(scene, event.agentId, ctx.now);
  },
};

// ── Registry ───────────────────────────────────────────────────────

const eventHandlers = new Map<string, EventHandler>([
  [sessionStartHandler.eventType, sessionStartHandler],
  [activityStartHandler.eventType, activityStartHandler],
  [activityEndHandler.eventType, activityEndHandler],
  [waitingHandler.eventType, waitingHandler],
  [tokenUsageHandler.eventType, tokenUsageHandler],
  [renameHandler.eventType, renameHandler],
  [sessionEndHandler.eventType, sessionEndHandler],
  [modelUpdateHandler.eventType, modelUpdateHandler],
]);

export function registerEventHandler(handler: EventHandler): void {
  eventHandlers.set(handler.eventType, handler);
}

// ── Reducer ────────────────────────────────────────────────────────

export class Reducer {
  recentHookToolUses: Map<string, number> = new Map();
  hookActiveAgents: Set<string> = new Set();
  activeTasks: Map<bigint, Set<string>> = new Map();
  nextLabelN = 0;

  tick(scene: SceneState, now: number): void {
    this.gc(now);
    this.sweepExited(scene, now);
    this.expirePendingIdles(scene, now);
    this.sweepStale(scene, now);
  }

  apply(scene: SceneState, event: AgentEvent, now: number, from: Transport): void {
    this.gc(now);
    this.sweepExited(scene, now);
    this.expirePendingIdles(scene, now);

    const idKey = event.agentId.value;
    const ctx: ApplyCtx = {
      now,
      transport: from,
      activeTasks: this.activeTasks,
      hookActiveAgents: this.hookActiveAgents,
      recentHookToolUses: this.recentHookToolUses,
      nextLabelN: { value: this.nextLabelN },
    };

    // Transport strategy: drop / prelude
    const strategy = transportStrategies[from];
    if (strategy.shouldDrop(event, scene, ctx)) return;

    const slot = scene.agents.get(idKey) ?? null;
    strategy.onBeforeApply(event, slot, ctx);

    // Capture nextLabelN mutation back
    this.nextLabelN = ctx.nextLabelN.value;

    // Dispatch to registered handler
    const handler = eventHandlers.get(event.type);
    if (handler) {
      handler.apply(slot, event, scene, ctx);
    }
  }

  // ── GC: purge old hook-wins entries ──────────────────────────────

  private gc(now: number): void {
    for (const [key, ts] of this.recentHookToolUses) {
      if (now - ts > HOOK_WINS_WINDOW) {
        this.recentHookToolUses.delete(key);
      }
    }
  }

  // ── Expire pending idles (Active→Idle debounce) ──────────────────

  private expirePendingIdles(scene: SceneState, now: number): void {
    for (const slot of scene.agents.values()) {
      if (slot.pendingIdleAt === null) continue;
      if (now - slot.pendingIdleAt >= ACTIVE_GRACE_WINDOW) {
        if (slot.state.type === "active") {
          const elapsed = Math.max(0, slot.pendingIdleAt - slot.stateStartedAt);
          slot.activeMs += elapsed;
          slot.state = { type: "idle" };
          slot.stateStartedAt = now;
        }
        slot.pendingIdleAt = null;
      }
    }
  }

  // ── Sweep stale agents ───────────────────────────────────────────

  private sweepStale(scene: SceneState, now: number): void {
    for (const slot of scene.agents.values()) {
      if (slot.exitingAt !== null) continue;

      const age = Math.max(0, now - slot.lastEventAt);
      const unknownCwd = slot.unknownCwd;
      const threshold = unknownCwd
        ? STALE_UNKNOWN_CWD_TIMEOUT
        : slot.state.type === "active"
          ? STALE_ACTIVE_TIMEOUT
          : slot.state.type === "idle"
            ? STALE_IDLE_TIMEOUT
            : STALE_WAITING_TIMEOUT;

      if (age > threshold) {
        console.info(
          `stale agent — marking exiting: ${slot.agentId.toString()} (${slot.label}), age=${Math.round(age / 1000)}s`,
        );
        slot.exitingAt = now;
      }
    }
  }

  // ── Sweep exited agents ──────────────────────────────────────────

  private sweepExited(scene: SceneState, now: number): void {
    const expired: bigint[] = [];
    for (const [key, slot] of scene.agents) {
      if (slot.exitingAt !== null && now - slot.exitingAt > EXIT_GRACE_WINDOW) {
        expired.push(key);
      }
    }
    for (const key of expired) {
      const slot = scene.agents.get(key);
      if (slot && slot.parentId) {
        const parent = scene.agents.get(slot.parentId.value);
        if (parent) {
          parent.completedChildren.push({
            agentId: slot.agentId.toNumber(),
            label: slot.label,
            agentType: slot.agentType,
            toolCallCount: slot.toolCallCount,
            activeMs: slot.activeMs,
            tokenInputTotal: slot.tokenInputTotal,
            tokenOutputTotal: slot.tokenOutputTotal,
            cacheReadTokens: slot.cacheReadTokens,
            modelName: slot.modelName,
          });
        }
      }
    }
    for (const key of expired) {
      scene.agents.delete(key);
      this.activeTasks.delete(key);
      this.hookActiveAgents.delete(key);
    }
  }
}

// ── Helpers ────────────────────────────────────────────────────────

function eventToolUseId(event: AgentEvent): string | null {
  if (event.type === "activityStart") return event.toolUseId;
  if (event.type === "activityEnd") return event.toolUseId;
  return null;
}

function cascadeSessionEnd(scene: SceneState, rootId: AgentId, now: number): void {
  const visited = new Set<bigint>();
  visited.add(rootId.value);
  const frontier: bigint[] = [rootId.value];

  while (frontier.length > 0) {
    const parent = frontier.pop()!;
    const children: bigint[] = [];
    for (const [key, slot] of scene.agents) {
      if (slot.parentId && slot.parentId.value === parent && slot.exitingAt === null) {
        children.push(key);
      }
    }
    for (const cid of children) {
      if (visited.has(cid)) continue;
      visited.add(cid);
      const slot = scene.agents.get(cid);
      if (slot) {
        slot.exitingAt = now;
      }
      frontier.push(cid);
    }
  }
}


