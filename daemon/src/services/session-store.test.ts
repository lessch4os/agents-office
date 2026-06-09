import { describe, test, expect } from "bun:test"
import { Database } from "bun:sqlite"
import { drizzle } from "drizzle-orm/bun-sqlite"
import { Effect } from "effect"
import { type Db } from "../db"
import * as schema from "../db/schema"
import { createSession, getSession, listSessions, updateTokens, endSession, addTag, storeRawEvent, restoreActiveSessions } from "./session-store"

function makeTestDb(): Db {
  const sqlite = new Database(":memory:")
  sqlite.run("PRAGMA journal_mode=WAL")
  sqlite.run(`CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT PRIMARY KEY, parent_session_id TEXT,
    source TEXT NOT NULL, label TEXT NOT NULL DEFAULT '',
    cwd TEXT NOT NULL DEFAULT '', origin TEXT NOT NULL DEFAULT 'local',
    machine_name TEXT, agent_type TEXT,
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
  sqlite.run(`CREATE TABLE IF NOT EXISTS raw_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL, session_id TEXT,
    transport TEXT, payload TEXT NOT NULL
  )`)
  return drizzle(sqlite, { schema }) as Db
}

function run<E, A>(effect: Effect.Effect<A, E>): Promise<A> {
  return Effect.runPromise(effect)
}

describe("SessionStore", () => {
  const sampleSession = {
    sessionId: "test-session-1",
    parentSessionId: null,
    source: "hook",
    label: "test-agent",
    cwd: "/home/user/project",
    agentType: "claude-code",
    contextWindowLimit: 200000,
    startedAt: 1000,
    endedAt: null,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    toolCallCount: 0,
    activeMs: 0,
    costUsd: 0.0,
    cacheHitRate: 0.0,
    tags: "[]",
    modelName: null,
  }

  test("create and get session", async () => {
    const db = makeTestDb()
    const result = await run(
      Effect.gen(function* () {
        yield* createSession(db, sampleSession)
        return yield* getSession(db, "test-session-1")
      }),
    )
    expect(result).toBeDefined()
    expect(result!.sessionId).toBe("test-session-1")
    expect(result!.source).toBe("hook")
    expect(result!.label).toBe("test-agent")
  })

  test("get non-existent session returns undefined", async () => {
    const db = makeTestDb()
    const result = await run(getSession(db, "non-existent"))
    expect(result).toBeUndefined()
  })

  test("list sessions returns most recent first", async () => {
    const db = makeTestDb()
    await run(createSession(db, { ...sampleSession, sessionId: "s1", startedAt: 100 }))
    await run(createSession(db, { ...sampleSession, sessionId: "s2", startedAt: 200 }))
    await run(createSession(db, { ...sampleSession, sessionId: "s3", startedAt: 300 }))
    const result = await run(listSessions(db))
    expect(result).toHaveLength(3)
    expect(result[0].sessionId).toBe("s3")
    expect(result[2].sessionId).toBe("s1")
  })

  test("update tokens", async () => {
    const db = makeTestDb()
    await run(createSession(db, sampleSession))
    await run(updateTokens(db, "test-session-1", 100, 50, 10))
    const s = await run(getSession(db, "test-session-1"))
    expect(s!.inputTokens).toBe(100)
    expect(s!.outputTokens).toBe(50)
    expect(s!.cacheReadTokens).toBe(10)
  })

  test("update tokens cumulative overwrites", async () => {
    const db = makeTestDb()
    await run(createSession(db, sampleSession))
    await run(updateTokens(db, "test-session-1", 100, 50, 10))
    await run(updateTokens(db, "test-session-1", 200, 75, 20, true))
    const s = await run(getSession(db, "test-session-1"))
    expect(s!.inputTokens).toBe(200)
  })

  test("update tokens incremental adds", async () => {
    const db = makeTestDb()
    await run(createSession(db, sampleSession))
    await run(updateTokens(db, "test-session-1", 100, 50, 10))
    await run(updateTokens(db, "test-session-1", 50, 25, 5))
    const s = await run(getSession(db, "test-session-1"))
    expect(s!.inputTokens).toBe(150)
    expect(s!.outputTokens).toBe(75)
    expect(s!.cacheReadTokens).toBe(15)
  })

  test("end session sets endedAt", async () => {
    const db = makeTestDb()
    await run(createSession(db, sampleSession))
    await run(endSession(db, "test-session-1", 5000))
    const s = await run(getSession(db, "test-session-1"))
    expect(s!.endedAt).toBe(5000)
  })

  test("addTag appends to tags JSON array", async () => {
    const db = makeTestDb()
    await run(createSession(db, sampleSession))
    await run(addTag(db, "test-session-1", "dev"))
    await run(addTag(db, "test-session-1", "experiment"))
    const s = await run(getSession(db, "test-session-1"))
    expect(JSON.parse(s!.tags)).toEqual(["dev", "experiment"])
  })

  test("storeRawEvent inserts event", async () => {
    const db = makeTestDb()
    await run(storeRawEvent(db, 1000, "s1", "hook", '{"type":"sessionStart"}'))
  })

  test("storeRawEvent with null session_id", async () => {
    const db = makeTestDb()
    await run(storeRawEvent(db, 1000, undefined, undefined, '{}'))
  })

  test("restoreActiveSessions returns only active sessions", async () => {
    const db = makeTestDb()
    await run(createSession(db, { ...sampleSession, sessionId: "active-1" }))
    await run(createSession(db, { ...sampleSession, sessionId: "active-2" }))
    await run(createSession(db, { ...sampleSession, sessionId: "ended-1" }))
    await run(endSession(db, "ended-1", 9999))
    const result = await run(restoreActiveSessions(db))
    expect(result).toHaveLength(2)
    expect(result.map((s) => s.sessionId).sort()).toEqual(["active-1", "active-2"])
  })
})
