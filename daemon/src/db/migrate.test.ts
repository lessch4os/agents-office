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

    expect(getCurrentVersion(db)).toBe(4)

    const sessionCols = getColumns(db, "sessions")
    expect(sessionCols).toContain("session_id")
    expect(sessionCols).toContain("model_name")
    expect(sessionCols).not.toContain("agent_id")

    const rawCols = getColumns(db, "raw_events")
    expect(rawCols).toContain("transport")
    expect(rawCols).toContain("payload")

    const snapCols = getColumns(db, "token_snapshots")
    expect(snapCols).toContain("session_id")
    expect(snapCols).toContain("context_pct")
    expect(snapCols).toContain("cumul_cache")

    const pricingCols = getColumns(db, "model_pricing")
    expect(pricingCols).toContain("model_name")
    expect(pricingCols).toContain("input_per_m")
    expect(pricingCols).toContain("output_per_m")
    expect(pricingCols).toContain("cache_read_per_m")
    expect(pricingCols).toContain("source")
  })

  test("legacy DB gets raw_events recreated with transport column", () => {
    const db = makeLegacyDb()

    const beforeCols = getColumns(db, "raw_events")
    expect(beforeCols).not.toContain("transport")

    migrate(db)

    expect(getCurrentVersion(db)).toBe(4)

    const afterCols = getColumns(db, "raw_events")
    expect(afterCols).toContain("transport")

    const sessions = db.query("SELECT session_id FROM sessions").all() as { session_id: string }[]
    expect(sessions.length).toBeGreaterThan(0)
  })

  test("idempotent: running migrate twice does not fail", () => {
    const db = makeEmptyDb()
    migrate(db)
    expect(getCurrentVersion(db)).toBe(4)
    migrate(db)
    expect(getCurrentVersion(db)).toBe(4)
  })

  test("v2 upgrades model_pricing columns", () => {
    const db = makeEmptyDb()
    db.run(`CREATE TABLE IF NOT EXISTS model_pricing (
      model_id TEXT PRIMARY KEY,
      input_per_token REAL NOT NULL DEFAULT 0.0,
      output_per_token REAL NOT NULL DEFAULT 0.0,
      cache_read_per_token REAL NOT NULL DEFAULT 0.0,
      context_window INTEGER NOT NULL DEFAULT 0
    )`)
    db.run("PRAGMA user_version = 1")

    const beforeCols = getColumns(db, "model_pricing")
    expect(beforeCols).toContain("model_id")
    expect(beforeCols).not.toContain("model_name")

    migrate(db)

    expect(getCurrentVersion(db)).toBe(4)
    const afterCols = getColumns(db, "model_pricing")
    expect(afterCols).toContain("model_name")
    expect(afterCols).toContain("source")
    expect(afterCols).not.toContain("model_id")
  })

  test("v0.1.31 legacy DB upgrades correctly and preserves data", () => {
    const db = makeEmptyDb()
    // Create OLD schema (v0.1.31 style — missing cost_usd, cache_hit_rate, tags, transport, model_pricing does not exist)
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
    db.run("INSERT INTO sessions (session_id, source, started_at, label) VALUES ('legacy-s1', 'hook', 1000, 'old-session')")
    db.run("INSERT INTO raw_events (ts, session_id, payload) VALUES (1000, 'legacy-s1', '{\"type\":\"test\"}')")
    db.run("INSERT INTO token_snapshots (session_id, ts, cumul_input, cumul_output) VALUES ('legacy-s1', 1000, 10, 5)")
    db.run("PRAGMA user_version = 0")

    migrate(db)

    expect(getCurrentVersion(db)).toBe(4)

    // Sessions data preserved
    const sessions = db.query("SELECT session_id, source, label, started_at FROM sessions WHERE session_id = 'legacy-s1'").all() as any[]
    expect(sessions.length).toBe(1)
    expect(sessions[0].label).toBe("old-session")

    // New columns exist
    const sessionCols = getColumns(db, "sessions")
    expect(sessionCols).toContain("cost_usd")
    expect(sessionCols).toContain("cache_hit_rate")
    expect(sessionCols).toContain("tags")
    expect(sessionCols).not.toContain("agent_id")

    // raw_events has transport column
    const rawCols = getColumns(db, "raw_events")
    expect(rawCols).toContain("transport")

    // Token snapshots preserved
    const snaps = db.query("SELECT session_id, cumul_input FROM token_snapshots WHERE session_id = 'legacy-s1'").all() as any[]
    expect(snaps.length).toBe(1)
    expect(snaps[0].cumul_input).toBe(10)

    // model_pricing was created
    const pricingCols = getColumns(db, "model_pricing")
    expect(pricingCols).toContain("model_name")
    expect(pricingCols).toContain("input_per_m")
  })

  test("v4 drops stale agent_id column from sessions", () => {
    const db = makeEmptyDb()
    // Simulate a DB with stale agent_id column (from old version)
    db.run(`CREATE TABLE IF NOT EXISTS sessions (
      session_id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      source TEXT NOT NULL,
      started_at INTEGER NOT NULL
    )`)
    db.run("INSERT INTO sessions (session_id, agent_id, source, started_at) VALUES ('s1', 'abc123', 'hook', 1000)")
    db.run("PRAGMA user_version = 3")

    const beforeCols = getColumns(db, "sessions")
    expect(beforeCols).toContain("agent_id")

    migrate(db)

    expect(getCurrentVersion(db)).toBe(4)
    const afterCols = getColumns(db, "sessions")
    expect(afterCols).not.toContain("agent_id")

    const rows = db.query("SELECT session_id, source FROM sessions").all() as any[]
    expect(rows.length).toBe(1)
    expect(rows[0].session_id).toBe("s1")
  })
})
