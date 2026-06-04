import { Database } from "bun:sqlite"
import { drizzle } from "drizzle-orm/bun-sqlite"
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite"
import * as schema from "./schema"
import { migrate } from "./migrate"

export type Db = BunSQLiteDatabase<typeof schema>

export function createDb(dbPath: string): { sqlite: Database; db: Db } {
  const sqlite = new Database(dbPath)
  migrate(sqlite)
  const db = drizzle(sqlite, { schema }) as Db
  return { sqlite, db }
}
