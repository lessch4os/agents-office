export interface Migration {
  version: number
  description: string
  up: string[]
}

export const migrations: Migration[] = [
  {
    version: 1,
    description: "Create core tables: sessions, raw_events, token_snapshots, model_pricing",
    up: [
      `CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY, parent_session_id TEXT,
        source TEXT NOT NULL, label TEXT NOT NULL DEFAULT '',
        cwd TEXT NOT NULL DEFAULT '', agent_type TEXT,
        context_window_limit INTEGER NOT NULL DEFAULT 200000,
        started_at INTEGER NOT NULL, ended_at INTEGER,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens INTEGER NOT NULL DEFAULT 0,
        tool_call_count INTEGER NOT NULL DEFAULT 0,
        active_ms INTEGER NOT NULL DEFAULT 0,
        cost_usd REAL NOT NULL DEFAULT 0.0,
        cache_hit_rate REAL NOT NULL DEFAULT 0.0,
        tags TEXT NOT NULL DEFAULT '[]',
        model_name TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS raw_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL, session_id TEXT,
        transport TEXT, payload TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS token_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL, ts INTEGER NOT NULL,
        cumul_input INTEGER NOT NULL DEFAULT 0,
        cumul_output INTEGER NOT NULL DEFAULT 0,
        context_pct REAL NOT NULL DEFAULT 0.0
      )`,
      `CREATE TABLE IF NOT EXISTS model_pricing (
        model_id TEXT PRIMARY KEY,
        input_per_token REAL NOT NULL DEFAULT 0.0,
        output_per_token REAL NOT NULL DEFAULT 0.0,
        cache_read_per_token REAL NOT NULL DEFAULT 0.0,
        context_window INTEGER NOT NULL DEFAULT 0
      )`,
    ],
  },
  {
    version: 2,
    description: "Fix model_pricing columns to match FE wire format: model_name, input_per_m, output_per_m, cache_read_per_m, source",
    up: [
      "DROP TABLE IF EXISTS model_pricing",
      `CREATE TABLE IF NOT EXISTS model_pricing (
        model_name TEXT PRIMARY KEY,
        input_per_m REAL NOT NULL DEFAULT 0.0,
        output_per_m REAL NOT NULL DEFAULT 0.0,
        cache_read_per_m REAL NOT NULL DEFAULT 0.0,
        source TEXT NOT NULL DEFAULT 'auto'
      )`,
    ],
  },
  {
    version: 3,
    description: "Add cumul_cache column to token_snapshots for existing DBs",
    up: [
    ],
  },
  {
    version: 4,
    description: "Drop stale agent_id column from sessions (schema cleanup)",
    up: [
    ],
  },
  {
    version: 5,
    description: "Add origin and machine_name columns to sessions for remote/local tracking",
    up: [
      "ALTER TABLE sessions ADD COLUMN origin TEXT NOT NULL DEFAULT 'local'",
      "ALTER TABLE sessions ADD COLUMN machine_name TEXT",
    ],
  },
]
