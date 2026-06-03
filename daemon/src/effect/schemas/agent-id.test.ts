import { describe, test, expect } from "bun:test"
import { hashAgentId } from "./agent-id"

describe("hashAgentId", () => {
  test("deterministic", () => {
    const a = hashAgentId("hook", "session_abc")
    const b = hashAgentId("hook", "session_abc")
    expect(a).toBe(b)
  })

  test("different domains produce different hashes", () => {
    const a = hashAgentId("hook", "session_abc")
    const b = hashAgentId("jsonl", "session_abc")
    expect(a).not.toBe(b)
  })

  test("different keys produce different hashes", () => {
    const a = hashAgentId("hook", "session_abc")
    const b = hashAgentId("hook", "session_def")
    expect(a).not.toBe(b)
  })

  test("returns positive number", () => {
    const id = hashAgentId("hook", "hello")
    expect(typeof id).toBe("number")
    expect(id).toBeGreaterThan(0)
    expect(Number.isInteger(id)).toBe(true)
  })
})
