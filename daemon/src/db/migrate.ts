import { Database } from "bun:sqlite"
import { migrations } from "./migrations"

export function getCurrentVersion(db: Database): number {
  return (db.query("PRAGMA user_version").get() as { user_version: number }).user_version
}

export function setVersion(db: Database, version: number): void {
  db.run(`PRAGMA user_version = ${version}`)
}

function ensureColumns(db: Database): void {
  const tables: Record<string, Record<string, string>> = {
    sessions: {
      cost_usd: "REAL NOT NULL DEFAULT 0.0",
      cache_hit_rate: "REAL NOT NULL DEFAULT 0.0",
      tags: "TEXT NOT NULL DEFAULT '[]'",
      origin: "TEXT NOT NULL DEFAULT 'local'",
      machine_name: "TEXT",
    },
    token_snapshots: {
      cumul_cache: "INTEGER NOT NULL DEFAULT 0",
    },
  }
  for (const [table, cols] of Object.entries(tables)) {
    const existing = db.query(`PRAGMA table_info('${table}')`).all() as { name: string }[]
    if (existing.length === 0) continue
    for (const [col, def] of Object.entries(cols)) {
      if (!existing.some(c => c.name === col)) {
        db.run(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`)
      }
    }
  }
}

export function migrate(db: Database): void {
  db.run("PRAGMA journal_mode=WAL")
  db.run("PRAGMA foreign_keys=ON")

  const currentVersion = getCurrentVersion(db)

  if (currentVersion < 1) {
    const rawCols = db.query("PRAGMA table_info('raw_events')").all() as { name: string }[]
    if (rawCols.some(c => c.name === "id") && !rawCols.some(c => c.name === "transport")) {
      db.run("DROP TABLE IF EXISTS raw_events")
    }

    for (const stmt of migrations[0].up) {
      db.run(stmt)
    }
    setVersion(db, 1)
  }

  if (currentVersion < 2) {
    for (const stmt of migrations[1].up) {
      db.run(stmt)
    }
    setVersion(db, 2)
  }

  if (currentVersion < 3) {
    for (const stmt of migrations[2].up) {
      db.run(stmt)
    }
    setVersion(db, 3)
  }

  if (currentVersion < 4) {
    const sessionCols = db.query("PRAGMA table_info('sessions')").all() as { name: string }[]
    if (sessionCols.some(c => c.name === "agent_id")) {
      db.run("ALTER TABLE sessions DROP COLUMN agent_id")
    }
    setVersion(db, 4)
  }

  if (currentVersion < 5) {
    const sessionCols = db.query("PRAGMA table_info('sessions')").all() as { name: string }[]
    const hasSessions = sessionCols.length > 0
    if (hasSessions) {
      for (const stmt of migrations[4].up) {
        db.run(stmt)
      }
    }
    setVersion(db, 5)
  }

  // Ensure all expected columns exist (handles DBs upgraded from old code)
  ensureColumns(db)
}
