import { describe, test, expect } from "bun:test"
import { Database } from "bun:sqlite"
import { migrate, getCurrentVersion } from "./migrate"
import * as schema from "./schema"

describe("DB migration", () => {
  function makeEmptyDb(): Database {
    const db = new Database(":memory:")
    db.run("PRAGMA journal_mode=WAL")
    return db
  }

  function makeLegacyDb(): Database {
    const db = new Database(":memory:")
    db.run("PRAGMA journal_mode=WAL")
    db.run(`CREATE TABLE IF NOT EXISTS sessions (
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
    )`)
    db.run(`CREATE TABLE IF NOT EXISTS raw_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL, session_id TEXT,
      payload TEXT NOT NULL
    )`)
    db.run(`CREATE TABLE IF NOT EXISTS token_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL, ts INTEGER NOT NULL,
      cumul_input INTEGER NOT NULL DEFAULT 0,
      cumul_output INTEGER NOT NULL DEFAULT 0,
      context_pct REAL NOT NULL DEFAULT 0.0
    )`)
    db.run("INSERT INTO sessions (session_id, source, started_at) VALUES ('test-session', 'hook', 1000)")
    db.run("INSERT INTO raw_events (ts, session_id, payload) VALUES (1000, 'test-session', '{}')")
    return db
  }

  function getColumns(db: Database, table: string): string[] {
    return (db.query(`PRAGMA table_info('${table}')`).all() as { name: string }[]).map(c => c.name)
  }

  test("fresh DB gets correct schema and version", () => {
    const db = makeEmptyDb()
    migrate(db)

    expect(getCurrentVersion(db)).toBe(1)

    const sessionCols = getColumns(db, "sessions")
    expect(sessionCols).toContain("session_id")
    expect(sessionCols).toContain("model_name")

    const rawCols = getColumns(db, "raw_events")
    expect(rawCols).toContain("transport")
    expect(rawCols).toContain("payload")

    const snapCols = getColumns(db, "token_snapshots")
    expect(snapCols).toContain("session_id")
    expect(snapCols).toContain("context_pct")

    const pricingCols = getColumns(db, "model_pricing")
    expect(pricingCols).toContain("model_id")
    expect(pricingCols).toContain("context_window")
  })

  test("legacy DB gets raw_events recreated with transport column", () => {
    const db = makeLegacyDb()

    const beforeCols = getColumns(db, "raw_events")
    expect(beforeCols).not.toContain("transport")

    migrate(db)

    expect(getCurrentVersion(db)).toBe(1)

    const afterCols = getColumns(db, "raw_events")
    expect(afterCols).toContain("transport")

    const sessions = db.query("SELECT session_id FROM sessions").all() as { session_id: string }[]
    expect(sessions.length).toBeGreaterThan(0)
  })

  test("idempotent: running migrate twice does not fail", () => {
    const db = makeEmptyDb()
    migrate(db)
    expect(getCurrentVersion(db)).toBe(1)
    migrate(db)
    expect(getCurrentVersion(db)).toBe(1)
  })
})
