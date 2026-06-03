import { HashMap, HashSet } from "effect"

export const HOOK_WINS_WINDOW = 500
export const EXIT_GRACE_WINDOW = 4500
export const ACTIVE_GRACE_WINDOW = 1500
export const STALE_ACTIVE_TIMEOUT = 10 * 60 * 1000
export const STALE_IDLE_TIMEOUT = 30 * 60 * 1000
export const STALE_WAITING_TIMEOUT = 60 * 60 * 1000
export const STALE_UNKNOWN_CWD_TIMEOUT = 3 * 60 * 1000
export const MAX_FLOORS = 5

export type ActivityState =
  | { readonly type: "idle" }
  | { readonly type: "active"; activity: string; toolUseId: string | undefined; detail: string | undefined }
  | { readonly type: "waiting"; reason: string }

export interface CompletedChildInfo {
  agentId: number
  label: string
  agentType: string | null
  toolCallCount: number
  activeMs: number
  tokenInputTotal: number
  tokenOutputTotal: number
  cacheReadTokens: number
  modelName: string | null
}

export interface AgentSlot {
  agentId: number
  source: string
  sessionId: string
  cwd: string
  label: string
  origin: string
  machineName: string | undefined
  state: ActivityState
  stateStartedAt: number
  lastEventAt: number
  createdAt: number
  exitingAt: number | undefined
  pendingIdleAt: number | undefined
  deskIndex: number
  toolCallCount: number
  activeMs: number
  unknownCwd: boolean
  parentId: number | undefined
  currentTool: string | undefined
  agentType: string | undefined
  sessionTotalTokens: number
  contextTotalTokens: number
  contextInputTokens: number
  tokenInputTotal: number
  tokenOutputTotal: number
  cacheReadTokens: number
  contextWindowLimit: number
  modelName: string | undefined
  completedChildren: CompletedChildInfo[]
}

export interface ReducerState {
  agents: HashMap.HashMap<string, AgentSlot>
  maxDesks: number
  nextLabelN: number
}

export interface ReducerMeta {
  activeTasks: HashMap.HashMap<string, HashSet.HashSet<string>>
  hookActiveAgents: Set<string>
  recentHookToolUses: HashMap.HashMap<string, number>
}

function idKey(id: number): string {
  return String(id)
}

function getSlot(agents: HashMap.HashMap<string, AgentSlot>, k: string): AgentSlot | undefined {
  const opt = HashMap.get(agents, k)
  return opt._tag === "Some" ? opt.value : undefined
}

function getTaskSet(tasks: HashMap.HashMap<string, HashSet.HashSet<string>>, k: string): HashSet.HashSet<string> {
  const opt = HashMap.get(tasks, k)
  return opt._tag === "Some" ? opt.value : HashSet.empty()
}

function getHookTs(uses: HashMap.HashMap<string, number>, k: string): number | undefined {
  const opt = HashMap.get(uses, k)
  return opt._tag === "Some" ? opt.value : undefined
}

export function nextFreeDesk(agents: HashMap.HashMap<string, AgentSlot>, maxDesks: number): number | undefined {
  const occupied = new Set<number>()
  for (const slot of HashMap.values(agents)) occupied.add(slot.deskIndex)
  const total = maxDesks * MAX_FLOORS
  for (let i = 0; i < total; i++) if (!occupied.has(i)) return i
  return undefined
}

export function createInitialState(maxDesks = 16): ReducerState {
  return { agents: HashMap.empty(), maxDesks, nextLabelN: 0 }
}

export function createMeta(): ReducerMeta {
  return { activeTasks: HashMap.empty(), hookActiveAgents: new Set(), recentHookToolUses: HashMap.empty() }
}

function toolDetailIsTask(d: { type: "task" } | { type: "generic"; toolName: string; display: string }): boolean {
  return d.type === "task"
}

function toolDetailToolName(d: { type: "task" } | { type: "generic"; toolName: string; display: string }): string | undefined {
  return d.type === "generic" ? d.toolName : undefined
}

