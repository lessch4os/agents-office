import { Effect, Stream, Queue, Schedule } from "effect"
import fs from "fs"
import path from "path"
import { hashAgentId } from "../schemas/agent-id"
import type { AgentEvent } from "../schemas/agent-event"

export type LineDecoder = (
  transcriptPath: string,
  source: string,
  agentId: number,
  json: Record<string, unknown>,
) => AgentEvent[]

export type LabelDeriver = (filePath: string, cwd: string) => string

export type SessionEndChecker = (tail: Uint8Array) => boolean

const TAIL_BYTES = 8192
const MAX_PENDING_BYTES = 1 << 20
const PERIODIC_SCAN_MS = 60_000
const DEFAULT_INITIAL_WINDOW_MS = 3600_000
const STARTUP_STALE_MINUTES = 5

export interface JsonlWatcherSource {
  readonly events: Stream.Stream<readonly [AgentEvent, string]>
}

export function makeJsonlWatcherSource(
  root: string,
  sourceName: string,
  decodeLine: LineDecoder,
  deriveLabel: LabelDeriver,
  checkEnded: SessionEndChecker,
): Effect.Effect<JsonlWatcherSource, never, never> {
  return Effect.gen(function* () {
    const queue = yield* Queue.unbounded<readonly [AgentEvent, string]>()
    const cursors = new Map<string, number>()
    const seen = new Set<string>()
    const initialWindowMs = DEFAULT_INITIAL_WINDOW_MS

    function emit(ev: AgentEvent) {
      Queue.unsafeOffer(queue, [ev, sourceName] as const)
    }

    function detectParentId(filePath: string): number | undefined {
      const idx = filePath.indexOf("/subagents/")
      if (idx === -1) return undefined
      const parentDir = filePath.slice(0, idx)
      const parentJsonl = `${parentDir}.jsonl`
      return hashAgentId(sourceName, parentJsonl)
    }

    async function readFileChunk(filePath: string, cursor: number): Promise<{ bytes: Uint8Array; safeEnd: number } | null> {
      let stat: fs.Stats
      try { stat = await fs.promises.stat(filePath) } catch { return null }
      if (stat.isDirectory()) return null
      const fileLen = stat.size
      if (cursor > fileLen) return null
      if (cursor === fileLen) return null
      if (fileLen - cursor > MAX_PENDING_BYTES) return null

      const chunkSize = fileLen - cursor
      const buf = new Uint8Array(chunkSize)
      let fd: fs.promises.FileHandle | null = null
      try {
        fd = await fs.promises.open(filePath, "r")
        await fd.read(buf, 0, buf.length, cursor)
      } catch { return null }
      finally { await fd?.close() }

      let safeEndRelative = 0
      for (let i = buf.length - 1; i >= 0; i--) {
        if (buf[i] === 0x0a) { safeEndRelative = i + 1; break }
      }
      if (safeEndRelative === 0) return null

      return { bytes: buf.subarray(0, safeEndRelative), safeEnd: cursor + safeEndRelative }
    }

    async function walkFile(filePath: string): Promise<void> {
      if (!filePath.endsWith(".jsonl")) return
      let stat: fs.Stats
      try { stat = await fs.promises.stat(filePath) } catch { return }
      if (stat.isDirectory()) return

      const fileLen = stat.size
      let cursor = cursors.get(filePath) ?? 0
      if (cursor > fileLen) { cursors.set(filePath, 0); return }

      const chunk = await readFileChunk(filePath, cursor)
      if (!chunk) return
      cursors.set(filePath, chunk.safeEnd)

      if (!seen.has(filePath)) {
        seen.add(filePath)
        const agentId = hashAgentId(sourceName, filePath)
        const sessionId = path.basename(filePath, ".jsonl")
        const cwd = extractCwd(chunk.bytes) ?? ""
        const parentId = detectParentId(filePath)

        emit({ type: "sessionStart", agentId, source: sourceName, sessionId, cwd, parentId, parentSessionId: undefined, agentType: undefined, contextWindowLimit: undefined, origin: undefined, machineName: undefined })
        emit({ type: "rename", agentId, label: deriveLabel(filePath, cwd) })
      }

      const text = new TextDecoder().decode(chunk.bytes)
      const agentId = hashAgentId(sourceName, filePath)
      for (const line of text.split("\n")) {
        if (!line.trim()) continue
        let parsed: Record<string, unknown>
        try { parsed = JSON.parse(line) } catch { continue }
        if (typeof parsed !== "object" || Array.isArray(parsed)) continue
        try {
          const events = decodeLine(filePath, sourceName, agentId, parsed)
          for (const ev of events) emit(ev)
        } catch {}
      }
    }

    async function checkSessionEnded(filePath: string): Promise<boolean> {
      try {
        const stat = await fs.promises.stat(filePath)
        const fileLen = stat.size
        const start = Math.max(0, fileLen - TAIL_BYTES)
        const fd = await fs.promises.open(filePath, "r")
        const buf = new Uint8Array(fileLen - start)
        await fd.read(buf, 0, buf.length, start)
        await fd.close()
        return checkEnded(buf)
      } catch { return false }
    }

    async function walkDir(dir: string): Promise<void> {
      let entries: fs.Dirent[]
      try { entries = await fs.promises.readdir(dir, { withFileTypes: true }) } catch { return }
      for (const entry of entries) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) await walkDir(full)
        else if (entry.name.endsWith(".jsonl")) await walkFile(full)
      }
    }

    async function seedFile(filePath: string): Promise<void> {
      let stat: fs.Stats
      try { stat = await fs.promises.stat(filePath) } catch { return }
      const ageMs = Date.now() - stat.mtimeMs
      if (ageMs > initialWindowMs) {
        cursors.set(filePath, stat.size)
        return
      }
      const ended = await checkSessionEnded(filePath) || ageMs / 60000 >= STARTUP_STALE_MINUTES
      if (ended) {
        cursors.set(filePath, stat.size)
      } else {
        await walkFile(filePath)
      }
    }

    // Initial seed
    yield* Effect.sync(() => console.log(`[jsonl] ${sourceName} watcher starting: ${root}`))
    const dirExists = await Effect.sync(() => { try { fs.mkdirSync(root, { recursive: true }); return true } catch { return false } })

    // Seed: walk dir and seed files
    await Effect.sync(async () => {
      let entries: fs.Dirent[]
      try { entries = await fs.promises.readdir(root, { withFileTypes: true }) } catch { return }
      for (const entry of entries) {
        const full = path.join(root, entry.name)
        if (entry.isDirectory()) {
          let sub: fs.Dirent[]
          try { sub = await fs.promises.readdir(full, { withFileTypes: true }) } catch { continue }
          for (const s of sub) {
            if (s.name.endsWith(".jsonl")) await seedFile(path.join(full, s.name))
          }
        } else if (entry.name.endsWith(".jsonl")) {
          await seedFile(full)
        }
      }
    })

    // Periodic + fs.watch
    yield* Effect.forkScoped(
      Effect.repeat(
        Effect.sync(() => walkDir(root)),
        Schedule.spaced(PERIODIC_SCAN_MS),
      ),
    )

    // fs.watch (best-effort)
    Effect.sync(() => {
      try {
        const watcher = fs.watch(root, { recursive: true }, (_event, filename) => {
          if (filename && filename.endsWith(".jsonl")) {
            walkFile(path.join(root, filename))
          }
        })
        process.on("exit", () => watcher.close())
      } catch {}
    })

    return { events: Stream.fromQueue(queue) }
  }).pipe(Effect.scoped)
}

function extractCwd(bytes: Uint8Array): string | null {
  const text = new TextDecoder().decode(bytes)
  for (const line of text.split("\n")) {
    if (!line.trim()) continue
    try {
      const parsed = JSON.parse(line)
      if (typeof parsed === "object" && typeof parsed.cwd === "string") return parsed.cwd
    } catch { continue }
  }
  return null
}
