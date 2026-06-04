import { Effect } from "effect"
import { eq, sql, desc, isNull, type InferSelectModel } from "drizzle-orm"
import type { Db } from "../db"
import { sessions, rawEvents } from "../db/schema"

export type SessionRow = InferSelectModel<typeof sessions>

export function createSession(
  db: Db,
  session: SessionRow,
): Effect.Effect<void> {
  return Effect.sync(() => {
    db.insert(sessions).values(session).onConflictDoUpdate({
      target: sessions.sessionId,
      set: { label: sql`excluded.label`, source: sql`excluded.source` },
    }).run()
  })
}

export function getSession(
  db: Db,
  sessionId: string,
): Effect.Effect<SessionRow | undefined> {
  return Effect.sync(() => {
    return db.select().from(sessions).where(eq(sessions.sessionId, sessionId)).get()
  })
}

export function listSessions(
  db: Db,
  limit = 50,
  offset = 0,
): Effect.Effect<SessionRow[]> {
  return Effect.sync(() => {
    return db.select().from(sessions).orderBy(desc(sessions.startedAt)).limit(limit).offset(offset).all()
  })
}

export function updateTokens(
  db: Db,
  sessionId: string,
  input: number,
  output: number,
  cacheRead: number,
  cumulative?: boolean,
): Effect.Effect<void> {
  return Effect.sync(() => {
    if (cumulative) {
      db.update(sessions).set({
        inputTokens: input,
        outputTokens: output,
        cacheReadTokens: cacheRead,
      }).where(eq(sessions.sessionId, sessionId)).run()
    } else {
      db.update(sessions).set({
        inputTokens: sql`input_tokens + ${input}`,
        outputTokens: sql`output_tokens + ${output}`,
        cacheReadTokens: sql`cache_read_tokens + ${cacheRead}`,
      }).where(eq(sessions.sessionId, sessionId)).run()
    }
  })
}

export function endSession(
  db: Db,
  sessionId: string,
  endedAt: number,
): Effect.Effect<void> {
  return Effect.sync(() => {
    db.update(sessions).set({ endedAt }).where(eq(sessions.sessionId, sessionId)).run()
  })
}

export function addTag(
  db: Db,
  sessionId: string,
  tag: string,
): Effect.Effect<void> {
  return Effect.sync(() => {
    db.update(sessions).set({
      tags: sql`json_insert(tags, '$[#]', ${tag})`,
    }).where(eq(sessions.sessionId, sessionId)).run()
  })
}

export function storeRawEvent(
  db: Db,
  ts: number,
  sessionId: string | undefined,
  transport: string | undefined,
  payload: string,
): Effect.Effect<void> {
  return Effect.sync(() => {
    db.insert(rawEvents).values({
      ts,
      sessionId: sessionId ?? null,
      transport: transport ?? null,
      payload,
    }).run()
  })
}

export function restoreActiveSessions(
  db: Db,
): Effect.Effect<SessionRow[]> {
  return Effect.sync(() => {
    return db.select().from(sessions).where(isNull(sessions.endedAt)).all()
  })
}