function toolDetailDisplay(d: { type: "task" } | { type: "generic"; toolName: string; display: string }): string {
  return d.type === "generic" ? d.display : "Delegating"
}

export function gc(meta: ReducerMeta, now: number): void {
  const toRemove: string[] = []
  for (const [k, ts] of meta.recentHookToolUses) {
    if (now - ts > HOOK_WINS_WINDOW) toRemove.push(k)
  }
  for (const k of toRemove) meta.recentHookToolUses = HashMap.remove(meta.recentHookToolUses, k)
}

export function applyEvent(
  state: ReducerState,
  meta: ReducerMeta,
  event: { type: string; agentId: number; [key: string]: unknown },
  now: number,
  transport: string,
): ReducerState {
  gc(meta, now)
  sweepExited(state, meta, now)
  expirePendingIdles(state, now)

  const key = idKey(event.agentId)
  const slot = getSlot(state.agents, key)

  if (shouldDrop(transport, event, state, meta)) return state
  strategyPrelude(transport, event, slot, meta, now)

  const newSlot = applyHandler(slot, event, state, meta, now, transport)
  if (newSlot === slot) return state

  const newAgents = newSlot
    ? HashMap.set(state.agents, key, newSlot)
    : HashMap.remove(state.agents, key)

  return { ...state, agents: newAgents }
}

function shouldDrop(
  transport: string,
  event: { type: string; agentId: number; toolUseId?: string; [key: string]: unknown },
  state: ReducerState,
  meta: ReducerMeta,
): boolean {
  const key = idKey(event.agentId)
  const tasks = getTaskSet(meta.activeTasks, key)
  const inTask = tasks.size > 0

  if (transport === "hook" || transport === "remote-hook" || transport === "sse") {
    if (event.type === "activityStart") return inTask
    if (event.type === "activityEnd") {
      const tuid = event.toolUseId
      if (tuid && inTask) return !HashSet.has(tasks, tuid)
      return inTask
    }
    return false
  }

  if (transport === "jsonl") {
    const tuid = event.toolUseId
    if (tuid) {
      const ts = getHookTs(meta.recentHookToolUses, `${key}-${tuid}`)
      if (ts !== undefined) return true
    }
    if (event.type === "tokenUsage" && meta.hookActiveAgents.has(key)) return true
    return false
  }

  if (transport === "restore") {
    if (event.type === "tokenUsage" && meta.hookActiveAgents.has(key)) return true
    return false
  }

  return false
}

function strategyPrelude(
  transport: string,
  event: { type: string; agentId: number; toolUseId?: string; [key: string]: unknown },
  slot: AgentSlot | undefined,
  meta: ReducerMeta,
  now: number,
): void {
  if (transport === "hook" || transport === "remote-hook" || transport === "sse") {
    meta.hookActiveAgents.add(idKey(event.agentId))
    const tuid = event.toolUseId
    if (tuid) meta.recentHookToolUses = HashMap.set(meta.recentHookToolUses, `${idKey(event.agentId)}-${tuid}`, now)
    if (slot) slot.unknownCwd = false
  }
}

function applyHandler(
  slot: AgentSlot | undefined,
  event: { type: string; agentId: number; [key: string]: unknown },
  state: ReducerState,
  meta: ReducerMeta,
  now: number,
  transport: string,
): AgentSlot | undefined {
  switch (event.type) {
    case "sessionStart":
      return handleSessionStart(slot, event as any, state, meta, now, transport)
    case "activityStart":
      return handleActivityStart(slot, event as any, meta, now)
    case "activityEnd":
      return handleActivityEnd(slot, event as any, state, meta, now)
    case "waiting":
      return handleWaiting(slot, event as any, now)
    case "tokenUsage":
      return handleTokenUsage(slot, event as any)
    case "rename":
      return handleRename(slot, event as any)
    case "sessionEnd":
      return handleSessionEnd(slot, event as any, state, now)
    case "modelUpdate":
      return handleModelUpdate(slot, event as any)
    default:
      return slot
  }
}

