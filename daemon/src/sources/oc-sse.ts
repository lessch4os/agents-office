import { Effect, Queue, Stream, Schedule } from "effect"
import { decodeOcEvent, ocDeriveLabel, extractSessionId, extractTokensFromEvent, extractModelIdFromEvent } from "../decoders/oc-sse"
import { hashAgentId } from "../schemas/agent-id"
import type { OcSseEvent } from "../decoders/oc-sse"
import type { AgentEvent } from "../schemas/agent-event"
import { lookupContextLimit } from "../services/pricing"

const RECONNECT_DELAY_MS = 5000

export interface OcSseSource {
  readonly events: Stream.Stream<readonly [AgentEvent, string]>
}

export function makeOcSseSource(
  baseUrl: string,
  source: string,
): Effect.Effect<OcSseSource, never, never> {
  return Effect.gen(function* () {
    const queue = yield* Queue.unbounded<readonly [AgentEvent, string]>()
    let closed = false

    function emit(ev: AgentEvent) {
      Queue.unsafeOffer(queue, [ev, source] as const)
    }

    async function tryImportSdk(): Promise<{ createOpencodeClient: Function | null }> {
      try {
        const mod = await import("@opencode-ai/sdk")
        const fn = (mod as Record<string, unknown>).createOpencodeClient
        return { createOpencodeClient: typeof fn === "function" ? fn : null }
      } catch { return { createOpencodeClient: null } }
    }

    type SessionRecord = {
      agentId: number
      cwd: string
      label: string
      prevInputTokens: number
      prevOutputTokens: number
      modelId: string | null
    }

    async function connectAndStream(): Promise<void> {
      const { createOpencodeClient } = await tryImportSdk()
      if (!createOpencodeClient) {
        await new Promise((r) => setTimeout(r, RECONNECT_DELAY_MS * 6))
        return
      }

      const client = createOpencodeClient({ baseUrl })
      const events: { stream: AsyncIterable<OcSseEvent> } = await client.event.subscribe()

      const sessions = new Map<string, SessionRecord>()

      for await (const event of events.stream) {
        if (closed) break
        const sessionId = extractSessionId(event)
        if (!sessionId) continue

        let record = sessions.get(sessionId)
        if (!record) {
          const cwd = (event.properties as Record<string, unknown>)?.directory as string ?? ""
          const label = ocDeriveLabel(cwd)
          record = {
            agentId: hashAgentId(source, sessionId),
            cwd, label,
            prevInputTokens: 0, prevOutputTokens: 0, modelId: null,
          }
          sessions.set(sessionId, record)
        }

        if (event.type === "message.updated" || event.type === "message.part.updated") {
          const tokens = extractTokensFromEvent(event)
          if (tokens) {
            const inputDelta = Math.max(0, tokens.input - record.prevInputTokens)
            const outputDelta = Math.max(0, tokens.output - record.prevOutputTokens)
            record.prevInputTokens = tokens.input
            record.prevOutputTokens = tokens.output
            if (inputDelta > 0 || outputDelta > 0) {
              emit({ type: "tokenUsage", agentId: record.agentId, input: tokens.input, output: tokens.output, cumulative: true })
            }
          }
          const modelId = extractModelIdFromEvent(event)
          if (modelId && modelId !== record.modelId) record.modelId = modelId
        }

        const evts = decodeOcEvent(record.agentId, source, event, record.label, lookupContextLimit)
        for (const ev of evts) emit(ev)

        if (event.type === "session.deleted") sessions.delete(sessionId)
      }
    }

    // Background fiber that loops with reconnect
    yield* Effect.forkScoped(
      Effect.repeat(
        Effect.tryPromise({ try: () => connectAndStream(), catch: () => undefined }),
        Schedule.addDelay(Schedule.forever, () => RECONNECT_DELAY_MS),
      ),
    )

    return { events: Stream.fromQueue(queue) }
  }).pipe(Effect.scoped)
}
