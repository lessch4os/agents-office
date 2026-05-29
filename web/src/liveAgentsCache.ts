import type { WireAgent } from "./types"

let cache: WireAgent[] | null = null

export function setLiveAgentsCache(agents: WireAgent[]) {
  cache = agents
}

export function getLiveAgentsCache(): WireAgent[] {
  return cache ?? []
}