function handleSessionStart(
  slot: AgentSlot | undefined,
  event: { type: "sessionStart"; agentId: number; source: string; sessionId: string; cwd: string; parentId: number | undefined; parentSessionId: string | undefined; agentType: string | undefined; contextWindowLimit: number | undefined; origin: string | undefined; machineName: string | undefined },
  state: ReducerState,
  meta: ReducerMeta,
  now: number,
  transport: string,
): AgentSlot | undefined {
  if (slot) return slot
  const desk = nextFreeDesk(state.agents, state.maxDesks)
  if (desk === undefined) {
    console.warn(`dropped SessionStart — all desks occupied (max_desks=${state.maxDesks})`, event.agentId)
    return undefined
  }

  const sourcePrefixes: Record<string, string> = { "claude-code": "cc", "antigravity": "ag", "opencode": "oc" }
  const prefix = sourcePrefixes[event.source] ?? event.source.slice(0, 2)

  const hasCwd = event.cwd.length > 0 && event.cwd !== "/" && (event.cwd.split("/").filter(Boolean).pop()?.length ?? 0) > 0
  const origin = event.origin ?? (transport === "remote-hook" ? "remote" : "local")
  const machineName = event.machineName
  const originSuffix = origin === "remote" && machineName
    ? `[${machineName.split(".")[0]}]`
    : origin === "remote" ? "[remote]"
    : ""

  const basename = event.cwd.split("/").filter(Boolean).pop() ?? ""
  state.nextLabelN++
  const label = hasCwd
    ? `${prefix}\u00b7${basename}${originSuffix}`
    : `${prefix}#${state.nextLabelN}${originSuffix}`

  let parentId = event.parentId
  if (!parentId && event.parentSessionId) {
    for (const existing of HashMap.values(state.agents)) {
      if (existing.sessionId === event.parentSessionId) { parentId = existing.agentId; break }
    }
  }

  return {
    agentId: event.agentId, source: event.source, sessionId: event.sessionId,
    cwd: event.cwd, label, origin, machineName,
    state: { type: "idle" }, stateStartedAt: now, lastEventAt: now, createdAt: now,
    exitingAt: undefined, pendingIdleAt: undefined, deskIndex: desk,
    toolCallCount: 0, activeMs: 0, unknownCwd: !hasCwd,
    parentId, currentTool: undefined, agentType: event.agentType,
    sessionTotalTokens: 0, contextTotalTokens: 0, contextInputTokens: 0,
    tokenInputTotal: 0, tokenOutputTotal: 0, cacheReadTokens: 0,
    contextWindowLimit: event.contextWindowLimit ?? 200000, modelName: undefined,
    completedChildren: [],
  }
}

function handleActivityStart(
  slot: AgentSlot | undefined,
  event: { type: "activityStart"; agentId: number; activity: string; toolUseId: string | undefined; detail: { type: "task" } | { type: "generic"; toolName: string; display: string } | undefined },
  meta: ReducerMeta,
  now: number,
): AgentSlot | undefined {
  if (!slot) return undefined
  const key = idKey(event.agentId)
  const newSlot = { ...slot }

  if (event.toolUseId && event.detail && toolDetailIsTask(event.detail)) {
    const tasks = getTaskSet(meta.activeTasks, key)
    meta.activeTasks = HashMap.set(meta.activeTasks, key, HashSet.add(tasks, event.toolUseId))
    newSlot.state = { type: "active", activity: "typing", toolUseId: event.toolUseId, detail: "Delegating" }
    newSlot.stateStartedAt = now
    newSlot.pendingIdleAt = undefined
    newSlot.lastEventAt = now
    return newSlot
  }

  if (event.detail && !toolDetailIsTask(event.detail)) {
    const newToolName = toolDetailToolName(event.detail)
    if (newSlot.state.type === "active" && newSlot.pendingIdleAt === undefined && newSlot.currentTool === newToolName) {
      return newSlot
    }
    newSlot.toolCallCount++
  }

  if (newSlot.state.type === "active") {
    newSlot.activeMs += Math.max(0, now - newSlot.stateStartedAt)
  }

  newSlot.state = {
    type: "active", activity: event.activity,
    toolUseId: event.toolUseId,
    detail: event.detail ? toolDetailDisplay(event.detail) : undefined,
  }
  newSlot.currentTool = event.detail ? toolDetailToolName(event.detail) ?? undefined : undefined
  newSlot.stateStartedAt = now
  newSlot.lastEventAt = now
  newSlot.pendingIdleAt = undefined
  return newSlot
}

