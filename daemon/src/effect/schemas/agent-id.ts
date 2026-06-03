import { Schema } from "@effect/schema"

const FNV_OFFSET_BASIS_64 = 14695981039346656037n
const FNV_PRIME_64 = 1099511628211n

function fnv1a64(input: string): bigint {
  let hash = FNV_OFFSET_BASIS_64
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i))
    hash = (hash * FNV_PRIME_64) & 0xffffffffffffffffn
  }
  return hash
}

export function hashAgentId(domain: string, key: string): number {
  return Number(fnv1a64(`${domain}:${key}`))
}

export const AgentId = Schema.Number.pipe(Schema.brand("AgentId"))
export type AgentId = Schema.Schema.Type<typeof AgentId>
