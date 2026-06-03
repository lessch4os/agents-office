import { Effect, Fiber, Queue, Schedule, Stream } from "effect"
import net from "net"
import fs from "fs"
import path from "path"
import { decodeHookPayload } from "../decoders/hook-decoder"
import type { AgentEvent } from "../schemas/agent-event"
import { hashAgentId } from "../schemas/agent-id"

const MAX_CONCURRENT_CONNS = 128
const MAX_PAYLOAD_BYTES = 65536

function createCompatSymlinks(actualPath: string): Effect.Effect<void> {
  return Effect.sync(() => {
    const dirPath = path.dirname(actualPath)
    const commonDirs = ["/run/user/0", "/run/user/1000"].filter(d => d !== dirPath)
    for (const dir of commonDirs) {
      const link = `${dir}/agents-office.sock`
      try { fs.unlinkSync(link) } catch {}
      try {
        fs.symlinkSync(actualPath, link)
        console.log(`hook symlink: ${link} → ${actualPath}`)
      } catch {}
    }
  })
}

export interface HookSocketSource {
  readonly events: Stream.Stream<readonly [AgentEvent, string, string]>
}

export function makeHookSocketSource(socketPath: string): Effect.Effect<HookSocketSource, never, never> {
  return Effect.gen(function* () {
    yield* Effect.sync(() => {
      try { fs.unlinkSync(socketPath) } catch {}
    })
    yield* createCompatSymlinks(socketPath)

    const queue = yield* Queue.unbounded<readonly [AgentEvent, string, string]>()

    const server = net.createServer()

    let activeConns = 0

    server.on("connection", (socket) => {
      if (activeConns >= MAX_CONCURRENT_CONNS) {
        socket.destroy()
        return
      }
      activeConns++
      socket.setTimeout(30000)

      let buffer = ""
      socket.on("data", (data: Buffer) => {
        buffer += data.toString("utf-8")
        if (buffer.length > MAX_PAYLOAD_BYTES) {
          socket.destroy()
          return
        }
        const lines = buffer.split("\n")
        buffer = lines.pop() ?? ""
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) continue
          let parsed: Record<string, unknown>
          try { parsed = JSON.parse(trimmed) } catch { continue }

          const result = decodeHookPayload(parsed, hashAgentId)
          if (result._tag === "Right") {
            const source = result.right.ctx.source
            const sessionId = result.right.ctx.sessionId
            for (const ev of result.right.events) {
              Queue.unsafeOffer(queue, [ev, source, sessionId])
            }
          }
        }
      })

      socket.on("close", () => { activeConns-- })
      socket.on("error", () => { activeConns-- })
      socket.on("timeout", () => { socket.destroy() })
    })

    yield* Effect.async<void>((resume) => {
      server.on("error", (err) => resume(Effect.die(err)))
      server.listen(socketPath, () => resume(Effect.void))
    })

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        server.close()
        try { fs.unlinkSync(socketPath) } catch {}
      })
    )

    return {
      events: Stream.fromQueue(queue),
    }
  }).pipe(Effect.scoped)
}
