export interface ModelPricing {
  inputPerM: number;
  outputPerM: number;
  cacheReadPerM: number;
}

interface ModelPricingRow {
  model_name: string;
  input_per_m: number;
  output_per_m: number;
  cache_read_per_m: number;
  source: string;
}

const HARDCODED_DEFAULTS: Record<string, ModelPricing> = {
  "claude-sonnet-4-20250514":       { inputPerM: 3.0,   outputPerM: 15.0,  cacheReadPerM: 0.30 },
  "claude-sonnet-4":                { inputPerM: 3.0,   outputPerM: 15.0,  cacheReadPerM: 0.30 },
  "claude-3-5-sonnet-20241022":     { inputPerM: 3.0,   outputPerM: 15.0,  cacheReadPerM: 0.30 },
  "claude-3-5-haiku-20241022":      { inputPerM: 3.0,   outputPerM: 15.0,  cacheReadPerM: 0.30 },
  "claude-opus-4-20250514":         { inputPerM: 15.0,  outputPerM: 75.0,  cacheReadPerM: 0.30 },
  "gpt-4o":                         { inputPerM: 2.50,  outputPerM: 10.0,  cacheReadPerM: 0.0  },
  "gpt-4o-mini":                    { inputPerM: 0.15,  outputPerM: 0.60,  cacheReadPerM: 0.0  },
  "o4-mini":                        { inputPerM: 1.10,  outputPerM: 4.40,  cacheReadPerM: 0.0  },
  "o3":                             { inputPerM: 10.0,  outputPerM: 40.0,  cacheReadPerM: 0.0  },
  "gemini-2.5-pro":                 { inputPerM: 1.25,  outputPerM: 10.0,  cacheReadPerM: 0.0  },
  "gemini-2.0-flash":               { inputPerM: 0.10,  outputPerM: 0.40,  cacheReadPerM: 0.0  },
  "deepseek-chat":                  { inputPerM: 0.27,  outputPerM: 1.10,  cacheReadPerM: 0.07 },
  "deepseek-v4-flash":              { inputPerM: 0.15,  outputPerM: 0.60,  cacheReadPerM: 0.07 },
};

const FALLBACK: ModelPricing = { inputPerM: 3.0, outputPerM: 15.0, cacheReadPerM: 0.30 };

let serverPricing: Record<string, ModelPricing> | null = null;

export async function fetchPricing(): Promise<void> {
  try {
    const res = await fetch("/api/pricing");
    if (!res.ok) return;
    const rows = (await res.json()) as ModelPricingRow[];
    serverPricing = {};
    for (const row of rows) {
      serverPricing[row.model_name] = {
        inputPerM: row.input_per_m,
        outputPerM: row.output_per_m,
        cacheReadPerM: row.cache_read_per_m,
      };
    }
  } catch {
    serverPricing = null;
  }
}

export function getPricing(modelName: string | null): ModelPricing {
  if (!modelName) return FALLBACK;
  const fromServer = serverPricing?.[modelName];
  if (fromServer) return fromServer;
  const fromDefaults = HARDCODED_DEFAULTS[modelName];
  if (fromDefaults) return fromDefaults;
  return FALLBACK;
}

export function computeCostUsd(modelName: string | null, input: number, output: number, cacheRead: number): number {
  const p = getPricing(modelName);
  return (input * p.inputPerM + output * p.outputPerM + cacheRead * p.cacheReadPerM) / 1_000_000;
}

export { HARDCODED_DEFAULTS };