function handleActivityEnd(
  slot: AgentSlot | undefined,
  event: { type: "activityEnd"; agentId: number; toolUseId: string | undefined },
  state: ReducerState,
  meta: ReducerMeta,
  now: number,
): AgentSlot | undefined {
  if (!slot) return undefined
  const newSlot = { ...slot }

  if (event.toolUseId) {
    const key = idKey(event.agentId)
    const tasks = getTaskSet(meta.activeTasks, key)
    if (HashSet.has(tasks, event.toolUseId)) {
      const newTasks = HashSet.remove(tasks, event.toolUseId)
      meta.activeTasks = newTasks.size === 0
        ? HashMap.remove(meta.activeTasks, key)
        : HashMap.set(meta.activeTasks, key, newTasks)
      newSlot.lastEventAt = now
      if (newTasks.size === 0) {
        cascadeSessionEnd(state, event.agentId, now)
        newSlot.pendingIdleAt = now
      }
      return newSlot
    }
  }

  if (newSlot.state.type === "active") newSlot.pendingIdleAt = now
  newSlot.lastEventAt = now
  return newSlot
}

function handleWaiting(
  slot: AgentSlot | undefined,
  event: { type: "waiting"; agentId: number; reason: string },
  now: number,
): AgentSlot | undefined {
  if (!slot) return undefined
  return { ...slot, state: { type: "waiting", reason: event.reason }, stateStartedAt: now, lastEventAt: now, pendingIdleAt: undefined }
}

function handleTokenUsage(
  slot: AgentSlot | undefined,
  event: { type: "tokenUsage"; agentId: number; input: number; output: number; cacheRead?: number; cumulative?: boolean; total?: number },
): AgentSlot | undefined {
  if (!slot) return undefined
  const newSlot = { ...slot }
  if (event.cumulative) {
    newSlot.contextInputTokens = event.input
    newSlot.tokenInputTotal = event.input >>> 0
    newSlot.tokenOutputTotal = event.output >>> 0
    newSlot.sessionTotalTokens = (event.input + event.output) >>> 0
    if (event.cacheRead !== undefined) newSlot.cacheReadTokens = event.cacheRead >>> 0
  } else {
    newSlot.contextInputTokens = event.input
    newSlot.tokenInputTotal = (newSlot.tokenInputTotal + event.input) >>> 0
    newSlot.tokenOutputTotal = (newSlot.tokenOutputTotal + event.output) >>> 0
    newSlot.sessionTotalTokens = (newSlot.sessionTotalTokens + event.input + event.output) >>> 0
    if (event.cacheRead !== undefined) newSlot.cacheReadTokens = (newSlot.cacheReadTokens + event.cacheRead) >>> 0
  }
  if (event.total !== undefined) newSlot.contextTotalTokens = event.total >>> 0
  newSlot.lastEventAt = Date.now()
  return newSlot
}

function handleRename(
  slot: AgentSlot | undefined,
  event: { type: "rename"; agentId: number; label: string },
): AgentSlot | undefined {
  if (!slot) return undefined
  const existingSuffix = slot.label.match(/\[.*?\]$/)?.[0] ?? ""
  const hasSuffix = /\[.*?\]$/.test(event.label)
  return { ...slot, label: existingSuffix && !hasSuffix ? event.label + existingSuffix : event.label, lastEventAt: Date.now() }
}

function handleModelUpdate(
  slot: AgentSlot | undefined,
  event: { type: "modelUpdate"; agentId: number; modelId: string; contextWindowLimit?: number },
): AgentSlot | undefined {
  if (!slot) return undefined
  return { ...slot, modelName: event.modelId, contextWindowLimit: event.contextWindowLimit ?? slot.contextWindowLimit, lastEventAt: Date.now() }
}

