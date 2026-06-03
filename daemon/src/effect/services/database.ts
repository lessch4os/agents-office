import { SqlClient } from "@effect/sql"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { Effect, Layer } from "effect"

export function dbLayer(dbPath: string): Layer.Layer<SqlClient.SqlClient> {
  return SqliteClient.layer({ filename: dbPath })
}

export function migrate(client: SqlClient.SqlClient): Effect.Effect<void> {
  return Effect.gen(function* () {
    yield* client`
      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        parent_session_id TEXT,
        source TEXT NOT NULL,
        label TEXT NOT NULL DEFAULT '',
        cwd TEXT NOT NULL DEFAULT '',
        agent_type TEXT,
        context_window_limit INTEGER NOT NULL DEFAULT 200000,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens INTEGER NOT NULL DEFAULT 0,
        tool_call_count INTEGER NOT NULL DEFAULT 0,
        active_ms INTEGER NOT NULL DEFAULT 0,
        cost_usd REAL NOT NULL DEFAULT 0.0,
        cache_hit_rate REAL NOT NULL DEFAULT 0.0,
        tags TEXT NOT NULL DEFAULT '[]',
        model_name TEXT
      )
    `
    yield* client`
      CREATE TABLE IF NOT EXISTS token_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        ts INTEGER NOT NULL,
        cumul_input INTEGER NOT NULL DEFAULT 0,
        cumul_output INTEGER NOT NULL DEFAULT 0,
        cumul_cache INTEGER NOT NULL DEFAULT 0,
        context_pct REAL NOT NULL DEFAULT 0.0,
        FOREIGN KEY (session_id) REFERENCES sessions(session_id)
      )
    `
    yield* client`
      CREATE TABLE IF NOT EXISTS raw_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        session_id TEXT,
        transport TEXT,
        payload TEXT NOT NULL
      )
    `
    yield* client`
      CREATE TABLE IF NOT EXISTS model_pricing (
        model_id TEXT PRIMARY KEY,
        input_per_token REAL NOT NULL DEFAULT 0.0,
        output_per_token REAL NOT NULL DEFAULT 0.0,
        cache_read_per_token REAL NOT NULL DEFAULT 0.0,
        context_window INTEGER NOT NULL DEFAULT 0
      )
    `
  })
}
