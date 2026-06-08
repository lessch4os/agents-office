import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core"

export const sessions = sqliteTable("sessions", {
  sessionId: text("session_id").primaryKey(),
  parentSessionId: text("parent_session_id"),
  source: text("source").notNull(),
  label: text("label").notNull().default(""),
  cwd: text("cwd").notNull().default(""),
  agentType: text("agent_type"),
  contextWindowLimit: integer("context_window_limit").notNull().default(200000),
  startedAt: integer("started_at").notNull(),
  endedAt: integer("ended_at"),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
  toolCallCount: integer("tool_call_count").notNull().default(0),
  activeMs: integer("active_ms").notNull().default(0),
  costUsd: real("cost_usd").notNull().default(0),
  cacheHitRate: real("cache_hit_rate").notNull().default(0),
  tags: text("tags").notNull().default("[]"),
  modelName: text("model_name"),
})

export const rawEvents = sqliteTable("raw_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ts: integer("ts").notNull(),
  sessionId: text("session_id"),
  transport: text("transport"),
  payload: text("payload").notNull(),
})

export const tokenSnapshots = sqliteTable("token_snapshots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: text("session_id").notNull(),
  ts: integer("ts").notNull(),
  cumulInput: integer("cumul_input").notNull().default(0),
  cumulOutput: integer("cumul_output").notNull().default(0),
  cumulCache: integer("cumul_cache").notNull().default(0),
  contextPct: real("context_pct").notNull().default(0),
})

export const modelPricing = sqliteTable("model_pricing", {
  modelName: text("model_name").primaryKey(),
  inputPerM: real("input_per_m").notNull().default(0),
  outputPerM: real("output_per_m").notNull().default(0),
  cacheReadPerM: real("cache_read_per_m").notNull().default(0),
  source: text("source").notNull().default("auto"),
})
