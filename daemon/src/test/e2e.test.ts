import { test, expect, beforeAll, afterAll } from "bun:test"
import { resolve } from "path"
import { HookClient } from "./hook-client"
import { PluginClient } from "./plugin-client"
import { startTestDaemon, type TestDaemon } from "./helper"
import {
  uid, sessionId, hookSessionStart, hookActivityStart, hookActivityEnd,
  hookSessionEnd, hookTokenUsage, hookRename, hookTaskStart, hookTaskEnd,
  ocSessionCreated, ocToolStart, ocToolEnd, ocTokens,
  fullAgentLifecycle, parentChildChain,
} from "./fixtures"

const PORT = 0 // random port assigned by helper
let daemon: TestDaemon
let hook: HookClient
let plugin: PluginClient

async function api(path: string, init?: RequestInit): Promise<any> {
  const r = await fetch(`${daemon.url}${path}`, init)
  return r.json().catch(() => null)
}

function waitForSceneAgent(predicate: (a: any) => boolean, timeoutMs = 5000): Promise<any> {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const poll = async () => {
      if (Date.now() - start > timeoutMs) return reject(new Error("timeout waiting for agent"))
      const scene = await api("/api/scene")
      const match = Object.values(scene.agents ?? {}).find(predicate)
      if (match) return resolve(match)
      setTimeout(poll, 200)
    }
    poll()
  })
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

beforeAll(async () => {
  daemon = await startTestDaemon(0)
  await delay(500)

  hook = new HookClient()
  plugin = new PluginClient()
  await hook.connect(daemon.socketPath)
  await plugin.connect(daemon.socketPath)
}, 15000)

afterAll(() => {
  hook?.close()
  plugin?.close()
  daemon?.cleanup()
})

// ── 1. Basic agent lifecycle ───────────────────────────────────────

test("agent lifecycle: start → activity → end", async () => {
  const sid = sessionId()
  await hook.send(hookSessionStart({ session_id: sid, cwd: "/test/lifecycle" }))
  await delay(300)

  const agent = await waitForSceneAgent((a: any) => a.session_id === sid)
  expect(agent).toBeDefined()
  expect(agent.cwd).toBe("/test/lifecycle")

  await hook.send(hookActivityStart(sid, "Bash"))
  await delay(300)
  const active = await waitForSceneAgent((a: any) => a.session_id === sid && a.state.type === "Active")
  expect(active.state.activity).toBe("Bash")

  await hook.send(hookActivityEnd(sid, "Bash"))
  await hook.send(hookSessionEnd(sid))
  await delay(500)

  const sessions = await api("/api/sessions")
  const match = (sessions as any[]).find((s: any) => s.session_id === sid)
  expect(match).toBeDefined()
  expect(match.cwd).toBe("/test/lifecycle")
})

// ── 2. Token tracking ──────────────────────────────────────────────

test("token tracking via multiple updates", async () => {
  const sid = sessionId()
  await hook.send(hookSessionStart({ session_id: sid }))
  await delay(200)
  await hook.send(hookTokenUsage(sid, 100, 50))
  await hook.send(hookTokenUsage(sid, 50, 25))
  await hook.send(hookSessionEnd(sid))
  await delay(500)

  const detail = await api(`/api/sessions/${sid}`)
  expect(detail).not.toBeNull()
  expect(detail.input_tokens).toBe(150)
  expect(detail.output_tokens).toBe(75)
})

// ── 3. Parent/child tree ───────────────────────────────────────────

test("parent-child session chain", async () => {
  const { parentSid, childSid, events } = parentChildChain()
  for (const ev of events) {
    await hook.send(ev)
    await delay(50)
  }
  await delay(500)

  const sessions = (await api("/api/sessions")) as any[]
  const parent = sessions.find((s: any) => s.session_id === parentSid)
  const child = sessions.find((s: any) => s.session_id === childSid)
  expect(parent).toBeDefined()
  expect(child).toBeDefined()
  expect(child.parent_session_id).toBe(parentSid)

  const compare = await api(`/api/sessions/compare?a=${parentSid}&b=${childSid}`)
  expect(compare).not.toBeNull()
  expect(compare.a.session_id).toBe(parentSid)
  expect(compare.b.session_id).toBe(childSid)
  expect(compare.diff).toBeDefined()
})

// ── 4. Multiple concurrent agents ──────────────────────────────────

test("multiple concurrent agents appear in scene", async () => {
  const sids = [sessionId(), sessionId(), sessionId()]
  for (const sid of sids) {
    await hook.send(hookSessionStart({ session_id: sid, cwd: `/test/multi/${sid}` }))
  }
  await delay(500)

  const scene = await api("/api/scene")
  const matched = Object.values(scene.agents ?? {}).filter(
    (a: any) => sids.includes(a.session_id),
  )
  expect(matched.length).toBe(3)

  for (const sid of sids) {
    await hook.send(hookSessionEnd(sid))
  }
})

