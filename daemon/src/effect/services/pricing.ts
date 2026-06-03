import type { AgentEvent } from "../schemas/agent-event"

const DEFAULT_LIMITS: Record<string, number> = {
  "claude-sonnet-4-20250514": 200000,
  "claude-sonnet-4": 200000,
  "claude-4-20250514": 200000,
  "claude-4": 200000,
  "claude-3.5-sonnet": 200000,
  "claude-3-opus": 200000,
  "claude-3-haiku": 200000,
  "gpt-4o": 128000,
  "gpt-4": 128000,
  "gemini-2.0-flash": 1000000,
  "gemini-2.5-pro": 1000000,
  "deepseek-chat": 128000,
  "deepseek-reasoner": 128000,
}

const DEFAULT: { limit: number; inputPrice: number; outputPrice: number; cacheReadPrice: number } = {
  limit: 128000, inputPrice: 0, outputPrice: 0, cacheReadPrice: 0,
}

export function lookupContextLimit(modelId: string | null): number {
  if (!modelId) return DEFAULT.limit
  for (const [prefix, limit] of Object.entries(DEFAULT_LIMITS)) {
    if (modelId.startsWith(prefix) || modelId === prefix) return limit
  }
  return DEFAULT.limit
}