function handleSessionEnd(
  slot: AgentSlot | undefined,
  event: { type: "sessionEnd"; agentId: number },
  state: ReducerState,
  now: number,
): AgentSlot | undefined {
  if (!slot || slot.exitingAt !== undefined) return slot
  cascadeSessionEnd(state, event.agentId, now)
  return { ...slot, exitingAt: now }
}

function cascadeSessionEnd(state: ReducerState, rootId: number, now: number): void {
  const visited = new Set<number>()
  visited.add(rootId)
  const frontier: number[] = [rootId]
  while (frontier.length > 0) {
    const parent = frontier.pop()!
    for (const [key, sl] of state.agents) {
      if (sl.parentId === parent && sl.exitingAt === undefined && !visited.has(sl.agentId)) {
        visited.add(sl.agentId)
        state.agents = HashMap.set(state.agents, key, { ...sl, exitingAt: now })
        frontier.push(sl.agentId)
      }
    }
  }
}

export function expirePendingIdles(state: ReducerState, now: number): void {
  for (const [key, slot] of state.agents) {
    if (slot.pendingIdleAt === undefined) continue
    if (now - slot.pendingIdleAt >= ACTIVE_GRACE_WINDOW) {
      if (slot.state.type === "active") {
        const elapsed = Math.max(0, slot.pendingIdleAt - slot.stateStartedAt)
        state.agents = HashMap.set(state.agents, key, {
          ...slot, activeMs: slot.activeMs + elapsed,
          state: { type: "idle" }, stateStartedAt: now, pendingIdleAt: undefined,
        })
      } else {
        state.agents = HashMap.set(state.agents, key, { ...slot, pendingIdleAt: undefined })
      }
    }
  }
}

export function sweepStale(state: ReducerState, now: number): void {
  for (const [key, slot] of state.agents) {
    if (slot.exitingAt !== undefined) continue
    const age = Math.max(0, now - slot.lastEventAt)
    const threshold = slot.unknownCwd ? STALE_UNKNOWN_CWD_TIMEOUT
      : slot.state.type === "active" ? STALE_ACTIVE_TIMEOUT
        : slot.state.type === "idle" ? STALE_IDLE_TIMEOUT
          : STALE_WAITING_TIMEOUT
    if (age > threshold) {
      console.info(`stale agent — marking exiting: ${slot.agentId} (${slot.label}), age=${Math.round(age / 1000)}s`)
      state.agents = HashMap.set(state.agents, key, { ...slot, exitingAt: now })
    }
  }
}

export function sweepExited(state: ReducerState, meta: ReducerMeta, now: number): void {
  const expired: Array<[string, AgentSlot]> = []
  for (const entry of state.agents) expired.push(entry)
  for (const [key, slot] of expired) {
    if (slot.exitingAt === undefined || now - slot.exitingAt <= EXIT_GRACE_WINDOW) continue
    if (slot.parentId !== undefined) {
      const pKey = idKey(slot.parentId)
      const pOpt = HashMap.get(state.agents, pKey)
      if (pOpt._tag === "Some") {
        const parent = pOpt.value
        state.agents = HashMap.set(state.agents, pKey, {
          ...parent, completedChildren: [...parent.completedChildren, {
            agentId: slot.agentId, label: slot.label, agentType: slot.agentType ?? null,
            toolCallCount: slot.toolCallCount, activeMs: slot.activeMs,
            tokenInputTotal: slot.tokenInputTotal, tokenOutputTotal: slot.tokenOutputTotal,
            cacheReadTokens: slot.cacheReadTokens, modelName: slot.modelName ?? null,
          }],
        })
      }
    }
    state.agents = HashMap.remove(state.agents, key)
    meta.activeTasks = HashMap.remove(meta.activeTasks, key)
    meta.hookActiveAgents.delete(key)
  }
}

export function tick(state: ReducerState, meta: ReducerMeta, now: number): void {
  gc(meta, now)
  sweepExited(state, meta, now)
  expirePendingIdles(state, now)
  sweepStale(state, now)
}
