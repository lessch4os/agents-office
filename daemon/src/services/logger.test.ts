import { test, expect, beforeEach } from "bun:test"
import { mkdtempSync } from "fs"
import { join } from "path"
import { Logger, getLogger, setLogger } from "./logger"

beforeEach(() => {
  setLogger(new Logger())
})

test("level filtering suppresses levels above minLevel", () => {
  const log = new Logger(5)
  let lastLine = ""
  const origWrite = process.stderr.write.bind(process.stderr)
  process.stderr.write = ((line: string) => { lastLine = line; return true }) as any

  log.error("err msg")
  expect(lastLine).toContain("err msg")
  log.warn("warn msg")
  expect(lastLine).toContain("warn msg")
  log.info("info msg")
  expect(lastLine).toContain("info msg")
  lastLine = ""
  log.debug("debug msg")
  expect(lastLine).toBe("")
  log.trace("trace msg")
  expect(lastLine).toBe("")

  process.stderr.write = origWrite
})

test("trace level passes all messages", () => {
  const log = new Logger(10)
  let count = 0
  const origWrite = process.stderr.write.bind(process.stderr)
  process.stderr.write = (() => { count++; return true }) as any

  log.error("")
  log.warn("")
  log.info("")
  log.debug("")
  log.trace("")
  expect(count).toBe(5)

  process.stderr.write = origWrite
})

test("JSON format has required fields", () => {
  const log = new Logger(10)
  let json = ""
  const origWrite = process.stderr.write.bind(process.stderr)
  process.stderr.write = ((line: string) => { json = line; return true }) as any

  log.info("test msg")
  const entry = JSON.parse(json)
  expect(entry).toHaveProperty("ts")
  expect(entry).toHaveProperty("level")
  expect(entry).toHaveProperty("component")
  expect(entry).toHaveProperty("msg")
  expect(entry.level).toBe(5)
  expect(entry.msg).toBe("test msg")

  process.stderr.write = origWrite
})

test("component scoping via child()", () => {
  const log = new Logger(10)
  let lastLine = ""
  const origWrite = process.stderr.write.bind(process.stderr)
  process.stderr.write = ((line: string) => { lastLine = line; return true }) as any

  const fwd = log.child("forwarder")
  fwd.info("forwarder msg")
  const entry = JSON.parse(lastLine)
  expect(entry.component).toBe("forwarder")
  expect(entry.msg).toBe("forwarder msg")

  process.stderr.write = origWrite
})

test("extra fields appear in output", () => {
  const log = new Logger(10)
  let json = ""
  const origWrite = process.stderr.write.bind(process.stderr)
  process.stderr.write = ((line: string) => { json = line; return true }) as any

  log.info("event", { sessionId: "s1", agentId: 123 })
  const entry = JSON.parse(json)
  expect(entry.sessionId).toBe("s1")
  expect(entry.agentId).toBe(123)

  process.stderr.write = origWrite
})

test("global getLogger returns configured instance", () => {
  const custom = new Logger(1, "forwarder")
  setLogger(custom)
  expect(getLogger()).toBe(custom)
  expect(getLogger()).not.toBe(new Logger())
})

test("file appender writes to disk", async () => {
  const tmpDir = mkdtempSync("/tmp/logger-test-")
  const log = new Logger(10)
  log.setFileAppender(tmpDir)
  log.info("file test")
  log.warn("file warn")

  const content = await Bun.file(join(tmpDir, "daemon.log")).text()
  const lines = content.trim().split("\n")
  expect(lines.length).toBe(2)
  const first = JSON.parse(lines[0])
  expect(first.msg).toBe("file test")
  const second = JSON.parse(lines[1])
  expect(second.msg).toBe("file warn")

  const { rmSync } = await import("fs")
  rmSync(tmpDir, { recursive: true })
})

test("child inherits level and filter from parent", () => {
  const log = new Logger(5, "daemon")
  const child = log.child("reducer")
  expect((child as any).minLevel).toBe(5)
})
