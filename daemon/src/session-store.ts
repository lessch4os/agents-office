  import { Database } from "bun:sqlite";
import * as fs from "fs";
import * as path from "path";
import type { AgentEvent } from "./types";
import type { AgentSlot } from "./state";
import { PricingManager } from "./pricing";
import { AgentId } from "./agent-id";

// ── Wire types ─────────────────────────────────────────────────────

export interface WireSessionSummary {
  session_id: string;
  parent_session_id: string | null;
  source: string;
  label: string;
  cwd: string;
  agent_type: string | null;
  context_window_limit: number;
  started_at: number;
  ended_at: number | null;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  tool_call_count: number;
  active_ms: number;
  cost_usd: number;
  cache_hit_rate: number;
  tags: string[];
  model_name: string | null;
}

export interface WireTokenSnapshot {
  ts: number;
  cumul_input: number;
  cumul_output: number;
  cumul_cache: number;
  context_pct: number;
}

export interface WireSessionDetail extends WireSessionSummary {
  snapshots: WireTokenSnapshot[];
  children: WireSessionSummary[];
  total_cost_usd: number;
}

export interface WireSessionComparison {
  a: WireSessionDetail;
  b: WireSessionDetail;
  diff: {
    cost_usd: number;
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_hit_rate_delta: number;
    tool_call_count: number;
    active_ms: number;
    total_cost_usd: number;
  };
}

function computeCacheHitRate(input: number, cacheRead: number): number {
  const total = input + cacheRead;
  return total > 0 ? cacheRead / total : 0;
}

// ── SessionStore ───────────────────────────────────────────────────

export class SessionStore {
  private db: Database;
  private pricing: PricingManager;

  constructor(dbPath: string, pricing?: PricingManager) {
    if (dbPath !== ":memory:") {
      try { fs.mkdirSync(path.dirname(dbPath), { recursive: true }); } catch {}
    }
    this.db = new Database(dbPath);
    this.migrate();
    this.pricing = pricing ?? new PricingManager(this.db);
  }

  getPricingManager(): PricingManager {
    return this.pricing;
  }

  private rowToSummary(row: Record<string, unknown>): WireSessionSummary {
    const input = (row["input_tokens"] as number) ?? 0;
    const output = (row["output_tokens"] as number) ?? 0;
    const cache = (row["cache_read_tokens"] as number) ?? 0;
    const tags = JSON.parse((row["tags"] as string) || "[]") as string[];
    const modelName = (row["model_name"] as string | null) ?? null;
    return {
      session_id: row["session_id"] as string,
      parent_session_id: (row["parent_session_id"] as string | null) ?? null,
      source: row["source"] as string,
      label: row["label"] as string,
      cwd: row["cwd"] as string,
      agent_type: (row["agent_type"] as string | null) ?? null,
      context_window_limit: (row["context_window_limit"] as number) ?? 0,
      started_at: row["started_at"] as number,
      ended_at: (row["ended_at"] as number | null) ?? null,
      input_tokens: input,
      output_tokens: output,
      cache_read_tokens: cache,
      tool_call_count: (row["tool_call_count"] as number) ?? 0,
      active_ms: (row["active_ms"] as number) ?? 0,
      cost_usd: this.pricing.computeCostUsd(modelName, input, output, cache),
      cache_hit_rate: computeCacheHitRate(input, cache),
      tags,
      model_name: modelName,
    };
  }

  private migrate(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS sessions (
        session_id           TEXT    PRIMARY KEY,
        agent_id             TEXT    NOT NULL,
        parent_session_id    TEXT,
        source               TEXT    NOT NULL,
        label                TEXT    NOT NULL,
        cwd                  TEXT    NOT NULL,
        agent_type           TEXT,
        context_window_limit INTEGER DEFAULT 0,
        started_at           INTEGER NOT NULL,
        ended_at             INTEGER,
        input_tokens         INTEGER DEFAULT 0,
        output_tokens        INTEGER DEFAULT 0,
        cache_read_tokens    INTEGER DEFAULT 0,
        tool_call_count      INTEGER DEFAULT 0,
        active_ms            INTEGER DEFAULT 0,
        tags                 TEXT    DEFAULT '[]'
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS token_snapshots (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id   TEXT    NOT NULL,
        ts           INTEGER NOT NULL,
        cumul_input  INTEGER NOT NULL,
        cumul_output INTEGER NOT NULL,
        cumul_cache  INTEGER NOT NULL,
        context_pct  REAL    NOT NULL
      )
    `);

    this.db.run(`CREATE TABLE IF NOT EXISTS raw_events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id  TEXT    NOT NULL,
      ts          INTEGER NOT NULL,
      source      TEXT    NOT NULL,
      hook_event  TEXT    NOT NULL,
      payload     TEXT    NOT NULL
    )`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_raw_events_session ON raw_events(session_id, ts)`);

