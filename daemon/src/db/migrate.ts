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
    const cols = db.query("PRAGMA table_info('raw_events')").all() as { name: string }[]
    if (cols.some(c => c.name === "id") && !cols.some(c => c.name === "transport")) {
      db.run("DROP TABLE IF EXISTS raw_events")
    }
    for (const stmt of migrations[0].up) {
      db.run(stmt)
    }
    setVersion(db, 1)
  }
}
