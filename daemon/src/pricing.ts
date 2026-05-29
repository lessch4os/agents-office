import { Database } from "bun:sqlite";

export interface ModelPricing {
  inputPerM: number;
  outputPerM: number;
  cacheReadPerM: number;
}

export interface ModelPricingRow {
  model_name: string;
  input_per_m: number;
  output_per_m: number;
  cache_read_per_m: number;
  source: "default" | "user" | "auto";
}

const DEFAULT_TABLE: Record<string, Omit<ModelPricingRow, "model_name">> = {
  "claude-sonnet-4-20250514":       { input_per_m: 3.0,   output_per_m: 15.0,  cache_read_per_m: 0.30, source: "default" },
  "claude-sonnet-4":                { input_per_m: 3.0,   output_per_m: 15.0,  cache_read_per_m: 0.30, source: "default" },
  "claude-3-5-sonnet-20241022":     { input_per_m: 3.0,   output_per_m: 15.0,  cache_read_per_m: 0.30, source: "default" },
  "claude-3-5-haiku-20241022":      { input_per_m: 3.0,   output_per_m: 15.0,  cache_read_per_m: 0.30, source: "default" },
  "claude-opus-4-20250514":         { input_per_m: 15.0,  output_per_m: 75.0,  cache_read_per_m: 0.30, source: "default" },
  "gpt-4o":                         { input_per_m: 2.50,  output_per_m: 10.0,  cache_read_per_m: 0.0,  source: "default" },
  "gpt-4o-mini":                    { input_per_m: 0.15,  output_per_m: 0.60,  cache_read_per_m: 0.0,  source: "default" },
  "o4-mini":                        { input_per_m: 1.10,  output_per_m: 4.40,  cache_read_per_m: 0.0,  source: "default" },
  "o3":                             { input_per_m: 10.0,  output_per_m: 40.0,  cache_read_per_m: 0.0,  source: "default" },
  "gemini-2.5-pro":                 { input_per_m: 1.25,  output_per_m: 10.0,  cache_read_per_m: 0.0,  source: "default" },
  "gemini-2.0-flash":               { input_per_m: 0.10,  output_per_m: 0.40,  cache_read_per_m: 0.0,  source: "default" },
  "deepseek-chat":                  { input_per_m: 0.27,  output_per_m: 1.10,  cache_read_per_m: 0.07, source: "default" },
  "deepseek-v4-flash":              { input_per_m: 0.15,  output_per_m: 0.60,  cache_read_per_m: 0.07, source: "default" },
};

// ── Context window limits (merged from model-limits.ts) ────────────

export function registerModelLimit(model: string, limit: number): void {
  MODEL_LIMITS[model] = limit;
}

export const MODEL_LIMITS: Record<string, number> = {
  "claude-sonnet-4-20250514": 200_000,
  "claude-sonnet-4": 200_000,
  "claude-3-5-sonnet-20241022": 200_000,
  "claude-3-5-haiku-20241022": 200_000,
  "claude-opus-4-20250514": 200_000,
  "gpt-4o": 128_000,
  "gpt-4o-mini": 128_000,
  "o4-mini": 200_000,
  "o3": 200_000,
  "gemini-2.5-pro": 1_000_000,
  "gemini-2.0-flash": 1_000_000,
  "deepseek-chat": 64_000,
  "deepseek-v4-flash": 1_000_000,
};

export function lookupContextLimit(modelId: string | null | undefined, fallback = 200_000): number {
  if (!modelId) return fallback;
  return MODEL_LIMITS[modelId] ?? fallback;
}

const FALLBACK: Omit<ModelPricingRow, "model_name"> = {
  input_per_m: 3.0,
  output_per_m: 15.0,
  cache_read_per_m: 0.30,
  source: "auto",
};

type DbRow = Record<string, unknown>;

export class PricingManager {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
    this.migrate();
    this.seedIfEmpty();
  }

  private migrate(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS model_pricing (
        model_name       TEXT    PRIMARY KEY,
        input_per_m      REAL    NOT NULL,
        output_per_m     REAL    NOT NULL,
        cache_read_per_m REAL    NOT NULL DEFAULT 0,
        source           TEXT    NOT NULL DEFAULT 'auto'
      )
    `);
  }

  private seedIfEmpty(): void {
    const count = this.db.query<{ c: number }, []>("SELECT COUNT(*) as c FROM model_pricing").get();
    if (!count || count.c > 0) return;
    const insert = this.db.prepare(
      "INSERT INTO model_pricing (model_name, input_per_m, output_per_m, cache_read_per_m, source) VALUES (?, ?, ?, ?, ?)",
    );
    for (const [name, p] of Object.entries(DEFAULT_TABLE)) {
      insert.run(name, p.input_per_m, p.output_per_m, p.cache_read_per_m, p.source);
    }
  }

  get(modelName: string): ModelPricing {
    if (!modelName) {
      return { inputPerM: FALLBACK.input_per_m, outputPerM: FALLBACK.output_per_m, cacheReadPerM: FALLBACK.cache_read_per_m };
    }
    const row = this.db.query<DbRow, [string]>(
      "SELECT input_per_m, output_per_m, cache_read_per_m FROM model_pricing WHERE model_name = ?",
    ).get(modelName);
    if (row) {
      return {
        inputPerM: row["input_per_m"] as number,
        outputPerM: row["output_per_m"] as number,
        cacheReadPerM: row["cache_read_per_m"] as number,
      };
    }
    this.db.run(
      "INSERT INTO model_pricing (model_name, input_per_m, output_per_m, cache_read_per_m, source) VALUES (?, ?, ?, ?, 'auto')",
      modelName,
      FALLBACK.input_per_m,
      FALLBACK.output_per_m,
      FALLBACK.cache_read_per_m,
    );
    return { inputPerM: FALLBACK.input_per_m, outputPerM: FALLBACK.output_per_m, cacheReadPerM: FALLBACK.cache_read_per_m };
  }

  set(modelName: string, inputPerM: number, outputPerM: number, cacheReadPerM: number): void {
    this.db.run(
      `INSERT INTO model_pricing (model_name, input_per_m, output_per_m, cache_read_per_m, source)
       VALUES (?, ?, ?, ?, 'user')
       ON CONFLICT(model_name) DO UPDATE SET
         input_per_m = excluded.input_per_m,
         output_per_m = excluded.output_per_m,
         cache_read_per_m = excluded.cache_read_per_m,
         source = 'user'`,
      modelName,
      inputPerM,
      outputPerM,
      cacheReadPerM,
    );
  }

  list(): ModelPricingRow[] {
    return this.db.query<ModelPricingRow, []>(
      "SELECT model_name, input_per_m, output_per_m, cache_read_per_m, source FROM model_pricing ORDER BY source, model_name",
    ).all();
  }

  resetToDefaults(): void {
    this.db.run("DELETE FROM model_pricing");
    this.seedIfEmpty();
  }

  computeCostUsd(modelName: string | null, input: number, output: number, cacheRead: number): number {
    const p = this.get(modelName ?? "");
    return (input * p.inputPerM + output * p.outputPerM + cacheRead * p.cacheReadPerM) / 1_000_000;
  }
}
