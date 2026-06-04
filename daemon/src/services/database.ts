import type { Db } from "../db"
import { migrate as runMigration } from "../db/migrate"

export function migrateDatabase(db: Db): void {
  const sqlite = (db as any).$client
  if (sqlite) {
    runMigration(sqlite)
  }
}
