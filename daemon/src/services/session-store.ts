import { SqlClient } from "@effect/sql"
import { Effect, Stream } from "effect"

export interface SessionRow {
  session_id: string
  parent_session_id: string | null
  source: string
  label: string
  cwd: string
  agent_type: string | null
  context_window_limit: number
  started_at: number
  ended_at: number | null
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  tool_call_count: number
  active_ms: number
  cost_usd: number
  cache_hit_rate: number
  tags: string
  model_name: string | null
}

export function createSession(
  sql: SqlClient.SqlClient,
  session: SessionRow,
): Effect.Effect<void> {
  return sql`
    INSERT INTO sessions ${sql.insert(session)}
    ON CONFLICT(session_id) DO UPDATE SET
      label = excluded.label,
      source = excluded.source
  `.pipe(Effect.asVoid)
}

export function getSession(
  sql: SqlClient.SqlClient,
  sessionId: string,
): Effect.Effect<SessionRow | undefined> {
  return sql<SessionRow[]>`
    SELECT * FROM sessions WHERE session_id = ${sessionId}
  `.pipe(Effect.map((rows) => rows.at(0)))
}

export function listSessions(
  sql: SqlClient.SqlClient,
  limit = 50,
  offset = 0,
): Effect.Effect<SessionRow[]> {
  return sql<SessionRow[]>`
    SELECT * FROM sessions ORDER BY started_at DESC LIMIT ${limit} OFFSET ${offset}
  `
}

export function updateTokens(
  sql: SqlClient.SqlClient,
  sessionId: string,
  input: number,
  output: number,
  cacheRead: number,
  cumulative?: boolean,
): Effect.Effect<void> {
  if (cumulative) {
    return sql`
      UPDATE sessions SET
        input_tokens = ${input},
        output_tokens = ${output},
        cache_read_tokens = ${cacheRead}
      WHERE session_id = ${sessionId}
    `.pipe(Effect.asVoid)
  }
  return sql`
    UPDATE sessions SET
      input_tokens = input_tokens + ${input},
      output_tokens = output_tokens + ${output},
      cache_read_tokens = cache_read_tokens + ${cacheRead}
    WHERE session_id = ${sessionId}
  `.pipe(Effect.asVoid)
}

export function endSession(
  sql: SqlClient.SqlClient,
  sessionId: string,
  endedAt: number,
): Effect.Effect<void> {
  return sql`
    UPDATE sessions SET ended_at = ${endedAt} WHERE session_id = ${sessionId}
  `.pipe(Effect.asVoid)
}

export function addTag(
  sql: SqlClient.SqlClient,
  sessionId: string,
  tag: string,
): Effect.Effect<void> {
  return sql`
    UPDATE sessions SET tags = json_insert(tags, '$[#]', ${tag})
    WHERE session_id = ${sessionId}
  `.pipe(Effect.asVoid)
}

export function storeRawEvent(
  sql: SqlClient.SqlClient,
  ts: number,
  sessionId: string | undefined,
  transport: string | undefined,
  payload: string,
): Effect.Effect<void> {
  return sql`
    INSERT INTO raw_events (ts, session_id, transport, payload)
    VALUES (${ts}, ${sessionId ?? null}, ${transport ?? null}, ${payload})
  `.pipe(Effect.asVoid)
}

export function restoreActiveSessions(
  sql: SqlClient.SqlClient,
): Effect.Effect<SessionRow[]> {
  return sql<SessionRow[]>`
    SELECT * FROM sessions WHERE ended_at IS NULL
  `
}
