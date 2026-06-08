import { Database } from "bun:sqlite"
import { migrate, getCurrentVersion } from "../db/migrate"
import { getLogger } from "../services/logger"

export function runDbMigrate(args: string[]): void {
  let dbPath = ""
  const log = getLogger().child("db-migrate")

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--db" || args[i] === "-d") {
      dbPath = args[++i] ?? ""
    }
  }

  if (!dbPath) {
    const home = process.env.HOME ?? "/tmp"
    dbPath = `${home}/.agents-office/sessions.db`
  }

  try {
    const db = new Database(dbPath)
    const before = getCurrentVersion(db)
    migrate(db)
    const after = getCurrentVersion(db)
    log.warn("database migrated", { from: before, to: after, path: dbPath })
    db.close()
  } catch (e) {
    log.error("database migration failed", { error: String(e), path: dbPath })
    process.exit(1)
  }
}
