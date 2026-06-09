import { describeToolTarget, makeToolDetail, getNum, getStr } from "./hook-decoder"
import type { AgentEvent } from "../schemas/agent-event"

function extractTokenUsage(usageObj: Record<string, unknown>, agentId: number): AgentEvent | null {
  const rawInput = getNum(usageObj, "input_tokens") ?? 0
  const cacheRead = getNum(usageObj, "cache_read_input_tokens") ?? 0
  const cacheCreation = getNum(usageObj, "cache_creation_input_tokens") ?? 0
  const input = rawInput + cacheRead + cacheCreation
  const output = getNum(usageObj, "output_tokens") ?? 0
  if (input === 0 && output === 0) return null
  const event: AgentEvent = { type: "tokenUsage", agentId, input, output, cumulative: true }
  if (cacheRead > 0) event.cacheRead = cacheRead
  event.total = input + output
  return event
}

export function decodeCcLine(
  transcriptPath: string,
  source: string,
  agentId: number,
  json: Record<string, unknown>,
): AgentEvent[] {
  const out: AgentEvent[] = []

  const attribution = json["attributionAgent"]
  if (typeof attribution === "string") {
    const label = attribution.split(":").pop() ?? attribution
    out.push({ type: "rename", agentId, label })
  }

  const message = json["message"]
  if (!message || typeof message !== "object" || Array.isArray(message)) return out
  const msgObj = message as Record<string, unknown>

  const ty = json["type"]
  const content = msgObj["content"]

  if (ty === "assistant" && Array.isArray(content)) {
    const usage = msgObj["usage"]
    if (usage && typeof usage === "object" && !Array.isArray(usage)) {
      const tokenEvent = extractTokenUsage(usage as Record<string, unknown>, agentId)
      if (tokenEvent) out.push(tokenEvent)
    }
    for (const block of content) {
      if (!block || typeof block !== "object" || Array.isArray(block)) continue
      const bobj = block as Record<string, unknown>
      const btype = bobj["type"]
      if (typeof btype !== "string") continue
      const decoded = decodeBlock(btype, bobj, agentId)
      if (decoded) out.push(...decoded)
    }
  } else if (ty === "user" && Array.isArray(content)) {
    for (const block of content) {
      if (!block || typeof block !== "object" || Array.isArray(block)) continue
      const bobj = block as Record<string, unknown>
      const btype = bobj["type"]
      if (typeof btype !== "string") continue
      const decoded = decodeBlock(btype, bobj, agentId)
      if (decoded) out.push(...decoded)
    }
  }

  return out
}

function decodeBlock(blockType: string, block: Record<string, unknown>, agentId: number): AgentEvent[] | null {
  if (blockType === "tool_use") {
    const id = typeof block["id"] === "string" ? block["id"] as string : undefined
    const name = typeof block["name"] === "string" ? block["name"] as string : "?"
    const input = block["input"]
    const target = describeToolTarget(name, input)
    return [{
      type: "activityStart",
      agentId,
      activity: "typing",
      toolUseId: id ?? undefined,
      detail: makeToolDetail(name, target),
    }]
  }
  if (blockType === "tool_result") {
    const id = typeof block["tool_use_id"] === "string" ? block["tool_use_id"] as string : undefined
    return [{
      type: "activityEnd",
      agentId,
      toolUseId: id ?? undefined,
    }]
  }
  return null
}

export function ccSessionEnded(tail: Uint8Array): boolean {
  const text = new TextDecoder().decode(tail)
  let lastIsEnd = false
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      continue
    }
    if (typeof parsed !== "object" || Array.isArray(parsed)) continue
    const subtype = parsed["subtype"]
    const hook = parsed["hook_event_name"]
    if (subtype === "session_start") lastIsEnd = false
    if (subtype === "session_end" || hook === "SessionEnd") lastIsEnd = true
  }
  return lastIsEnd
}

export function ccDeriveLabel(path: string, cwd: string): string {
  const isSubagent = path.includes("subagents")
  if (isSubagent) return "subagent"
  const base = cwd.split("/").filter(Boolean).pop()
  if (base && base !== "/") return `cc\u00b7${base}`
  return "cc"
}