    // Add model_name column if it doesn't exist (migration for existing DBs)
    try { this.db.run(`ALTER TABLE sessions ADD COLUMN model_name TEXT`); } catch {}

    this.db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_started  ON sessions(started_at DESC)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_parent   ON sessions(parent_session_id)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_snapshots_session ON token_snapshots(session_id, ts)`);
  }

  storeRawEvent(sessionId: string, ts: number, source: string, hookEvent: string, payload: unknown): void {
    this.db.run(
      `INSERT INTO raw_events (session_id, ts, source, hook_event, payload) VALUES (?, ?, ?, ?, ?)`,
      sessionId,
      ts,
      source,
      hookEvent,
      JSON.stringify(payload),
    );
  }

  onEvent(event: AgentEvent, slot: AgentSlot | undefined, now: number, agents: Map<bigint, AgentSlot>): void {
    switch (event.type) {
      case "sessionStart": {
        const parentSessionId = event.parentId !== null
          ? (agents.get(event.parentId.value)?.sessionId ?? null)
          : null;
        const label = slot?.label ?? event.sessionId.slice(0, 8);
        this.db.run(
          `INSERT OR IGNORE INTO sessions
           (session_id, agent_id, parent_session_id, source, label, cwd, agent_type, context_window_limit, started_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          event.sessionId,
          event.agentId.toString(),
          parentSessionId,
          event.source,
          label,
          event.cwd,
          event.agentType,
          event.contextWindowLimit ?? 0,
          now,
        );
        break;
      }
      case "modelUpdate": {
        if (!slot) break;
        this.db.run(
          `UPDATE sessions SET model_name = ?, context_window_limit = ? WHERE session_id = ?`,
          event.modelId,
          event.contextWindowLimit ?? slot.contextWindowLimit,
          slot.sessionId,
        );
        break;
      }
      case "tokenUsage": {
        if (!slot) break;
        this.db.run(
          `INSERT INTO token_snapshots (session_id, ts, cumul_input, cumul_output, cumul_cache, context_pct)
           VALUES (?, ?, ?, ?, ?, ?)`,
          slot.sessionId,
          now,
          slot.tokenInputTotal,
          slot.tokenOutputTotal,
          slot.cacheReadTokens,
          slot.contextWindowLimit > 0
            ? slot.contextInputTokens / slot.contextWindowLimit
            : 0,
        );
        this.db.run(
          `UPDATE sessions SET input_tokens = ?, output_tokens = ?, cache_read_tokens = ? WHERE session_id = ?`,
          slot.tokenInputTotal,
          slot.tokenOutputTotal,
          slot.cacheReadTokens,
          slot.sessionId,
        );
        break;
      }
      case "rename": {
        if (!slot) break;
        this.db.run(
          `UPDATE sessions SET label = ? WHERE session_id = ?`,
          event.label,
          slot.sessionId,
        );
        break;
      }
      case "sessionEnd": {
        if (!slot) break;
        this.db.run(
          `UPDATE sessions
           SET ended_at = ?, active_ms = ?, tool_call_count = ?,
               input_tokens = ?, output_tokens = ?, cache_read_tokens = ?
           WHERE session_id = ?`,
          now,
          slot.activeMs,
          slot.toolCallCount,
          slot.tokenInputTotal,
          slot.tokenOutputTotal,
          slot.cacheReadTokens,
          slot.sessionId,
        );
        break;
      }
    }
  }

  restoreActiveSessions(now: number, maxAgeMs = 3600000): AgentEvent[] {
    const cutoff = now - maxAgeMs;
    const rows = this.db.query<Record<string, unknown>, [number]>(
      `SELECT * FROM sessions WHERE ended_at IS NULL AND started_at > ? ORDER BY started_at ASC`
    ).all(cutoff);

    const events: AgentEvent[] = [];
    for (const row of rows) {
      const sessionId = row["session_id"] as string;
      const source = row["source"] as string;
      const agentType = (row["agent_type"] as string | null) ?? null;
      const agentIdHex = row["agent_id"] as string;
      const agentId = AgentId.fromHex(agentIdHex);
      const cwd = row["cwd"] as string ?? "";
      const contextWindowLimit = (row["context_window_limit"] as number) ?? 0;
      const label = row["label"] as string ?? "";
      const modelName = (row["model_name"] as string | null) ?? null;

      events.push({
        type: "sessionStart",
        agentId,
        source,
        sessionId,
        cwd,
        parentId: null,
        parentSessionId: null,
        agentType,
        contextWindowLimit,
      });

      if (label) {
        events.push({
          type: "rename",
          agentId,
          label,
        });
      }

      if (modelName) {
        events.push({
          type: "modelUpdate",
          agentId,
          modelId: modelName,
          contextWindowLimit,
        });
      }
    }
    return events;
  }

  listSessions(opts: { limit: number; offset: number; tag?: string; source?: string }): WireSessionSummary[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (opts.tag) {
      conditions.push(`EXISTS (SELECT 1 FROM json_each(sessions.tags) WHERE value = ?)`);
      params.push(opts.tag);
    }
    if (opts.source) {
      conditions.push(`source = ?`);
      params.push(opts.source);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const sql = `SELECT * FROM sessions ${where} ORDER BY started_at DESC LIMIT ? OFFSET ?`;
    params.push(opts.limit, opts.offset);

    return (this.db.query<Record<string, unknown>, unknown[]>(sql).all(...params)).map((r) => this.rowToSummary(r));
  }

  getSession(id: string): WireSessionDetail | null {
    const row = this.db.query<DbRow, [string]>(
      "SELECT * FROM sessions WHERE session_id = ?"
    ).get(id);
    if (!row) return null;

    const summary = this.rowToSummary(row);

    const snapshots = this.db.query<Record<string, unknown>, [string]>(
      `SELECT ts, cumul_input, cumul_output, cumul_cache, context_pct
       FROM token_snapshots WHERE session_id = ? ORDER BY ts ASC`
    ).all(id).map((r): WireTokenSnapshot => ({
      ts: r["ts"] as number,
      cumul_input: r["cumul_input"] as number,
      cumul_output: r["cumul_output"] as number,
      cumul_cache: r["cumul_cache"] as number,
      context_pct: r["context_pct"] as number,
    }));

    const children = this.db.query<Record<string, unknown>, [string]>(
      "SELECT * FROM sessions WHERE parent_session_id = ? ORDER BY started_at ASC"
    ).all(id).map((r) => this.rowToSummary(r));

    const childCost = children.reduce((sum, c) => sum + c.cost_usd, 0);

    return { ...summary, snapshots, children, total_cost_usd: summary.cost_usd + childCost };
  }

  tagSession(id: string, tag: string): void {
    const row = this.db.query<{ tags: string }, [string]>(
      "SELECT tags FROM sessions WHERE session_id = ?"
    ).get(id);
    if (!row) return;
    const tags = JSON.parse(row.tags || "[]") as string[];
    if (!tags.includes(tag)) tags.push(tag);
    this.db.run("UPDATE sessions SET tags = ? WHERE session_id = ?", JSON.stringify(tags), id);
  }

  untagSession(id: string, tag: string): void {
    const row = this.db.query<{ tags: string }, [string]>(
      "SELECT tags FROM sessions WHERE session_id = ?"
    ).get(id);
    if (!row) return;
    const tags = JSON.parse(row.tags || "[]") as string[];
    this.db.run(
      "UPDATE sessions SET tags = ? WHERE session_id = ?",
      JSON.stringify(tags.filter((t) => t !== tag)),
      id,
    );
  }

  compareSessions(aId: string, bId: string): WireSessionComparison | null {
    const a = this.getSession(aId);
    const b = this.getSession(bId);
    if (!a || !b) return null;
    return {
      a,
      b,
      diff: {
        cost_usd: a.cost_usd - b.cost_usd,
        input_tokens: a.input_tokens - b.input_tokens,
        output_tokens: a.output_tokens - b.output_tokens,
        cache_read_tokens: a.cache_read_tokens - b.cache_read_tokens,
        cache_hit_rate_delta: a.cache_hit_rate - b.cache_hit_rate,
        tool_call_count: a.tool_call_count - b.tool_call_count,
        active_ms: a.active_ms - b.active_ms,
        total_cost_usd: a.total_cost_usd - b.total_cost_usd,
      },
    };
  }
}
