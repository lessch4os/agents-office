import { getLiveAgentsCache } from "./liveAgentsCache"
import type { WireTokenSnapshot } from "./types"

export interface ContextWindowData {
  used: number
  limit: number
  pct: number
}

export function getContextWindow(
  sessionId: string,
  windowLimit: number,
  snapshots?: WireTokenSnapshot[],
): ContextWindowData | null {
  if (!windowLimit) return null

  const live = getLiveAgentsCache().find((a) => a.session_id === sessionId)
  if (live && live.context_window_limit > 0) {
    const pct = Math.min(1, live.context_total_tokens / live.context_window_limit)
    return { used: live.context_total_tokens, limit: live.context_window_limit, pct }
  }

  if (snapshots && snapshots.length > 0) {
    const last = snapshots[snapshots.length - 1]
    if (last.context_pct > 0) {
      const pct = Math.min(1, last.context_pct)
      return { used: Math.round(pct * windowLimit), limit: windowLimit, pct }
    }
  }

  return null
}
