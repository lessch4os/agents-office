import { describe, test, expect, beforeAll } from "bun:test"
import { SqlClient } from "@effect/sql"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { Effect, Layer } from "effect"
import { migrate } from "./database"
import { createSession, getSession, listSessions, updateTokens, endSession, addTag, storeRawEvent, restoreActiveSessions, SessionRow } from "./session-store"

function makeTestLayer(filename: string): Layer.Layer<SqlClient.SqlClient> {
  return SqliteClient.layer({ filename })
}

describe("SessionStore", () => {
  const testDb = ":memory:"

  function runTest<E, A>(
    effect: Effect.Effect<A, E, SqlClient.SqlClient>,
  ): Promise<A> {
    return Effect.runPromise(
      effect.pipe(Effect.provide(makeTestLayer(testDb))),
    )
  }

  function runTestWithMigrate<E, A>(
    effect: Effect.Effect<A, E, SqlClient.SqlClient>,
  ): Promise<A> {
    return Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* migrate(sql)
        return yield* effect
      }).pipe(Effect.provide(makeTestLayer(testDb))),
    )
  }

  const sampleSession: SessionRow = {
    session_id: "test-session-1",
    parent_session_id: null,
    source: "hook",
    label: "test-agent",
    cwd: "/home/user/project",
    agent_type: "claude-code",
    context_window_limit: 200000,
    started_at: 1000,
    ended_at: null,
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    tool_call_count: 0,
    active_ms: 0,
    cost_usd: 0.0,
    cache_hit_rate: 0.0,
    tags: "[]",
    model_name: null,
  }

  test("create and get session", async () => {
    const result = await runTestWithMigrate(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* createSession(sql, sampleSession)
        return yield* getSession(sql, "test-session-1")
      }),
    )
    expect(result).toBeDefined()
    expect(result!.session_id).toBe("test-session-1")
    expect(result!.source).toBe("hook")
    expect(result!.label).toBe("test-agent")
  })

  test("get non-existent session returns undefined", async () => {
    const result = await runTestWithMigrate(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        return yield* getSession(sql, "non-existent")
      }),
    )
    expect(result).toBeUndefined()
  })

  test("list sessions returns most recent first", async () => {
    const result = await runTestWithMigrate(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* createSession(sql, { ...sampleSession, session_id: "s1", started_at: 100 })
        yield* createSession(sql, { ...sampleSession, session_id: "s2", started_at: 200 })
        yield* createSession(sql, { ...sampleSession, session_id: "s3", started_at: 300 })
        return yield* listSessions(sql)
      }),
    )
    expect(result).toHaveLength(3)
    expect(result[0].session_id).toBe("s3")
    expect(result[2].session_id).toBe("s1")
  })

  test("update tokens", async () => {
    const result = await runTestWithMigrate(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* createSession(sql, sampleSession)
        yield* updateTokens(sql, "test-session-1", 100, 50, 10)
        const s = yield* getSession(sql, "test-session-1")
        return { input: s!.input_tokens, output: s!.output_tokens, cache: s!.cache_read_tokens }
      }),
    )
    expect(result.input).toBe(100)
    expect(result.output).toBe(50)
    expect(result.cache).toBe(10)
  })

  test("update tokens cumulative overwrites", async () => {
    const result = await runTestWithMigrate(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* createSession(sql, sampleSession)
        yield* updateTokens(sql, "test-session-1", 100, 50, 10)
        yield* updateTokens(sql, "test-session-1", 200, 75, 20, true)
        const s = yield* getSession(sql, "test-session-1")
        return { input: s!.input_tokens, output: s!.output_tokens, cache: s!.cache_read_tokens }
      }),
    )
    expect(result.input).toBe(200)
  })

  test("update tokens incremental adds", async () => {
    const result = await runTestWithMigrate(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* createSession(sql, sampleSession)
        yield* updateTokens(sql, "test-session-1", 100, 50, 10)
        yield* updateTokens(sql, "test-session-1", 50, 25, 5)
        const s = yield* getSession(sql, "test-session-1")
        return { input: s!.input_tokens, output: s!.output_tokens, cache: s!.cache_read_tokens }
      }),
    )
    expect(result.input).toBe(150)
    expect(result.output).toBe(75)
    expect(result.cache).toBe(15)
  })

  test("end session sets ended_at", async () => {
    const result = await runTestWithMigrate(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* createSession(sql, sampleSession)
        yield* endSession(sql, "test-session-1", 5000)
        const s = yield* getSession(sql, "test-session-1")
        return s!.ended_at
      }),
    )
    expect(result).toBe(5000)
  })

  test("addTag appends to tags JSON array", async () => {
    const result = await runTestWithMigrate(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* createSession(sql, sampleSession)
        yield* addTag(sql, "test-session-1", "dev")
        yield* addTag(sql, "test-session-1", "experiment")
        const s = yield* getSession(sql, "test-session-1")
        return JSON.parse(s!.tags)
      }),
    )
    expect(result).toEqual(["dev", "experiment"])
  })

  test("storeRawEvent inserts event", async () => {
    await runTestWithMigrate(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* storeRawEvent(sql, 1000, "s1", "hook", '{"type":"sessionStart"}')
      }),
    )
  })

  test("storeRawEvent with null session_id", async () => {
    await runTestWithMigrate(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* storeRawEvent(sql, 1000, undefined, undefined, '{}')
      }),
    )
  })

  test("restoreActiveSessions returns only active sessions", async () => {
    const result = await runTestWithMigrate(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* createSession(sql, { ...sampleSession, session_id: "active-1" })
        yield* createSession(sql, { ...sampleSession, session_id: "active-2" })
        yield* createSession(sql, { ...sampleSession, session_id: "ended-1" })
        yield* endSession(sql, "ended-1", 9999)
        return yield* restoreActiveSessions(sql)
      }),
    )
    expect(result).toHaveLength(2)
    expect(result.map((s) => s.session_id).sort()).toEqual(["active-1", "active-2"])
  })
})
