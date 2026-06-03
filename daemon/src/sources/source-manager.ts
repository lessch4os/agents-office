import { Stream } from "effect"
import type { AgentEvent } from "../schemas/agent-event"

export type TaggedAgentEvent = readonly [event: AgentEvent, transport: string, sessionId?: string]

export function mergeSources(
  ...sources: Array<Stream.Stream<TaggedAgentEvent>>
): Stream.Stream<TaggedAgentEvent> {
  if (sources.length === 0) return Stream.empty
  if (sources.length === 1) return sources[0]
  let merged = sources[0]
  for (let i = 1; i < sources.length; i++) {
    merged = Stream.merge(merged, sources[i])
  }
  return merged
}
