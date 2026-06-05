import { Database } from "bun:sqlite"
import { migrations } from "./migrations"

export function getCurrentVersion(db: Database): number {
  return (db.query("PRAGMA user_version").get() as { user_version: number }).user_version
}

export function setVersion(db: Database, version: number): void {
  db.run(`PRAGMA user_version = ${version}`)
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

    const sessionCols = db.query("PRAGMA table_info('sessions')").all() as { name: string }[]
    if (sessionCols.length > 0) {
      const missingSessionCols: Record<string, string> = {
        cost_usd: "REAL NOT NULL DEFAULT 0.0",
        cache_hit_rate: "REAL NOT NULL DEFAULT 0.0",
        tags: "TEXT NOT NULL DEFAULT '[]'",
      }
      for (const [col, def] of Object.entries(missingSessionCols)) {
        if (!sessionCols.some(c => c.name === col)) {
          db.run(`ALTER TABLE sessions ADD COLUMN ${col} ${def}`)
        }
      }
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
}
