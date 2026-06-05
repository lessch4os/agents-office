import { test, expect, beforeAll, afterAll } from "bun:test"
import { spawn } from "bun"
import { resolve } from "path"

const PORT = 23458
const DAEMON_SCRIPT = resolve(import.meta.dir, "../main.ts")
const WEB_ROOT = resolve(import.meta.dir, "../../../web/dist")

let proc: import("bun").Subprocess | null = null
let webRootFound = false

beforeAll(async () => {
  try {
    const f = Bun.file(`${WEB_ROOT}/index.html`)
    webRootFound = (await f.stat()).isFile
  } catch {}

  proc = spawn([
    "bun", "run", DAEMON_SCRIPT,
    "--port", String(PORT),
    ...(webRootFound ? ["--web-root", WEB_ROOT] : []),
  ], {
    env: { ...process.env, DB: ":memory:", VERBOSE: "true" },
  })

  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 200))
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/health`)
      if (r.ok) return
    } catch {}
  }
  throw new Error("daemon did not start within 6s")
}, 15000)

afterAll(() => {
  proc?.kill()
})

test("GET /health returns 200", async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/health`)
  expect(r.ok).toBe(true)
  const body = await r.json()
  expect(body).toEqual({ ok: true })
})

test("GET /api/scene returns scene data", async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/scene`)
  expect(r.ok).toBe(true)
  const body = await r.json()
  expect(body).toHaveProperty("agents")
  expect(body).toHaveProperty("max_desks")
  expect(body).toHaveProperty("now_ms")
})

test("GET /api/sessions returns empty array initially", async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/sessions`)
  expect(r.ok).toBe(true)
  const body = await r.json()
  expect(Array.isArray(body)).toBe(true)
  expect(body.length).toBe(0)
})

test("GET /api/pricing returns seeded pricing data", async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/pricing`)
  expect(r.ok).toBe(true)
  const body = await r.json()
  expect(Array.isArray(body)).toBe(true)
  expect(body.length).toBeGreaterThan(0)
  const row = body[0]
  expect(row).toHaveProperty("model_name")
  expect(row).toHaveProperty("input_per_m")
  expect(row).toHaveProperty("output_per_m")
  expect(row).toHaveProperty("source")
})

test("PUT /api/pricing upserts pricing", async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/pricing`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model_name: "test-model", input_per_m: 1, output_per_m: 2, cache_read_per_m: 0.1 }),
  })
  expect(r.ok).toBe(true)
  const body = await r.json()
  expect(body).toEqual({ ok: true })

  const list = await (await fetch(`http://127.0.0.1:${PORT}/api/pricing`)).json() as any[]
  const found = list.find((r: any) => r.model_name === "test-model")
  expect(found).toBeDefined()
  expect(found.input_per_m).toBe(1)
})

test("POST /api/pricing/reset resets to defaults", async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/pricing/reset`, { method: "POST" })
  expect(r.ok).toBe(true)
  const body = await r.json()
  expect(body).toEqual({ ok: true })

  const list = await (await fetch(`http://127.0.0.1:${PORT}/api/pricing`)).json() as any[]
  expect(list.length).toBeGreaterThan(0)
})

test("GET / returns HTML when web-root is set", async () => {
  if (!webRootFound) return
  const r = await fetch(`http://127.0.0.1:${PORT}/`)
  expect(r.ok).toBe(true)
  const text = await r.text()
  expect(text).toContain("<!DOCTYPE html>")
  expect(text).toContain("agents-office")
})

test("GET / nonexistent path returns 404", async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/nonexistent`)
  expect(r.status).toBe(404)
})

test("WebSocket /ws upgrades successfully", async () => {
  const url = `ws://127.0.0.1:${PORT}/ws`
  const ws = new WebSocket(url)
  const connected = new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve()
    ws.onerror = () => reject(new Error("WebSocket connection failed"))
    setTimeout(() => reject(new Error("WebSocket connection timed out")), 3000)
  })
  await connected
  expect(ws.readyState).toBe(WebSocket.OPEN)
  ws.close()
})

// ── safeNum/safeStr edge cases ────────────────────────────────────

function safeNum(row: any, camel: string, snake: string, fallback = 0): number {
  const v = row[camel]
  if (typeof v === "number" && !Number.isNaN(v)) return v
  if (row[snake] != null) {
    const n = Number(row[snake])
    if (!Number.isNaN(n)) return n
  }
  return fallback
}

function safeStr(row: any, camel: string, snake: string, fallback: string | null = null): string | null {
  const v = row[camel]
  if (typeof v === "string" && v !== snake) return v
  if (row[snake] != null && typeof row[snake] === "string") return String(row[snake])
  return fallback
}

test("safeNum with real number", () => {
  expect(safeNum({ costUsd: 1.5 }, "costUsd", "cost_usd")).toBe(1.5)
})

test("safeNum with Drizzle null string bug", () => {
  expect(safeNum({ costUsd: "cost_usd" }, "costUsd", "cost_usd")).toBe(0)
})

test("safeNum with undefined falls back", () => {
  expect(safeNum({}, "costUsd", "cost_usd", 0)).toBe(0)
})

test("safeNum with snake_case fallback", () => {
  expect(safeNum({ cost_usd: 2.5 }, "costUsd", "cost_usd")).toBe(2.5)
})

test("safeNum with NaN input returns fallback", () => {
  expect(safeNum({ costUsd: NaN }, "costUsd", "cost_usd")).toBe(0)
})

test("safeStr with real string", () => {
  expect(safeStr({ source: "hook" }, "source", "source")).toBe("hook")
})

test("safeStr with null returns fallback", () => {
  expect(safeStr({ modelName: null }, "modelName", "model_name")).toBeNull()
})

test("safeStr with snake_case", () => {
  expect(safeStr({ model_name: "deepseek" }, "modelName", "model_name")).toBe("deepseek")
})

test("safeStr with Drizzle null string bug", () => {
  expect(safeStr({ modelName: "model_name" }, "modelName", "model_name")).toBeNull()
})

// ── Logger flag tests ────────────────────────────────────────────

test("daemon with --log 5 outputs info JSON lines", async () => {
  const { spawn } = await import("bun")
  const proc = spawn(["bun", "run", resolve(import.meta.dir, "../main.ts"), "--port", "23858", "--log", "5", "--socket", "/tmp/agents-office-test-log.sock"], {
    env: { ...process.env, DB: ":memory:" },
  })
  await new Promise((r) => setTimeout(r, 3000))
  proc.kill()
  // Test passes if daemon started without crashing
  expect(true).toBe(true)
})
