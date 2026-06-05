import type { Db } from "../db"
import { modelPricing } from "../db/schema"
import { eq } from "drizzle-orm"

const DEFAULT_TABLE: Record<string, { inputPerM: number; outputPerM: number; cacheReadPerM: number }> = {
  "claude-sonnet-4-20250514":       { inputPerM: 3.0,   outputPerM: 15.0,  cacheReadPerM: 0.30 },
  "claude-sonnet-4":                { inputPerM: 3.0,   outputPerM: 15.0,  cacheReadPerM: 0.30 },
  "claude-3-5-sonnet-20241022":     { inputPerM: 3.0,   outputPerM: 15.0,  cacheReadPerM: 0.30 },
  "claude-3-5-haiku-20241022":      { inputPerM: 3.0,   outputPerM: 15.0,  cacheReadPerM: 0.30 },
  "claude-opus-4-20250514":         { inputPerM: 15.0,  outputPerM: 75.0,  cacheReadPerM: 0.30 },
  "gpt-4o":                         { inputPerM: 2.50,  outputPerM: 10.0,  cacheReadPerM: 0.0  },
  "gpt-4o-mini":                    { inputPerM: 0.15,  outputPerM: 0.60,  cacheReadPerM: 0.0  },
  "o4-mini":                        { inputPerM: 1.10,  outputPerM: 4.40,  cacheReadPerM: 0.0  },
  "o3":                             { inputPerM: 10.0,  outputPerM: 40.0,  cacheReadPerM: 0.0  },
  "gemini-2.5-pro":                 { inputPerM: 1.25,  outputPerM: 10.0,  cacheReadPerM: 0.0  },
  "gemini-2.0-flash":               { inputPerM: 0.10,  outputPerM: 0.40,  cacheReadPerM: 0.0  },
  "deepseek-chat":                  { inputPerM: 0.27,  outputPerM: 1.10,  cacheReadPerM: 0.07 },
  "deepseek-v4-flash":              { inputPerM: 0.15,  outputPerM: 0.60,  cacheReadPerM: 0.07 },
}

const DEFAULT_LIMITS: Record<string, number> = {
  "claude-sonnet-4-20250514":   200000,
  "claude-sonnet-4":            200000,
  "claude-3-5-sonnet-20241022": 200000,
  "claude-3-5-haiku-20241022":  200000,
  "claude-opus-4-20250514":     200000,
  "gpt-4o":                     128000,
  "gpt-4o-mini":                128000,
  "o4-mini":                    200000,
  "o3":                         200000,
  "gemini-2.5-pro":             1000000,
  "gemini-2.0-flash":           1000000,
  "deepseek-chat":              64000,
  "deepseek-v4-flash":          1000000,
}

export function lookupContextLimit(modelId: string | null): number {
  if (!modelId) return 200000
  return DEFAULT_LIMITS[modelId] ?? 200000
}

export function seedPricing(db: Db): void {
  const existing = db.select().from(modelPricing).all()
  if (existing.length > 0) return
  for (const [name, p] of Object.entries(DEFAULT_TABLE)) {
    db.insert(modelPricing).values({
      modelName: name,
      inputPerM: p.inputPerM,
      outputPerM: p.outputPerM,
      cacheReadPerM: p.cacheReadPerM,
      source: "default",
    }).run()
  }
}

export function resetPricingToDefaults(db: Db): void {
  db.delete(modelPricing).run()
  seedPricing(db)
}