// ── 5. Pricing CRUD ────────────────────────────────────────────────

test("pricing CRUD flow", async () => {
  const list1 = (await api("/api/pricing")) as any[]
  expect(list1.length).toBeGreaterThan(0)

  const r = await api("/api/pricing", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model_name: "e2e-test-model", input_per_m: 5, output_per_m: 20, cache_read_per_m: 1 }),
  })
  expect(r.ok).toBe(true)

  const list2 = (await api("/api/pricing")) as any[]
  const found = list2.find((r: any) => r.model_name === "e2e-test-model")
  expect(found).toBeDefined()
  expect(found.input_per_m).toBe(5)

  const reset = await api("/api/pricing/reset", { method: "POST" })
  expect(reset.ok).toBe(true)

  const list3 = (await api("/api/pricing")) as any[]
  expect(list3.find((r: any) => r.model_name === "e2e-test-model")).toBeUndefined()
})

// ── 6. Session tags ────────────────────────────────────────────────

test("session tag CRUD flow", async () => {
  const sid = sessionId()
  await hook.send(hookSessionStart({ session_id: sid }))
  await delay(200)

  const tag1 = await api(`/api/sessions/${sid}/tag`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tag: "e2e-test" }),
  })
  expect(tag1.ok).toBe(true)

  const detail = await api(`/api/sessions/${sid}`)
  expect(detail.tags).toContain("e2e-test")

  const filtered = await api("/api/sessions?tag=e2e-test")
  expect((filtered as any[]).length).toBeGreaterThan(0)
  expect((filtered as any[])[0].tags).toContain("e2e-test")

  const del = await api(`/api/sessions/${sid}/tag/e2e-test`, { method: "DELETE" })
  expect(del.ok).toBe(true)

  const detail2 = await api(`/api/sessions/${sid}`)
  expect(detail2.tags).not.toContain("e2e-test")

  await hook.send(hookSessionEnd(sid))
})

// ── 7. Raw events stored ───────────────────────────────────────────

test("raw events are stored and queryable", async () => {
  const sid = sessionId()
  await hook.send(hookSessionStart({ session_id: sid }))
  await hook.send(hookRename(sid, "raw-test"))
  await hook.send(hookSessionEnd(sid))
  await delay(500)

  const detail = await api(`/api/sessions/${sid}`)
  expect(detail).not.toBeNull()
  expect(detail.session_id).toBe(sid)
})

// ── 8. OC plugin events ────────────────────────────────────────────

test("OC plugin events spawn agents", async () => {
  const ocSid = sessionId("oc")
  await plugin.send(ocSessionCreated(undefined, { session_id: ocSid, cwd: "/test/oc" }))
  await delay(300)

  const agent = await waitForSceneAgent((a: any) => a.session_id === ocSid)
  expect(agent).toBeDefined()
  expect(agent.source).toBe("opencode")
  expect(agent.cwd).toBe("/test/oc")

  await plugin.send(ocToolStart(ocSid, "Bash"))
  await delay(300)
  const active = await waitForSceneAgent(
    (a: any) => a.session_id === ocSid && a.state.type === "Active",
  )
  expect(active.state.activity).toBe("Bash")

  await plugin.send(ocToolEnd(ocSid, "Bash"))
  await plugin.send(ocTokens(ocSid, 500, 100))
  await delay(300)
})

// ── 9. DB migration matches schema ─────────────────────────────────

test("DB migration matches schema expectations", async () => {
  const { migrate, getCurrentVersion } = await import("../db/migrate")
  const { Database } = await import("bun:sqlite")
  const db = new Database(":memory:")
  migrate(db)
  expect(getCurrentVersion(db)).toBe(4)

  for (const table of ["sessions", "raw_events", "token_snapshots", "model_pricing"]) {
    const cols = db.query(`PRAGMA table_info('${table}')`).all() as { name: string }[]
    expect(cols.length).toBeGreaterThan(0)
  }
  db.close()
})

// ── 10. Health check and scene ─────────────────────────────────────

test("health and scene endpoints return expected shape", async () => {
  const health = await api("/health")
  expect(health).toEqual({ ok: true })

  const scene = await api("/api/scene")
  expect(scene).toHaveProperty("agents")
  expect(scene).toHaveProperty("max_desks")
  expect(scene).toHaveProperty("now_ms")
})

// ── 11. Source filtering ───────────────────────────────────────────

test("sessions list supports source and tag filtering", async () => {
  const sid1 = sessionId("sf1")
  const sid2 = sessionId("sf2")
  await hook.send(hookSessionStart({ session_id: sid1, source: "cool-tool" }))
  await hook.send(hookSessionStart({ session_id: sid2, source: "other-tool" }))
  await delay(300)

  const filtered = (await api("/api/sessions?source=cool-tool")) as any[]
  expect(filtered.every((s: any) => s.source === "cool-tool")).toBe(true)

  await hook.send(hookSessionEnd(sid1))
  await hook.send(hookSessionEnd(sid2))
})
