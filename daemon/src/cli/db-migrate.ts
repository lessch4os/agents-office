import { Database } from "bun:sqlite"
import { migrate, getCurrentVersion } from "../db/migrate"

export function runDbMigrate(args: string[]): void {
  let dbPath = ""

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
    console.log(`agents-office: database migrated from version ${before} to ${after}`)
    db.close()
  } catch (e) {
    console.error("agents-office: database migration failed:", e)
    process.exit(1)
  }
}
